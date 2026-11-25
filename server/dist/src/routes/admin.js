import express from "express";
import { ObjectId } from "mongodb";
import { fromNodeHeaders } from "better-auth/node";
import { getDB } from "../db.js";
import { createAuth } from "../auth.js";
const router = express.Router();
const validRoles = ["customer", "owner", "admin"];
const validEquipmentStatuses = ["pending", "approved", "rejected"];
// --------------------------------------------------
// Helpers
// --------------------------------------------------
function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function getIdValues(id) {
    const values = [id];
    if (ObjectId.isValid(id)) {
        values.push(new ObjectId(id));
    }
    return values;
}
function getIdFilter(id) {
    return {
        $or: [
            { _id: id },
            ...(ObjectId.isValid(id) ? [{ _id: new ObjectId(id) }] : []),
        ],
    };
}
function getPagination(req) {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
    return {
        page,
        limit,
        skip: (page - 1) * limit,
    };
}
// --------------------------------------------------
// Admin authentication
// --------------------------------------------------
async function authenticateAdmin(req, res, next) {
    try {
        const auth = createAuth();
        const session = await auth.api.getSession({
            headers: fromNodeHeaders(req.headers),
        });
        if (!session?.user) {
            return res.status(401).json({
                message: "Please login first",
            });
        }
        const db = getDB();
        const users = db.collection("users");
        const sessionUser = session.user;
        const userId = String(sessionUser.id || "");
        const conditions = [];
        if (userId) {
            conditions.push({ _id: userId });
            if (ObjectId.isValid(userId)) {
                conditions.push({
                    _id: new ObjectId(userId),
                });
            }
        }
        if (sessionUser.email) {
            conditions.push({
                email: sessionUser.email.toLowerCase(),
            });
        }
        if (conditions.length === 0) {
            return res.status(401).json({
                message: "Invalid user session",
            });
        }
        const dbUser = await users.findOne({
            $or: conditions,
        });
        if (!dbUser) {
            return res.status(401).json({
                message: "User account not found",
            });
        }
        if (String(dbUser.role || "customer").toLowerCase() !== "admin") {
            return res.status(403).json({
                message: "Admin access required",
            });
        }
        req.user = {
            ...sessionUser,
            ...dbUser,
            id: userId,
        };
        next();
    }
    catch (error) {
        next(error);
    }
}
// Protect every admin endpoint.
router.use(authenticateAdmin);
// --------------------------------------------------
// GET ADMIN STATISTICS
// GET /api/admin/stats
// --------------------------------------------------
router.get("/stats", async (req, res, next) => {
    try {
        const db = getDB();
        const users = db.collection("users");
        const equipment = db.collection("equipment");
        const bookings = db.collection("bookings");
        const [totalUsers, customers, owners, admins, totalEquipment, pendingEquipment, approvedEquipment, rejectedEquipment, totalBookings, pendingBookings, confirmedBookings, completedBookings, cancelledBookings, revenueResult,] = await Promise.all([
            users.countDocuments(),
            users.countDocuments({ role: "customer" }),
            users.countDocuments({ role: "owner" }),
            users.countDocuments({ role: "admin" }),
            equipment.countDocuments(),
            equipment.countDocuments({ status: "pending" }),
            equipment.countDocuments({ status: "approved" }),
            equipment.countDocuments({ status: "rejected" }),
            bookings.countDocuments(),
            bookings.countDocuments({ status: "pending" }),
            bookings.countDocuments({ status: "confirmed" }),
            bookings.countDocuments({ status: "completed" }),
            bookings.countDocuments({ status: "cancelled" }),
            bookings.aggregate([
                {
                    $match: {
                        paymentStatus: "paid",
                    },
                },
                {
                    $group: {
                        _id: null,
                        totalRevenue: {
                            $sum: {
                                $ifNull: ["$totalPrice", "$totalAmount"],
                            },
                        },
                    },
                },
            ]).toArray(),
        ]);
        return res.json({
            stats: {
                totalUsers,
                customers,
                owners,
                admins,
                totalEquipment,
                pendingEquipment,
                approvedEquipment,
                rejectedEquipment,
                totalBookings,
                pendingBookings,
                confirmedBookings,
                completedBookings,
                cancelledBookings,
                totalRevenue: revenueResult[0]?.totalRevenue || 0,
            },
        });
    }
    catch (error) {
        next(error);
    }
});
// --------------------------------------------------
// GET ALL USERS
// GET /api/admin/users
// --------------------------------------------------
router.get("/users", async (req, res, next) => {
    try {
        const db = getDB();
        const usersCollection = db.collection("users");
        const { page, limit, skip } = getPagination(req);
        const search = String(req.query.search || "").trim();
        const role = String(req.query.role || "").trim().toLowerCase();
        /** @type {Record<string, any>} */
        const filter = {};
        if (role && validRoles.includes(role)) {
            filter.role = role;
        }
        if (search) {
            const searchConditions = [
                { name: { $regex: escapeRegex(search), $options: "i" } },
                { email: { $regex: escapeRegex(search), $options: "i" } },
            ];
            if (filter.role) {
                filter.$and = [
                    { role: filter.role },
                    { $or: searchConditions },
                ];
                delete filter.role;
            }
            else {
                filter.$or = searchConditions;
            }
        }
        const [users, total] = await Promise.all([
            usersCollection
                .find(filter, {
                projection: {
                    password: 0,
                    passwordHash: 0,
                    accessToken: 0,
                    refreshToken: 0,
                    idToken: 0,
                    token: 0,
                    verificationToken: 0,
                },
            })
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .toArray(),
            usersCollection.countDocuments(filter),
        ]);
        return res.json({
            users: users.map((user) => ({
                ...user,
                _id: String(user._id),
                id: String(user._id),
            })),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    }
    catch (error) {
        next(error);
    }
});
// --------------------------------------------------
// UPDATE USER ROLE
// PATCH /api/admin/users/:id/role
// --------------------------------------------------
router.patch("/users/:id/role", async (req, res, next) => {
    try {
        const id = String(req.params.id || "").trim();
        const role = String(req.body?.role || "")
            .trim()
            .toLowerCase();
        if (!id) {
            return res.status(400).json({
                message: "Invalid user ID",
            });
        }
        if (!validRoles.includes(role)) {
            return res.status(400).json({
                message: "Invalid role. Use customer, owner or admin.",
            });
        }
        const users = getDB().collection("users");
        const currentAdmin = req.user;
        if (!currentAdmin) {
            return res.status(401).json({
                message: "Please login first",
            });
        }
        const targetUser = await users.findOne({
            $or: [
                ...getIdValues(id).map((value) => ({ _id: value })),
                { email: id.toLowerCase() },
            ],
        });
        if (!targetUser) {
            return res.status(404).json({
                message: "User not found",
            });
        }
        if (String(targetUser._id) === String(currentAdmin._id)) {
            return res.status(403).json({
                message: "You cannot change your own role",
            });
        }
        await users.updateOne({ _id: targetUser._id }, {
            $set: {
                role,
                updatedAt: new Date(),
            },
        });
        const updatedUser = await users.findOne({ _id: targetUser._id }, {
            projection: {
                password: 0,
                passwordHash: 0,
                accessToken: 0,
                refreshToken: 0,
                idToken: 0,
                token: 0,
                verificationToken: 0,
            },
        });
        return res.json({
            message: "User role updated successfully",
            user: {
                id: String(updatedUser?._id),
                _id: String(updatedUser?._id),
                name: updatedUser?.name,
                email: updatedUser?.email,
                role: updatedUser?.role,
            },
        });
    }
    catch (error) {
        next(error);
    }
});
// --------------------------------------------------
// GET ALL EQUIPMENT
// GET /api/admin/equipment
// --------------------------------------------------
router.get("/equipment", async (req, res, next) => {
    try {
        const equipmentCollection = getDB().collection("equipment");
        const { page, limit, skip } = getPagination(req);
        const status = String(req.query.status || "")
            .trim()
            .toLowerCase();
        /** @type {Record<string, any>} */
        const filter = {};
        if (status && validEquipmentStatuses.includes(status)) {
            filter.status = status;
        }
        const [equipment, total] = await Promise.all([
            equipmentCollection
                .find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .toArray(),
            equipmentCollection.countDocuments(filter),
        ]);
        return res.json({
            equipment: equipment.map((item) => ({
                ...item,
                _id: String(item._id),
                id: String(item._id),
            })),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    }
    catch (error) {
        next(error);
    }
});
// --------------------------------------------------
// UPDATE EQUIPMENT STATUS
// PATCH /api/admin/equipment/:id/status
// --------------------------------------------------
router.patch("/equipment/:id/status", async (req, res, next) => {
    try {
        const id = String(req.params.id || "").trim();
        const status = String(req.body?.status || "")
            .trim()
            .toLowerCase();
        if (!id) {
            return res.status(400).json({
                message: "Invalid equipment ID",
            });
        }
        if (!validEquipmentStatuses.includes(status)) {
            return res.status(400).json({
                message: "Status must be pending, approved or rejected",
            });
        }
        const equipmentCollection = getDB().collection("equipment");
        const result = await equipmentCollection.findOneAndUpdate(getIdFilter(id), {
            $set: {
                status,
                updatedAt: new Date(),
            },
        }, {
            returnDocument: "after",
        });
        const updatedEquipment = result?.value ?? result;
        if (!updatedEquipment) {
            return res.status(404).json({
                message: "Equipment not found",
            });
        }
        return res.json({
            message: `Equipment ${status} successfully`,
            equipment: {
                ...updatedEquipment,
                _id: String(updatedEquipment._id),
                id: String(updatedEquipment._id),
            },
        });
    }
    catch (error) {
        next(error);
    }
});
// --------------------------------------------------
// UPDATE EQUIPMENT DETAILS
// PATCH /api/admin/equipment/:id
// --------------------------------------------------
router.patch("/equipment/:id", async (req, res, next) => {
    try {
        const id = String(req.params.id || "").trim();
        if (!id) {
            return res.status(400).json({
                message: "Invalid equipment ID",
            });
        }
        const body = req.body || {};
        /** @type {Record<string, any>} */
        const updates = {};
        // Do not allow changing protected MongoDB fields.
        const protectedFields = [
            "_id",
            "id",
            "ownerId",
            "userId",
            "createdAt",
            "updatedAt",
        ];
        for (const [key, value] of Object.entries(body)) {
            if (!protectedFields.includes(key)) {
                updates[key] = value;
            }
        }
        if (updates.price !== undefined) {
            const price = Number(updates.price);
            if (!Number.isFinite(price) || price < 0) {
                return res.status(400).json({
                    message: "Invalid equipment price",
                });
            }
            updates.price = price;
        }
        if (Object.keys(updates).length === 0) {
            return res.status(400).json({
                message: "No valid fields provided",
            });
        }
        updates.updatedAt = new Date();
        const equipmentCollection = getDB().collection("equipment");
        const result = await equipmentCollection.findOneAndUpdate(getIdFilter(id), {
            $set: updates,
        }, {
            returnDocument: "after",
        });
        const updatedEquipment = result?.value ?? result;
        if (!updatedEquipment) {
            return res.status(404).json({
                message: "Equipment not found",
            });
        }
        return res.json({
            message: "Equipment updated successfully",
            equipment: {
                ...updatedEquipment,
                _id: String(updatedEquipment._id),
                id: String(updatedEquipment._id),
            },
        });
    }
    catch (error) {
        next(error);
    }
});
// --------------------------------------------------
// DELETE EQUIPMENT
// DELETE /api/admin/equipment/:id
// --------------------------------------------------
router.delete("/equipment/:id", async (req, res, next) => {
    try {
        const id = String(req.params.id || "").trim();
        if (!id) {
            return res.status(400).json({
                message: "Invalid equipment ID",
            });
        }
        const equipmentCollection = getDB().collection("equipment");
        const result = await equipmentCollection.deleteOne(getIdFilter(id));
        if (result.deletedCount === 0) {
            return res.status(404).json({
                message: "Equipment not found",
            });
        }
        return res.json({
            message: "Equipment deleted successfully",
        });
    }
    catch (error) {
        next(error);
    }
});
// --------------------------------------------------
// GET ALL BOOKINGS
// GET /api/admin/bookings
// --------------------------------------------------
router.get("/bookings", async (req, res, next) => {
    try {
        const bookingsCollection = getDB().collection("bookings");
        const { page, limit, skip } = getPagination(req);
        const status = String(req.query.status || "")
            .trim()
            .toLowerCase();
        const paymentStatus = String(req.query.paymentStatus || "")
            .trim()
            .toLowerCase();
        /** @type {Record<string, any>} */
        const filter = {};
        if (status) {
            filter.status = status;
        }
        if (paymentStatus) {
            filter.paymentStatus = paymentStatus;
        }
        const [bookings, total] = await Promise.all([
            bookingsCollection
                .find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .toArray(),
            bookingsCollection.countDocuments(filter),
        ]);
        return res.json({
            bookings: bookings.map((booking) => ({
                ...booking,
                _id: String(booking._id),
                id: String(booking._id),
            })),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    }
    catch (error) {
        next(error);
    }
});
// --------------------------------------------------
// EXPORT ROUTER
// --------------------------------------------------
export default router;
