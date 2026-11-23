 
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { toNodeHandler } from 'better-auth/node';

import { connectDB, getDB } from './db.js';
import { createAuth } from './auth.js';

import equipmentRoutes from './routes/equipment.js';
import bookingsRoutes from './routes/bookings.js';
import favoritesRoutes from './routes/favorites.js';
import adminRoutes from './routes/admin.js';
import paymentRoutes from './routes/payments.js';
import { stripeWebhook } from './routes/webhook.js';
import ownerRoutes from './routes/owner.js';

import { authenticate } from './middleware/auth.js';

const app = express();

app.set('trust proxy', 1);

// Required environment variables
const required = ['MONGODB_URI', 'BETTER_AUTH_SECRET'];
const missing = required.filter(key => !process.env[key]);

if (missing.length > 0) {
  console.error(
    `Missing required environment variables: ${missing.join(', ')}`
  );
  process.exit(1);
}

if (process.env.BETTER_AUTH_SECRET.length < 32) {
  console.error('BETTER_AUTH_SECRET must contain at least 32 characters.');
  process.exit(1);
}

// Security
app.use(helmet());

// CORS
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:3000')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error('Origin not allowed by CORS'));
    },
    credentials: true,
  })
);

// Request logging for debugging
app.use((req, res, next) => {
  console.log(`[REQUEST] ${req.method} ${req.originalUrl}`);
  next();
});

// Stripe webhook — raw body required
app.post(
  '/api/payments/webhook',
  express.raw({ type: 'application/json' }),
  stripeWebhook
);

// JSON body parser
app.use(express.json({ limit: '1mb' }));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// Profile GET
app.get('/api/profile', authenticate, (req, res) => {
  const { _id, ...user } = req.user;

  return res.json({
    user: {
      ...user,
      id: String(req.user._id),
    },
  });
});

// Profile PATCH
app.patch('/api/profile', authenticate, async (req, res, next) => {
  try {
    const name = req.body?.name;

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

    return res.json({
      message: 'Profile updated',
      name: name.trim(),
    });
  } catch (error) {
    next(error);
  }
});

// Equipment
app.use('/api/equipment', equipmentRoutes);

// Bookings
app.use('/api/bookings', bookingsRoutes);

// Favorites
app.use('/api/favorites', favoritesRoutes);

// Admin
app.use('/api/admin', adminRoutes);

// Owner
app.use('/api/owner', ownerRoutes);

// Payments
app.use(
  '/api/payments',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
  }),
  paymentRoutes
);

// Initialize database and authentication
const port = Number(process.env.PORT || 5000);

async function startServer() {
  try {
    await connectDB();

    const auth = createAuth();
    const authHandler = toNodeHandler(auth);

    // Better Auth routes
    app.all(
      '/api/auth/*',
      rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 80,
      }),
      authHandler
    );

    // 404 handler
    app.use((req, res) => {
      console.log('[404]', req.method, req.originalUrl);

      return res.status(404).json({
        message: 'Route not found',
        path: req.originalUrl,
        method: req.method,
      });
    });

    // Error handler
    app.use((error, req, res, next) => {
      if (res.headersSent) {
        return next(error);
      }

      if (error?.message === 'Origin not allowed by CORS') {
        return res.status(403).json({
          message: 'Origin not allowed',
        });
      }

      console.error('[SERVER ERROR]', error);

      return res.status(500).json({
        message: 'Server error',
      });
    });

    app.listen(port, () => {
      console.log('--------------------------------');
      console.log('Equiply backend started');
      console.log(`Port: ${port}`);
      console.log(`Health: http://localhost:${port}/api/health`);
      console.log(`Profile: http://localhost:${port}/api/profile`);
      console.log('--------------------------------');
    });
  } catch (error) {
    console.error('Backend startup failed:', error);
    process.exit(1);
  }
}

startServer();
