import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { getDB } from '../db.js';
import { authenticate, allowRoles } from '../middleware/auth.js';
const router = Router();
router.use(authenticate, allowRoles('admin'));
router.get('/stats', async (req, res, next) => {
    try {
        const db = getDB();
        const [users, equipment, bookings, paidPayments] = await Promise.all([
            db.collection('users').countDocuments(),
            db.collection('equipment').countDocuments(),
            db.collection('bookings').countDocuments(),
            db.collection('payments').countDocuments({ status: 'paid' }),
        ]);
        res.json({ users, equipment, bookings, paidPayments });
    }
    catch (error) {
        next(error);
    }
});
router.get('/users', async (req, res, next) => {
    try {
        const users = await getDB().collection('users')
            .find({}, { projection: { password: 0, passwordHash: 0 } })
            .sort({ createdAt: -1 }).limit(500).toArray();
        res.json(users);
    }
    catch (error) {
        next(error);
    }
});
router.patch('/users/:id/role', async (req, res, next) => {
    try {
        const { id } = req.params;
        if (!ObjectId.isValid(id))
            return res.status(400).json({ message: 'Invalid id' });
        const role = req.body?.role;
        if (!['customer', 'owner', 'admin'].includes(role))
            return res.status(400).json({ message: 'Invalid role' });
        if (String(req.user._id) === id && role !== 'admin')
            return res.status(400).json({ message: 'Cannot remove your own admin role' });
        const result = await getDB().collection('users').updateOne({ _id: new ObjectId(id) }, { $set: { role, updatedAt: new Date() } });
        if (!result.matchedCount)
            return res.status(404).json({ message: 'User not found' });
        res.json({ message: 'Role updated' });
    }
    catch (error) {
        next(error);
    }
});
router.get('/equipment', async (req, res, next) => {
    try {
        res.json(await getDB().collection('equipment').find({}).sort({ createdAt: -1 }).limit(500).toArray());
    }
    catch (error) {
        next(error);
    }
});
router.patch('/equipment/:id/status', async (req, res, next) => {
    try {
        if (!ObjectId.isValid(req.params.id))
            return res.status(400).json({ message: 'Invalid id' });
        const status = req.body?.status;
        if (!['approved', 'rejected', 'pending'].includes(status))
            return res.status(400).json({ message: 'Invalid status' });
        const result = await getDB().collection('equipment').updateOne({ _id: new ObjectId(req.params.id) }, { $set: { status, reviewedAt: new Date(), reviewedBy: req.user._id, updatedAt: new Date() } });
        if (!result.matchedCount)
            return res.status(404).json({ message: 'Equipment not found' });
        res.json({ message: 'Equipment status updated' });
    }
    catch (error) {
        next(error);
    }
});
router.get('/bookings', async (req, res, next) => {
    try {
        res.json(await getDB().collection('bookings').find({}).sort({ createdAt: -1 }).limit(500).toArray());
    }
    catch (error) {
        next(error);
    }
});
export default router;
