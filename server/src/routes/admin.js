 
import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { getDB } from '../db.js';
import { authenticate, allowRoles } from '../middleware/auth.js';

const router = Router();

// Every route in this file requires an authenticated Admin.
router.use(authenticate, allowRoles('admin'));

const validRoles = ['customer', 'owner', 'admin'];
const validEquipmentStatuses = ['pending', 'approved', 'rejected'];

// --------------------------------------------------
// 1. ADMIN DASHBOARD STATISTICS
// GET /api/admin/stats
// --------------------------------------------------

router.get('/stats', async (req, res, next) => {
  try {
    const db = getDB();

    const usersCollection = db.collection('users');
    const equipmentCollection = db.collection('equipment');
    const bookingsCollection = db.collection('bookings');
    const paymentsCollection = db.collection('payments');

    const [
      totalUsers,
      totalEquipment,
      totalBookings,
      pendingApprovals,
      completedRentals,
      paidPayments,
      monthlyBookings,
    ] = await Promise.all([
      usersCollection.countDocuments(),

      equipmentCollection.countDocuments(),

      bookingsCollection.countDocuments(),

      equipmentCollection.countDocuments({
        status: 'pending',
      }),

      bookingsCollection.countDocuments({
        status: 'completed',
      }),

      paymentsCollection.aggregate([
        {
          $match: {
            status: 'paid',
          },
        },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: '$amount' },
            totalPaidPayments: { $sum: 1 },
          },
        },
      ]).toArray(),

      bookingsCollection.aggregate([
        {
          $match: {
            createdAt: { $type: 'date' },
          },
        },
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' },
            },
            totalBookings: { $sum: 1 },
          },
        },
        {
          $sort: {
            '_id.year': 1,
            '_id.month': 1,
          },
        },
      ]).toArray(),
    ]);

    const paymentStats = paidPayments[0] || {
      totalRevenue: 0,
      totalPaidPayments: 0,
    };

    return res.json({
      totalUsers,
      totalEquipment,
      totalBookings,
      pendingApprovals,
      completedRentals,
      totalRevenue: paymentStats.totalRevenue || 0,
      totalPaidPayments: paymentStats.totalPaidPayments || 0,
      monthlyBookings: monthlyBookings.map((item) => ({
        year: item._id.year,
        month: item._id.month,
        bookings: item.totalBookings,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

// --------------------------------------------------
// 2. GET ALL USERS
// GET /api/admin/users
// --------------------------------------------------

router.get('/users', async (req, res, next) => {
  try {
    const users = await getDB()
      .collection('users')
      .find(
        {},
        {
          projection: {
            password: 0,
            passwordHash: 0,
            accessToken: 0,
            refreshToken: 0,
            idToken: 0,
          },
        }
      )
      .sort({ createdAt: -1 })
      .limit(500)
      .toArray();

    return res.json(users);
  } catch (error) {
    return next(error);
  }
});

// --------------------------------------------------
// 3. CHANGE USER ROLE
// PATCH /api/admin/users/:id/role
// --------------------------------------------------

router.patch('/users/:id/role', async (req, res, next) => {
  try {
    const { id } = req.params;
    const role = String(req.body?.role || '').trim().toLowerCase();

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        message: 'Invalid user ID',
      });
    }

    if (!validRoles.includes(role)) {
      return res.status(400).json({
        message: 'Invalid role. Use customer, owner or admin.',
      });
    }

    // Prevent an Admin from changing their own role.
    if (String(req.user._id) === id) {
      return res.status(403).json({
        message: 'You cannot change your own role',
      });
    }

    const result = await getDB()
      .collection('users')
      .updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            role,
            updatedAt: new Date(),
          },
        }
      );

    if (!result.matchedCount) {
      return res.status(404).json({
        message: 'User not found',
      });
    }

    return res.json({
      message: 'User role updated successfully',
      userId: id,
      role,
    });
  } catch (error) {
    return next(error);
  }
});

// --------------------------------------------------
// 4. GET ALL EQUIPMENT
// GET /api/admin/equipment
// --------------------------------------------------

router.get('/equipment', async (req, res, next) => {
  try {
    const equipment = await getDB()
      .collection('equipment')
      .find({})
      .sort({ createdAt: -1 })
      .limit(500)
      .toArray();

    return res.json(equipment);
  } catch (error) {
    return next(error);
  }
});

// --------------------------------------------------
// 5. APPROVE / REJECT EQUIPMENT
// PATCH /api/admin/equipment/:id/status
// --------------------------------------------------

router.patch('/equipment/:id/status', async (req, res, next) => {
  try {
    const { id } = req.params;
    const status = String(req.body?.status || '')
      .trim()
      .toLowerCase();

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        message: 'Invalid equipment ID',
      });
    }

    if (!validEquipmentStatuses.includes(status)) {
      return res.status(400).json({
        message: 'Status must be pending, approved or rejected',
      });
    }

    const result = await getDB()
      .collection('equipment')
      .updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            status,
            reviewedAt: new Date(),
            reviewedBy: req.user._id,
            updatedAt: new Date(),
          },
        }
      );

    if (!result.matchedCount) {
      return res.status(404).json({
        message: 'Equipment not found',
      });
    }

    return res.json({
      message: `Equipment ${status} successfully`,
      equipmentId: id,
      status,
    });
  } catch (error) {
    return next(error);
  }
});

// --------------------------------------------------
// 6. UPDATE EQUIPMENT
// PATCH /api/admin/equipment/:id
// --------------------------------------------------

router.patch('/equipment/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        message: 'Invalid equipment ID',
      });
    }

    const allowedFields = [
      'title',
      'name',
      'description',
      'category',
      'price',
      'pricePerDay',
      'location',
      'image',
      'images',
      'brand',
      'model',
      'condition',
      'quantity',
      'availableQuantity',
      'rentalType',
    ];

    const updates = {};

    for (const field of allowedFields) {
      if (req.body?.[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        message: 'No valid equipment fields provided',
      });
    }

    updates.updatedAt = new Date();

    const result = await getDB()
      .collection('equipment')
      .updateOne(
        { _id: new ObjectId(id) },
        { $set: updates }
      );

    if (!result.matchedCount) {
      return res.status(404).json({
        message: 'Equipment not found',
      });
    }

    return res.json({
      message: 'Equipment updated successfully',
    });
  } catch (error) {
    return next(error);
  }
});

// --------------------------------------------------
// 7. DELETE EQUIPMENT
// DELETE /api/admin/equipment/:id
// --------------------------------------------------

router.delete('/equipment/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        message: 'Invalid equipment ID',
      });
    }

    const result = await getDB()
      .collection('equipment')
      .deleteOne({
        _id: new ObjectId(id),
      });

    if (!result.deletedCount) {
      return res.status(404).json({
        message: 'Equipment not found',
      });
    }

    return res.json({
      message: 'Equipment deleted successfully',
    });
  } catch (error) {
    return next(error);
  }
});

// --------------------------------------------------
// 8. GET ALL BOOKINGS
// GET /api/admin/bookings
// --------------------------------------------------

router.get('/bookings', async (req, res, next) => {
  try {
    const bookings = await getDB()
      .collection('bookings')
      .find({})
      .sort({ createdAt: -1 })
      .limit(500)
      .toArray();

    return res.json(bookings);
  } catch (error) {
    return next(error);
  }
});

export default router;
