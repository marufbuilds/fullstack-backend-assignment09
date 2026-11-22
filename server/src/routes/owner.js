import { Router } from 'express';
import { getDB } from '../db.js';
import { authenticate, allowRoles } from '../middleware/auth.js';

const router = Router();
router.use(authenticate, allowRoles('owner', 'admin'));

router.get('/analytics', async (req, res, next) => {
  try {
    const db = getDB();
    const ownerId = req.user._id;
    const [listingCount, completedRentals, paidBookings, monthly] = await Promise.all([
      db.collection('equipment').countDocuments({ ownerId }),
      db.collection('bookings').countDocuments({ ownerId, status: 'completed' }),
      db.collection('bookings').find({ ownerId, paymentStatus: 'paid' }).toArray(),
      db.collection('bookings').aggregate([
        { $match: { ownerId, paymentStatus: 'paid', paidAt: { $type: 'date' } } },
        { $group: {
          _id: { year: { $year: '$paidAt' }, month: { $month: '$paidAt' } },
          earnings: { $sum: '$amount' },
          rentals: { $sum: 1 }
        } },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
        { $limit: 24 }
      ]).toArray()
    ]);

    const totalEarnings = paidBookings.reduce((sum, booking) => sum + Number(booking.amount || 0), 0);
    res.json({
      listingCount,
      completedRentals,
      paidRentals: paidBookings.length,
      totalEarnings: Number(totalEarnings.toFixed(2)),
      monthlyEarnings: monthly.map(row => ({
        year: row._id.year,
        month: row._id.month,
        earnings: Number(Number(row.earnings || 0).toFixed(2)),
        rentals: row.rentals
      }))
    });
  } catch (error) {
    next(error);
  }
});

export default router;
