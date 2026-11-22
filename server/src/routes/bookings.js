
import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { getDB } from '../db.js';
import { authenticate, allowRoles } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);

// Create booking
router.post('/', allowRoles('customer'), async (req, res, next) => {
  try {
    const { equipmentId, startDate, endDate, phone } = req.body || {};

    if (
      !ObjectId.isValid(equipmentId) ||
      !startDate ||
      !endDate ||
      typeof phone !== 'string'
    ) {
      return res.status(400).json({
        message: 'Equipment, rental dates and phone number are required',
      });
    }

    const customerPhone = phone.trim();
    const phoneDigits = customerPhone.replace(/\D/g, '');

    if (phoneDigits.length < 7 || phoneDigits.length > 15) {
      return res.status(400).json({
        message: 'Please provide a valid phone number',
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (
      !Number.isFinite(start.getTime()) ||
      !Number.isFinite(end.getTime()) ||
      start <= new Date() ||
      end <= start
    ) {
      return res.status(400).json({
        message: 'Choose valid future rental dates',
      });
    }

    const db = getDB();

    const equipment = await db.collection('equipment').findOne({
      _id: new ObjectId(equipmentId),
      status: 'approved',
    });

    if (!equipment) {
      return res.status(404).json({
        message: 'Equipment unavailable',
      });
    }

    if (String(equipment.ownerId) === String(req.user._id)) {
      return res.status(403).json({
        message: 'You cannot rent your own equipment',
      });
    }

    const conflict = await db.collection('bookings').findOne({
      equipmentId: equipment._id,
      startDate: { $lt: end },
      endDate: { $gt: start },
      $or: [
        { status: 'confirmed' },
        {
          status: 'pending',
          expiresAt: { $gt: new Date() },
        },
      ],
    });

    if (conflict) {
      return res.status(409).json({
        message: 'Dates unavailable',
      });
    }

    const days = Math.ceil((end - start) / 86400000);
    const amount = days * Number(equipment.price);

    if (
      !Number.isSafeInteger(days) ||
      days < 1 ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      amount > 100000000
    ) {
      return res.status(400).json({
        message: 'Rental duration or total price is invalid',
      });
    }

    const booking = {
      equipmentId: equipment._id,
      equipmentTitle: equipment.title,
      ownerId: equipment.ownerId,
      renterId: req.user._id,
      customerPhone,
      startDate: start,
      endDate: end,
      days,
      amount,
      status: 'pending',
      paymentStatus: 'unpaid',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    };

    const result = await db.collection('bookings').insertOne(booking);

    res.status(201).json({
      ...booking,
      _id: result.insertedId,
    });
  } catch (error) {
    next(error);
  }
});

// Get customer's bookings
router.get('/mine', async (req, res, next) => {
  try {
    const items = await getDB()
      .collection('bookings')
      .find({ renterId: req.user._id })
      .sort({ createdAt: -1 })
      .toArray();

    res.json(items);
  } catch (error) {
    next(error);
  }
});

// Get owner's bookings (admins can see all bookings)
router.get('/owner', allowRoles('owner', 'admin'), async (req, res, next) => {
  try {
    const filter =
      req.user.role === 'admin'
        ? {}
        : { ownerId: req.user._id };

    const items = await getDB()
      .collection('bookings')
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();

    res.json(items);
  } catch (error) {
    next(error);
  }
});

// Update booking status
router.patch('/:id/status', allowRoles('owner', 'admin'), async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        message: 'Invalid id',
      });
    }

    const status = req.body?.status;

    if (!['confirmed', 'rejected', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({
        message: 'Invalid status',
      });
    }

    const db = getDB();

    const booking = await db.collection('bookings').findOne({
      _id: new ObjectId(req.params.id),
    });

    if (!booking) {
      return res.status(404).json({
        message: 'Booking not found',
      });
    }

    // Check ownership
    if (
      req.user.role !== 'admin' &&
      String(booking.ownerId) !== String(req.user._id)
    ) {
      return res.status(403).json({
        message: 'Not allowed',
      });
    }

    // Only pending bookings can be confirmed
    if (status === 'confirmed') {
      if (booking.status !== 'pending') {
        return res.status(409).json({
          message: 'Only pending bookings can be confirmed',
        });
      }

      if (booking.paymentStatus !== 'paid') {
        return res.status(409).json({
          message: 'Booking must be paid before confirmation',
        });
      }
    }

    // Only pending bookings can be rejected
    if (status === 'rejected' && booking.status !== 'pending') {
      return res.status(409).json({
        message: 'Only pending bookings can be rejected',
      });
    }

    // Only pending or confirmed bookings can be cancelled
    if (
      status === 'cancelled' &&
      !['pending', 'confirmed'].includes(booking.status)
    ) {
      return res.status(409).json({
        message: 'This booking cannot be cancelled',
      });
    }

    // Complete only confirmed bookings after rental end date
    if (status === 'completed') {
      if (booking.status !== 'confirmed') {
        return res.status(409).json({
          message: 'Only confirmed bookings can be completed',
        });
      }

      if (new Date(booking.endDate) > new Date()) {
        return res.status(409).json({
          message: 'Rental period has not ended yet',
        });
      }
    }

    await db.collection('bookings').updateOne(
      { _id: booking._id },
      {
        $set: {
          status,
          updatedAt: new Date(),
        },
      }
    );

    res.json({
      message: 'Booking updated successfully',
    });
  } catch (error) {
    next(error);
  }
});

export default router;
