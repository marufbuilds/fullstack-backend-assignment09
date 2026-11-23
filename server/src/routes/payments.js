 
import { Router } from 'express';
import Stripe from 'stripe';
import { ObjectId } from 'mongodb';
import { getDB } from '../db.js';
import { authenticate, allowRoles } from '../middleware/auth.js';

const router = Router();

const idValues = (id) => {
  const stringId = String(id);
  const values = [stringId];

  if (ObjectId.isValid(stringId)) {
    values.push(new ObjectId(stringId));
  }

  return values;
};

function getCurrency() {
  const currency = (process.env.STRIPE_CURRENCY || 'usd').toLowerCase();

  if (!/^[a-z]{3}$/.test(currency)) {
    throw new Error('STRIPE_CURRENCY must be a valid three-letter currency code');
  }

  return currency;
}

function toMinorUnits(amount, currency) {
  const zeroDecimalCurrencies = [
    'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw',
    'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf',
    'xof', 'xpf'
  ];

  const threeDecimalCurrencies = ['bhd', 'jod', 'kwd', 'omr', 'tnd'];

  const decimals = zeroDecimalCurrencies.includes(currency)
    ? 0
    : threeDecimalCurrencies.includes(currency)
      ? 3
      : 2;

  return Math.round(Number(amount) * (10 ** decimals));
}

router.post(
  '/checkout/:bookingId',
  authenticate,
  allowRoles('customer'),
  async (req, res, next) => {
    try {
      if (!ObjectId.isValid(req.params.bookingId)) {
        return res.status(400).json({ message: 'Invalid booking' });
      }

      if (!process.env.STRIPE_SECRET_KEY) {
        return res.status(503).json({
          message: 'Payments are not configured'
        });
      }

      const db = getDB();
      const bookingId = new ObjectId(req.params.bookingId);

      const booking = await db.collection('bookings').findOne({
        _id: bookingId,
        renterId: { $in: idValues(req.user._id) },
        status: 'pending',
        paymentStatus: 'unpaid'
      });

      if (!booking) {
        return res.status(404).json({
          message: 'Pending booking not found'
        });
      }

      if (booking.expiresAt && booking.expiresAt <= new Date()) {
        return res.status(409).json({
          message: 'Booking hold expired. Please create a new booking.'
        });
      }

      const amount = Number(booking.amount);

      if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) {
        return res.status(400).json({
          message: 'Invalid booking amount'
        });
      }

      const currency = getCurrency();
      const amountMinor = toMinorUnits(amount, currency);

      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
        return res.status(400).json({
          message: 'Invalid payment amount'
        });
      }

      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

      // Reuse an existing active session for this booking.
      const existing = await db.collection('payments').findOne({
        bookingId,
        status: 'pending'
      });

      if (existing?.checkoutSessionId) {
        const oldSession = await stripe.checkout.sessions.retrieve(
          existing.checkoutSessionId
        );

        if (oldSession.status === 'open' && oldSession.url) {
          return res.json({ url: oldSession.url });
        }

        if (oldSession.status === 'complete') {
          return res.status(409).json({
            message: 'Payment is being processed. Please refresh your bookings.'
          });
        }

        await db.collection('payments').updateOne(
          { _id: existing._id, status: 'pending' },
          {
            $set: {
              status: 'expired',
              expiredAt: new Date()
            }
          }
        );
      }

      const expiresAt =
        booking.expiresAt || new Date(Date.now() + 30 * 60 * 1000);

      const expiresAtSeconds = Math.floor(expiresAt.getTime() / 1000);

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        expires_at: expiresAtSeconds,

        success_url:
          `${process.env.CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,

        cancel_url: `${process.env.CLIENT_URL}/payment/cancel`,

        line_items: [
          {
            price_data: {
              currency,
              product_data: {
                name: booking.equipmentTitle || 'Equipment rental'
              },
              unit_amount: amountMinor
            },
            quantity: 1
          }
        ],

        metadata: {
          bookingId: String(booking._id),
          renterId: String(req.user._id)
        }
      });

      const payment = {
        bookingId,
        renterId: String(req.user._id),
        amount,
        amountMinor,
        currency,
        status: 'pending',
        checkoutSessionId: session.id,
        checkoutUrl: session.url,
        createdAt: new Date()
      };

      await db.collection('payments').insertOne(payment);

      return res.json({ url: session.url });
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
