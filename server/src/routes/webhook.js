
import Stripe from 'stripe';
import { ObjectId } from 'mongodb';
import { getDB } from '../db.js';

export async function stripeWebhook(req, res) {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).send('Webhook not configured');
  }

  let event;

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (error) {
    console.error('Stripe signature verification failed:', error.message);
    return res.status(400).send('Invalid webhook signature');
  }

  const db = getDB();
  const events = db.collection('stripeEvents');

  // Register each Stripe event only once.
  try {
    await events.insertOne({
      eventId: event.id,
      type: event.type,
      status: 'processing',
      receivedAt: new Date()
    });
  } catch (error) {
    if (error.code !== 11000) {
      console.error('Could not register Stripe event:', error);
      return res.status(500).json({ message: 'Could not register event' });
    }

    const retry = await events.updateOne(
      {
        eventId: event.id,
        status: 'failed'
      },
      {
        $set: {
          status: 'processing',
          retryAt: new Date()
        },
        $unset: { error: '' }
      }
    );

    if (!retry.modifiedCount) {
      return res.json({ received: true, duplicate: true });
    }
  }

  try {
    const session = event.data.object;

    if (
      event.type === 'checkout.session.completed' ||
      event.type === 'checkout.session.async_payment_succeeded'
    ) {
      if (session.payment_status === 'paid') {
        const bookingId = session.metadata?.bookingId;
        const renterId = session.metadata?.renterId;

        if (!ObjectId.isValid(bookingId) || !ObjectId.isValid(renterId)) {
          throw new Error('Invalid booking or renter metadata');
        }

        const bookingObjectId = new ObjectId(bookingId);
        const renterObjectId = new ObjectId(renterId);

        const payment = await db.collection('payments').findOne({
          bookingId: bookingObjectId,
          renterId: renterObjectId,
          checkoutSessionId: session.id
        });

        if (!payment) {
          throw new Error('Matching payment record not found');
        }

        // Never trust the amount or currency from the browser.
        if (
          Number(session.amount_total) !== Number(payment.amountMinor) ||
          String(session.currency).toLowerCase() !== payment.currency
        ) {
          throw new Error('Stripe payment amount or currency does not match');
        }

        const booking = await db.collection('bookings').findOne({
          _id: bookingObjectId,
          renterId: renterObjectId
        });

        if (!booking) {
          throw new Error('Matching booking not found');
        }

        const now = new Date();

        // Record the actual payment even if the booking needs manual review.
        await db.collection('payments').updateOne(
          { _id: payment._id },
          {
            $set: {
              status: 'paid',
              paidAt: now,
              stripeEventId: event.id,
              paymentIntentId: session.payment_intent || null
            }
          }
        );

        if (booking.status === 'pending' && booking.paymentStatus === 'unpaid') {
          const result = await db.collection('bookings').updateOne(
            {
              _id: bookingObjectId,
              status: 'pending',
              paymentStatus: 'unpaid'
            },
            {
              $set: {
                paymentStatus: 'paid',
                status: 'confirmed',
                paidAt: now,
                updatedAt: now
              }
            }
          );

          if (!result.modifiedCount) {
            await db.collection('payments').updateOne(
              { _id: payment._id },
              {
                $set: {
                  reconciliationRequired: true
                }
              }
            );
          }
        } else if (
          booking.paymentStatus !== 'paid' ||
          booking.status === 'cancelled' ||
          booking.status === 'rejected'
        ) {
          await db.collection('payments').updateOne(
            { _id: payment._id },
            {
              $set: {
                reconciliationRequired: true
              }
            }
          );
        }
      }
    }

    if (event.type === 'checkout.session.expired') {
      await db.collection('payments').updateOne(
        {
          checkoutSessionId: session.id,
          status: 'pending'
        },
        {
          $set: {
            status: 'expired',
            expiredAt: new Date(),
            stripeEventId: event.id
          }
        }
      );

      const bookingId = session.metadata?.bookingId;

      if (ObjectId.isValid(bookingId)) {
        await db.collection('bookings').updateOne(
          {
            _id: new ObjectId(bookingId),
            status: 'pending',
            paymentStatus: 'unpaid'
          },
          {
            $set: {
              status: 'cancelled',
              paymentStatus: 'expired',
              updatedAt: new Date()
            }
          }
        );
      }
    }

    await events.updateOne(
      { eventId: event.id },
      {
        $set: {
          status: 'processed',
          processedAt: new Date()
        }
      }
    );

    return res.json({ received: true });
  } catch (error) {
    await events.updateOne(
      { eventId: event.id },
      {
        $set: {
          status: 'failed',
          error: error.message,
          failedAt: new Date()
        }
      }
    );

    console.error('Stripe webhook processing failed:', error);

    return res.status(500).json({
      message: 'Webhook processing failed'
    });
  }
}
