import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { getDB } from '../db.js';
import { authenticate, allowRoles } from '../middleware/auth.js';
import { idValues, normalizeId, ownerFilter } from '../lib/ids.js';
const router = Router();
router.use(authenticate);
// Create booking
router.post('/', allowRoles('customer'), async (req, res, next) => {
    try {
        const { equipmentId, startDate, endDate, phone } = req.body || {};
        if (!ObjectId.isValid(equipmentId) ||
            !startDate ||
            !endDate ||
            typeof phone !== 'string') {
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
        const now = new Date();
        if (!Number.isFinite(start.getTime()) ||
            !Number.isFinite(end.getTime()) ||
            start <= now ||
            end <= start) {
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
        // Prevent owners from renting their own equipment.
        if (idValues(req.user._id).some((id) => String(id) === String(equipment.ownerId))) {
            return res.status(403).json({
                message: 'You cannot rent your own equipment',
            });
        }
        // Check overlapping bookings.
        const conflict = await db.collection('bookings').findOne({
            equipmentId: equipment._id,
            startDate: { $lt: end },
            endDate: { $gt: start },
            $or: [
                { status: 'confirmed' },
                { status: 'pending', paymentStatus: 'paid' },
                {
                    status: 'pending',
                    paymentStatus: 'unpaid',
                    expiresAt: { $gt: now },
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
        if (!Number.isSafeInteger(days) ||
            days < 1 ||
            !Number.isFinite(amount) ||
            amount <= 0 ||
            amount > 100000000) {
            return res.status(400).json({
                message: 'Rental duration or total price is invalid',
            });
        }
        // New bookings always store IDs as strings.
        const booking = {
            equipmentId: equipment._id,
            equipmentTitle: equipment.title,
            ownerId: normalizeId(equipment.ownerId),
            renterId: normalizeId(req.user._id),
            customerPhone,
            startDate: start,
            endDate: end,
            days,
            amount,
            status: 'pending',
            paymentStatus: 'unpaid',
            createdAt: now,
            expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
        };
        const result = await db.collection('bookings').insertOne(booking);
        res.status(201).json({
            ...booking,
            _id: result.insertedId,
        });
    }
    catch (error) {
        next(error);
    }
});
// Customer bookings
router.get('/mine', async (req, res, next) => {
    try {
        const items = await getDB()
            .collection('bookings')
            .find({
            renterId: { $in: idValues(req.user._id) },
        })
            .sort({ createdAt: -1 })
            .toArray();
        res.json(items);
    }
    catch (error) {
        next(error);
    }
});
// Owner bookings
router.get('/owner', allowRoles('owner', 'admin'), async (req, res, next) => {
    try {
        const filter = req.user.role === 'admin'
            ? {}
            : ownerFilter(req.user._id);
        const items = await getDB()
            .collection('bookings')
            .find(filter)
            .sort({ createdAt: -1 })
            .toArray();
        res.json(items);
    }
    catch (error) {
        next(error);
    }
});
// Update booking status
router.patch('/:id/status', allowRoles('owner', 'admin'), async (req, res, next) => {
    try {
        const routeId = String(req.params.id ?? '');
        if (!ObjectId.isValid(routeId)) {
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
        const bookingId = new ObjectId(routeId);
        const booking = await db.collection('bookings').findOne({
            _id: bookingId,
        });
        if (!booking) {
            return res.status(404).json({
                message: 'Booking not found',
            });
        }
        // Only the equipment owner or an admin can change this booking.
        if (req.user.role !== 'admin' &&
            !idValues(req.user._id).some((id) => String(id) === String(booking.ownerId))) {
            return res.status(403).json({
                message: 'Not allowed',
            });
        }
        // Confirm only paid, pending bookings.
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
        // Reject only unpaid pending bookings.
        if (status === 'rejected') {
            if (booking.status !== 'pending') {
                return res.status(409).json({
                    message: 'Only pending bookings can be rejected',
                });
            }
            if (booking.paymentStatus === 'paid') {
                return res.status(409).json({
                    message: 'A refund must be processed before rejecting a paid booking',
                });
            }
        }
        // Cancel pending or confirmed bookings.
        if (status === 'cancelled') {
            if (!['pending', 'confirmed'].includes(booking.status)) {
                return res.status(409).json({
                    message: 'This booking cannot be cancelled',
                });
            }
            // Do not cancel paid bookings without refund handling.
            if (booking.paymentStatus === 'paid') {
                return res.status(409).json({
                    message: 'A refund must be processed before cancelling a paid booking',
                });
            }
        }
        // Complete rentals after their rental period ends.
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
        const updateFilter = {
            _id: bookingId,
            status: booking.status,
        };
        if (status === 'confirmed') {
            updateFilter.paymentStatus = 'paid';
        }
        const result = await db.collection('bookings').updateOne(updateFilter, {
            $set: {
                status,
                updatedAt: new Date(),
            },
        });
        if (result.modifiedCount === 0) {
            return res.status(409).json({
                message: 'Booking was updated by another request. Please refresh and try again.',
            });
        }
        res.json({
            message: 'Booking updated successfully',
        });
    }
    catch (error) {
        next(error);
    }
});
export default router;
