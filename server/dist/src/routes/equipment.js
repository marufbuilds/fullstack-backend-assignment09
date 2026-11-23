import { Router } from 'express';
import { ObjectId } from 'mongodb';
// Load JavaScript modules
import { getDB } from '../db.js';
import { authenticate, allowRoles } from '../middleware/auth.js';
const router = Router();
// Always convert route IDs into a single string
const getParamId = (req) => String(req.params.id ?? '');
const validId = (id) => ObjectId.isValid(id);
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ownerIdValues = (id) => {
    const values = [String(id)];
    if (ObjectId.isValid(String(id))) {
        values.push(new ObjectId(String(id)));
    }
    return values;
};
const ownerFilter = (id) => ({
    ownerId: { $in: ownerIdValues(id) },
});
// GET: All approved equipment
router.get('/', async (req, res, next) => {
    try {
        const { search, category, location, type, minPrice, maxPrice, availableFrom, availableTo, sort = 'newest', page = '1', limit = '12', } = req.query;
        const filter = { status: 'approved' };
        if (category)
            filter.category = String(category);
        if (location) {
            filter.location = {
                $regex: escapeRegex(String(location).slice(0, 100)),
                $options: 'i',
            };
        }
        if (minPrice !== undefined || maxPrice !== undefined) {
            const min = minPrice === undefined ? 0 : Number(minPrice);
            const max = maxPrice === undefined
                ? Number.MAX_SAFE_INTEGER
                : Number(maxPrice);
            if (!Number.isFinite(min) ||
                !Number.isFinite(max) ||
                min < 0 ||
                max < min) {
                return res.status(400).json({ message: 'Invalid price range' });
            }
            filter.price = { $gte: min, $lte: max };
        }
        // Check rental date availability
        if (availableFrom !== undefined || availableTo !== undefined) {
            const start = new Date(String(availableFrom));
            const end = new Date(String(availableTo));
            if (!availableFrom ||
                !availableTo ||
                !Number.isFinite(start.getTime()) ||
                !Number.isFinite(end.getTime()) ||
                end <= start) {
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
                    { status: 'pending', paymentStatus: 'paid' },
                    {
                        status: 'pending',
                        paymentStatus: 'unpaid',
                        expiresAt: { $gt: now },
                    },
                ],
            });
            filter._id = { $nin: conflicts };
        }
        if (type)
            filter.rentalType = String(type);
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
        if (!ordering[String(sort)]) {
            return res.status(400).json({ message: 'Invalid sort option' });
        }
        const p = Math.max(1, Math.min(1000, parseInt(String(page)) || 1));
        const l = Math.max(1, Math.min(30, parseInt(String(limit)) || 12));
        const collection = getDB().collection('equipment');
        const [items, total] = await Promise.all([
            collection
                .find(filter)
                .sort(ordering[String(sort)])
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
    }
    catch (error) {
        next(error);
    }
});
// GET: Single approved equipment
router.get('/:id', async (req, res, next) => {
    try {
        const id = getParamId(req);
        if (!validId(id)) {
            return res.status(400).json({ message: 'Invalid id' });
        }
        const item = await getDB().collection('equipment').findOne({
            _id: new ObjectId(id),
            status: 'approved',
        });
        if (!item) {
            return res.status(404).json({ message: 'Equipment not found' });
        }
        res.json(item);
    }
    catch (error) {
        next(error);
    }
});
// POST: Create equipment
router.post('/', authenticate, allowRoles('owner', 'admin'), async (req, res, next) => {
    try {
        const { title, description, category, location, price, rentalType, image, } = req.body || {};
        if (typeof title !== 'string' ||
            title.trim().length < 3 ||
            typeof description !== 'string' ||
            description.trim().length < 10 ||
            typeof category !== 'string' ||
            typeof location !== 'string' ||
            !Number.isFinite(Number(price)) ||
            Number(price) <= 0) {
            return res.status(400).json({
                message: 'Required fields and positive price are needed',
            });
        }
        const userId = String(req.user._id);
        const item = {
            title: title.trim().slice(0, 120),
            description: description.trim().slice(0, 3000),
            category,
            location: location.trim().slice(0, 150),
            price: Number(price),
            rentalType: rentalType || 'daily',
            image: image || '',
            ownerId: userId,
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
    }
    catch (error) {
        next(error);
    }
});
// GET: Owner equipment
router.get('/owner/mine', authenticate, allowRoles('owner', 'admin'), async (req, res, next) => {
    try {
        const user = req.user;
        const filter = user.role === 'admin'
            ? {}
            : ownerFilter(String(user._id));
        const items = await getDB()
            .collection('equipment')
            .find(filter)
            .sort({ createdAt: -1 })
            .toArray();
        res.json(items);
    }
    catch (error) {
        next(error);
    }
});
// PATCH: Update equipment
router.patch('/:id', authenticate, allowRoles('owner', 'admin'), async (req, res, next) => {
    try {
        const id = getParamId(req);
        if (!validId(id)) {
            return res.status(400).json({ message: 'Invalid id' });
        }
        const user = req.user;
        const db = getDB();
        const item = await db.collection('equipment').findOne({
            _id: new ObjectId(id),
        });
        if (!item) {
            return res.status(404).json({ message: 'Equipment not found' });
        }
        if (user.role !== 'admin' &&
            !ownerIdValues(String(user._id)).some((ownerId) => String(ownerId) === String(item.ownerId))) {
            return res.status(403).json({ message: 'Not allowed' });
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
            return res.status(400).json({ message: 'No fields to update' });
        }
        if (updates.title !== undefined) {
            if (typeof updates.title !== 'string' ||
                updates.title.trim().length < 3) {
                return res.status(400).json({
                    message: 'Title must contain at least 3 characters',
                });
            }
            updates.title = updates.title.trim().slice(0, 120);
        }
        if (updates.description !== undefined) {
            if (typeof updates.description !== 'string' ||
                updates.description.trim().length < 10) {
                return res.status(400).json({
                    message: 'Description must contain at least 10 characters',
                });
            }
            updates.description = updates.description.trim().slice(0, 3000);
        }
        for (const key of ['category', 'location', 'rentalType', 'image']) {
            if (updates[key] !== undefined && typeof updates[key] !== 'string') {
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
        if (user.role !== 'admin') {
            updates.status = 'pending';
        }
        await db.collection('equipment').updateOne({ _id: item._id }, { $set: updates });
        res.json({
            message: 'Equipment updated',
            equipment: { ...item, ...updates },
        });
    }
    catch (error) {
        next(error);
    }
});
// DELETE: Equipment
router.delete('/:id', authenticate, async (req, res, next) => {
    try {
        const id = getParamId(req);
        if (!validId(id)) {
            return res.status(400).json({ message: 'Invalid id' });
        }
        const user = req.user;
        const db = getDB();
        const item = await db.collection('equipment').findOne({
            _id: new ObjectId(id),
        });
        if (!item) {
            return res.status(404).json({ message: 'Not found' });
        }
        if (user.role !== 'admin' &&
            !ownerIdValues(String(user._id)).some((ownerId) => String(ownerId) === String(item.ownerId))) {
            return res.status(403).json({ message: 'Not allowed' });
        }
        await db.collection('equipment').deleteOne({
            _id: item._id,
        });
        res.json({ message: 'Equipment deleted' });
    }
    catch (error) {
        next(error);
    }
});
export default router;
