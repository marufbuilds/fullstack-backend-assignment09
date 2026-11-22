 import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import { getDB } from '../db.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// REGISTER
router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password } = req.body || {};

    if (
      typeof name !== 'string' ||
      name.trim().length < 2 ||
      typeof email !== 'string' ||
      !email.includes('@') ||
      typeof password !== 'string' ||
      password.length < 8
    ) {
      return res.status(400).json({
        message: 'Name, valid email and password (8+ characters) required',
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const users = getDB().collection('users');

    const existingUser = await users.findOne({ email: cleanEmail });

    if (existingUser) {
      return res.status(409).json({
        message: 'Email already registered',
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const newUser = {
      name: name.trim(),
      email: cleanEmail,
      passwordHash: hashedPassword,
      role: 'customer',
      createdAt: new Date(),
    };

    const result = await users.insertOne(newUser);

    const user = {
      _id: result.insertedId,
      name: newUser.name,
      email: newUser.email,
      role: newUser.role,
    };

    const token = jwt.sign(
      { userId: String(user._id) },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      user,
      token,
    });
  } catch (error) {
    next(error);
  }
});

// LOGIN
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};

    if (
      typeof email !== 'string' ||
      typeof password !== 'string'
    ) {
      return res.status(400).json({
        message: 'Email and password required',
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const users = getDB().collection('users');

    const user = await users.findOne({ email: cleanEmail });

    if (
      !user ||
      !user.passwordHash ||
      !(await bcrypt.compare(password, user.passwordHash))
    ) {
      return res.status(401).json({
        message: 'Email or password incorrect',
      });
    }

    const safeUser = {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    };

    const token = jwt.sign(
      { userId: String(user._id) },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      user: safeUser,
      token,
    });
  } catch (error) {
    next(error);
  }
});

// GET CURRENT USER
router.get('/me', authenticate, (req, res) => {
  return res.json({
    user: req.user,
  });
});

// UPDATE PROFILE
router.patch('/me', authenticate, async (req, res, next) => {
  try {
    const { name } = req.body || {};

    if (
      typeof name !== 'string' ||
      name.trim().length < 2 ||
      name.trim().length > 80
    ) {
      return res.status(400).json({
        message: 'Name must be between 2 and 80 characters',
      });
    }

    await getDB().collection('users').updateOne(
      { _id: req.user._id },
      {
        $set: {
          name: name.trim(),
          updatedAt: new Date(),
        },
      }
    );

    const updatedUser = {
      ...req.user,
      name: name.trim(),
    };

    return res.json({
      user: updatedUser,
    });
  } catch (error) {
    next(error);
  }
});

export default router;