 
import { Router } from "express";
import { ObjectId } from "mongodb";

import { getDB } from "../db.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

function getUserFilter(user) {
  const conditions = [];

  if (user.id) {
    conditions.push({ _id: String(user.id) });

    if (ObjectId.isValid(String(user.id))) {
      conditions.push({
        _id: new ObjectId(String(user.id)),
      });
    }
  }

  if (user.email) {
    conditions.push({
      email: user.email.toLowerCase(),
    });
  }

  return conditions.length
    ? { $or: conditions }
    : { _id: null };
}

function safeUser(user, fallback = {}) {
  return {
    _id: String(user?._id || fallback.id || ""),
    id: String(user?._id || fallback.id || ""),
    name: user?.name || fallback.name || "",
    email: user?.email || fallback.email || "",
    image: user?.image || fallback.image || null,
    role: String(user?.role || fallback.role || "customer")
      .toLowerCase()
      .trim(),
    createdAt: user?.createdAt || null,
    updatedAt: user?.updatedAt || null,
  };
}

// GET CURRENT USER
router.get("/me", authenticate, async (req, res, next) => {
  try {
    const db = getDB();

    const user = await db.collection("users").findOne(
      getUserFilter(req.user),
      {
        projection: {
          password: 0,
          passwordHash: 0,
          accessToken: 0,
          refreshToken: 0,
          idToken: 0,
          verificationToken: 0,
        },
      }
    );

    return res.json({
      user: safeUser(user, req.user),
    });
  } catch (error) {
    next(error);
  }
});

// UPDATE CURRENT USER PROFILE
router.patch("/me", authenticate, async (req, res, next) => {
  try {
    const { name } = req.body || {};

    if (
      typeof name !== "string" ||
      name.trim().length < 2 ||
      name.trim().length > 80
    ) {
      return res.status(400).json({
        message: "Name must be between 2 and 80 characters",
      });
    }

    const db = getDB();
    const users = db.collection("users");

    const result = await users.updateOne(
      getUserFilter(req.user),
      {
        $set: {
          name: name.trim(),
          updatedAt: new Date(),
        },
      }
    );

    if (!result.matchedCount) {
      return res.status(404).json({
        message: "User profile not found",
      });
    }

    const updatedUser = await users.findOne(
      getUserFilter(req.user),
      {
        projection: {
          password: 0,
          passwordHash: 0,
          accessToken: 0,
          refreshToken: 0,
          idToken: 0,
          verificationToken: 0,
        },
      }
    );

    return res.json({
      message: "Profile updated successfully",
      user: safeUser(updatedUser, {
        ...req.user,
        name: name.trim(),
      }),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
