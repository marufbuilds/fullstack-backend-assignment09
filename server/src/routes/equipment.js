 
import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { getDB } from '../db.js';
import { authenticate, allowRoles } from '../middleware/auth.js';
import { idValues, normalizeId, ownerFilter } from '../lib/ids.js';

const router = Router();

const validId = (id) => ObjectId.isValid(id);

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Get approved equipment
router.get('/', async (req, res, next) => {
  try {
    const {
      search,
      category,
      location,
      type,
      minPrice,
      maxPrice,
      availableFrom,
      availableTo,
      sort = 'newest',
      page = '1',
      limit = '12',
    } = req.query;

    const filter = { status: 'approved' };

    if (category) filter.category = String(category);

    if (location) {
      filter.location = {
        $regex: escapeRegex(String(location).slice(0, 100)),
        $options: 'i',
      };
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
      const min = minPrice === undefined ? 0 : Number(minPrice);
      const max =
        maxPrice === undefined ? Number.MAX_SAFE_INTEGER : Number(maxPrice);

      if (
        !Number.isFinite(min) ||
        !Number.isFinite(max) ||
        min < 0 ||
        max < min
      ) {
        return res.status(400).json({
          message: 'Invalid price range',
        });
      }

      filter.price = { $gte: min, $lte: max };
    }

    // Filter equipment based on rental availability.
    if (availableFrom !== undefined || availableTo !== undefined) {
      const start = new Date(availableFrom);
      const end = new Date(availableTo);

      if (
        !availableFrom ||
        !availableTo ||
        !Number.isFinite(start.getTime()) ||
        !Number.isFinite(end.getTime()) ||
        end <= start
      ) {
        return res.status(400).json({
          message: 'Provide a valid availableFrom and availableTo range',
        });
      }

      const now = new Date();

      const conflicts = await getDB()
        .collection('bookings')
        .distinct('equipmentId', {
          startDate: { $lt: end },
          endDate: { $gt: start },
          $or: [
            { status: 'confirmed' },
            {
              status: 'pending',
              paymentStatus: 'paid',
            },
            {
              status: 'pending',
              paymentStatus: 'unpaid',
              expiresAt: { $gt: now },
            },
          ],
        });

      filter._id = { $nin: conflicts };
    }

    if (type) filter.rentalType = String(type);

    if (search) {
      const term = escapeRegex(String(search).slice(0, 100));

      filter.$or = [
        { title: { $regex: term, $options: 'i' } },
        { category: { $regex: term, $options: 'i' } },
        { location: { $regex: term, $options: 'i' } },
      ];
    }

    const ordering = {
      'price-low': { price: 1 },
      'price-high': { price: -1 },
      newest: { createdAt: -1 },
    };

    if (!ordering[sort]) {
      return res.status(400).json({
        message: 'Invalid sort option',
      });
    }

    const p = Math.max(1, Math.min(1000, parseInt(page) || 1));
    const l = Math.max(1, Math.min(30, parseInt(limit) || 12));

    const collection = getDB().collection('equipment');

    const [items, total] = await Promise.all([
      collection
        .find(filter)
        .sort(ordering[sort])
        .skip((p - 1) * l)
        .limit(l)
        .toArray(),

      collection.countDocuments(filter),
    ]);

    res.json({
      items,
      total,
      page: p,
      pages: Math.ceil(total / l),
    });
  } catch (error) {
    next(error);
  }
});

// Get single approved equipment
router.get('/:id', async (req, res, next) => {
  try {
    const id = String(req.params.id ?? '');
    if (!validId(id)) {
      return res.status(400).json({
        message: 'Invalid id',
      });
    }

    const item = await getDB().collection('equipment').findOne({
      _id: new ObjectId(id),
      status: 'approved',
    });

    if (!item) {
      return res.status(404).json({
        message: 'Equipment not found',
      });
    }

    res.json(item);
  } catch (error) {
    next(error);
  }
});

// Create equipment
router.post(
  '/',
  authenticate,
  allowRoles('owner', 'admin'),
  async (req, res, next) => {
    try {
      const {
        title,
        description,
        category,
        location,
        price,
        rentalType,
        image,
      } = req.body || {};

      if (
        typeof title !== 'string' ||
        title.trim().length < 3 ||
        typeof description !== 'string' ||
        description.trim().length < 10 ||
        typeof category !== 'string' ||
        typeof location !== 'string' ||
        !Number.isFinite(Number(price)) ||
        Number(price) <= 0
      ) {
        return res.status(400).json({
          message: 'Required fields and positive price are needed',
        });
      }

      const item = {
        title: title.trim().slice(0, 120),
        description: description.trim().slice(0, 3000),
        category: String(category),
        location: location.trim().slice(0, 150),
        price: Number(price),
        rentalType: rentalType || 'daily',
        image: image || '',

        // Standardize new owner IDs to strings.
        ownerId: normalizeId(req.user._id),

        status: 'pending',
        createdAt: new Date(),
      };

      const result = await getDB()
        .collection('equipment')
        .insertOne(item);

      res.status(201).json({
        ...item,
        _id: result.insertedId,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get owner's equipment
router.get(
  '/owner/mine',
  authenticate,
  allowRoles('owner', 'admin'),
  async (req, res, next) => {
    try {
      const filter =
        req.user.role === 'admin'
          ? {}
          : ownerFilter(req.user._id);

      const items = await getDB()
        .collection('equipment')
        .find(filter)
        .sort({ createdAt: -1 })
        .toArray();

      res.json(items);
    } catch (error) {
      next(error);
    }
  }
);

// Update equipment
router.patch(
  '/:id',
  authenticate,
  allowRoles('owner', 'admin'),
  async (req, res, next) => {
    try {
      const id = String(req.params.id ?? '');
    if (!validId(id)) {
        return res.status(400).json({
          message: 'Invalid id',
        });
      }

      const db = getDB();

      const item = await db.collection('equipment').findOne({
        _id: new ObjectId(id),
      });

      if (!item) {
        return res.status(404).json({
          message: 'Equipment not found',
        });
      }

      if (
        req.user.role !== 'admin' &&
        !idValues(req.user._id).some(
          (id) => String(id) === String(item.ownerId)
        )
      ) {
        return res.status(403).json({
          message: 'Not allowed',
        });
      }

      const allowed = [
        'title',
        'description',
        'category',
        'location',
        'price',
        'rentalType',
        'image',
      ];

      const updates = {};

      for (const key of allowed) {
        if (req.body?.[key] !== undefined) {
          updates[key] = req.body[key];
        }
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({
          message: 'No fields to update',
        });
      }

      if (updates.title !== undefined) {
        if (
          typeof updates.title !== 'string' ||
          updates.title.trim().length < 3
        ) {
          return res.status(400).json({
            message: 'Title must contain at least 3 characters',
          });
        }

        updates.title = updates.title.trim().slice(0, 120);
      }

      if (updates.description !== undefined) {
        if (
          typeof updates.description !== 'string' ||
          updates.description.trim().length < 10
        ) {
          return res.status(400).json({
            message: 'Description must contain at least 10 characters',
          });
        }

        updates.description = updates.description.trim().slice(0, 3000);
      }

      for (const key of ['category', 'location', 'rentalType', 'image']) {
        if (
          updates[key] !== undefined &&
          typeof updates[key] !== 'string'
        ) {
          return res.status(400).json({
            message: `${key} must be text`,
          });
        }
      }

      if (updates.price !== undefined) {
        updates.price = Number(updates.price);

        if (!Number.isFinite(updates.price) || updates.price <= 0) {
          return res.status(400).json({
            message: 'Price must be positive',
          });
        }
      }

      updates.updatedAt = new Date();

      // Owner edits require moderation again.
      if (req.user.role !== 'admin') {
        updates.status = 'pending';
      }

      await db.collection('equipment').updateOne(
        { _id: item._id },
        { $set: updates }
      );

      res.json({
        message: 'Equipment updated',
        equipment: { ...item, ...updates },
      });
    } catch (error) {
      next(error);
    }
  }
);

// Delete equipment
router.delete(
  '/:id',
  authenticate,
  async (req, res, next) => {
    try {
      const id = String(req.params.id ?? '');
    if (!validId(id)) {
        return res.status(400).json({
          message: 'Invalid id',
        });
      }

      const db = getDB();

      const item = await db.collection('equipment').findOne({
        _id: new ObjectId(id),
      });

      if (!item) {
        return res.status(404).json({
          message: 'Not found',
        });
      }

      if (
        req.user.role !== 'admin' &&
        !idValues(req.user._id).some(
          (id) => String(id) === String(item.ownerId)
        )
      ) {
        return res.status(403).json({
          message: 'Not allowed',
        });
      }

      await db.collection('equipment').deleteOne({
        _id: item._id,
      });

      res.json({
        message: 'Equipment deleted',
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
