 
import Stripe from 'stripe';
import { ObjectId } from 'mongodb';
import { getDB } from '../db.js';

const idValues = (id) => {
  const stringId = String(id);
  const values = [stringId];

  if (ObjectId.isValid(stringId)) {
    values.push(new ObjectId(stringId));
  }

  return values;
};

export async function stripeWebhook(req, res) {
  if (
    !process.env.STRIPE_SECRET_KEY ||
    !process.env.STRIPE_WEBHOOK_SECRET
  ) {
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
  const payments = db.collection('payments');
  const bookings = db.collection('bookings');

  // Prevent processing the same event multiple times.
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

      return res.status(500).json({
        message: 'Could not register event'
      });
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
        $unset: {
          error: ''
        }
      }
    );

    if (!retry.modifiedCount) {
      return res.json({
        received: true,
        duplicate: true
      });
    }
  }

  try {
    const session = event.data.object;
    const now = new Date();

    // Successful checkout
    if (
      event.type === 'checkout.session.completed' ||
      event.type === 'checkout.session.async_payment_succeeded'
    ) {
      if (session.payment_status === 'paid') {
        const bookingId = session.metadata?.bookingId;
        const renterId = session.metadata?.renterId;

        if (!ObjectId.isValid(bookingId) || !renterId) {
          throw new Error('Invalid booking or renter metadata');
        }

        const bookingObjectId = new ObjectId(bookingId);
        const renterIdValues = idValues(renterId);

        const payment = await payments.findOne({
          bookingId: bookingObjectId,
          renterId: { $in: renterIdValues },
          checkoutSessionId: session.id
        });

        if (!payment) {
          throw new Error('Matching payment record not found');
        }

        // Verify the Stripe payment against our saved payment.
        if (
          Number(session.amount_total) !== Number(payment.amountMinor) ||
          String(session.currency).toLowerCase() !==
            String(payment.currency).toLowerCase()
        ) {
          throw new Error('Stripe amount or currency mismatch');
        }

        const booking = await bookings.findOne({
          _id: bookingObjectId,
          renterId: { $in: renterIdValues }
        });

        if (!booking) {
          throw new Error('Matching booking not found');
        }

        // Save payment details.
        await payments.updateOne(
          { _id: payment._id },
          {
            $set: {
              status: 'paid',
              paidAt: payment.paidAt || now,
              stripeEventId: event.id,
              paymentIntentId: session.payment_intent || null,
              updatedAt: now
            }
          }
        );

        // Payment does not approve the booking.
        // The owner still needs to confirm it.
        if (
          booking.status === 'pending' &&
          ['unpaid', 'paid'].includes(booking.paymentStatus)
        ) {
          const result = await bookings.updateOne(
            {
              _id: bookingObjectId,
              renterId: { $in: renterIdValues },
              status: 'pending',
              paymentStatus: booking.paymentStatus
            },
            {
              $set: {
                paymentStatus: 'paid',
                paidAt: booking.paidAt || now,
                updatedAt: now
              },
              $unset: {
                expiresAt: ''
              }
            }
          );

          if (!result.modifiedCount) {
            await payments.updateOne(
              { _id: payment._id },
              {
                $set: {
                  reconciliationRequired: true
                }
              }
            );
          }
        } else {
          // Payment succeeded but the booking is no longer eligible.
          await payments.updateOne(
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

    // Expired Stripe checkout session.
    if (event.type === 'checkout.session.expired') {
      await payments.updateOne(
        {
          checkoutSessionId: session.id,
          status: 'pending'
        },
        {
          $set: {
            status: 'expired',
            expiredAt: now,
            stripeEventId: event.id,
            updatedAt: now
          }
        }
      );

      const bookingId = session.metadata?.bookingId;

      if (ObjectId.isValid(bookingId)) {
        // Only expire unpaid pending bookings.
        await bookings.updateOne(
          {
            _id: new ObjectId(bookingId),
            status: 'pending',
            paymentStatus: 'unpaid'
          },
          {
            $set: {
              status: 'cancelled',
              paymentStatus: 'expired',
              updatedAt: now
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

    return res.json({
      received: true
    });
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
