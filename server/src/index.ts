 
import 'dotenv/config';
import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { fromNodeHeaders } from 'better-auth/node';
import { ObjectId } from 'mongodb';

import { connectDB } from './db.js';
import { createAuth } from './auth.js';

import equipmentRoutes from './routes/equipment.js';
import bookingRoutes from './routes/bookings.js';
import favoritesRoutes from './routes/favorites.js';
import ownerRoutes from './routes/owner.js';
import adminRoutes from './routes/admin.js';
import paymentRoutes from './routes/payments.js';
import { stripeWebhook } from './routes/webhook.js';

const app = express();

app.set('trust proxy', 1);

app.use(helmet());

app.use(
  cors({
    origin: (process.env.CLIENT_URL || 'http://localhost:3000')
      .split(',')
      .map(value => value.trim()),
    credentials: true,
  })
);

// Stripe webhook must be before express.json()
app.post(
  '/api/payments/webhook',
  express.raw({ type: 'application/json' }),
  stripeWebhook
);

app.use(express.json({ limit: '1mb' }));

let initializationPromise: Promise<void> | null = null;

async function initialize(): Promise<void> {
  const db = await connectDB();
  const auth = createAuth();

  app.locals.db = db;
  app.locals.auth = auth;
}

function ensureInitialized(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!initializationPromise) {
    initializationPromise = initialize();
  }

  initializationPromise
    .then(() => next())
    .catch((error: unknown) => {
      console.error('Server initialization failed:', error);
      initializationPromise = null;

      res.status(500).json({
        message: 'Server initialization failed',
      });
    });
}

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'Equiply API',
  });
});

// Initialize database and authentication before API routes
app.use(ensureInitialized);

// Profile: get current logged-in user
app.get('/api/profile', async (req, res) => {
  try {
    const auth = app.locals.auth;

    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session?.user?.id) {
      return res.status(401).json({
        message: 'Authentication required',
      });
    }

    return res.json({
      user: session.user,
    });
  } catch (error) {
    console.error('Profile fetch error:', error);

    return res.status(500).json({
      message: 'Could not load profile',
    });
  }
});

// Profile: update current logged-in user
app.patch('/api/profile', async (req, res) => {
  try {
    const auth = app.locals.auth;

    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session?.user?.id) {
      return res.status(401).json({
        message: 'Authentication required',
      });
    }

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

    const userId = String(session.user.id);

    const filter = ObjectId.isValid(userId)
      ? {
          $or: [
            { _id: userId },
            { _id: new ObjectId(userId) },
          ],
        }
      : { _id: userId };

    const result = await app.locals.db
      .collection('users')
      .updateOne(filter, {
        $set: {
          name: name.trim(),
          updatedAt: new Date(),
        },
      });

    if (result.matchedCount === 0) {
      return res.status(404).json({
        message: 'User profile not found',
      });
    }

    return res.json({
      message: 'Profile updated',
      name: name.trim(),
    });
  } catch (error) {
    console.error('Profile update error:', error);

    return res.status(500).json({
      message: 'Could not update profile',
    });
  }
});

// Better Auth
app.all('/api/auth/*', async (req, res) => {
  try {
    const auth = app.locals.auth;
    const { toNodeHandler } = await import('better-auth/node');

    return toNodeHandler(auth)(req, res);
  } catch (error) {
    console.error('Authentication error:', error);

    return res.status(500).json({
      message: 'Authentication failed',
    });
  }
});

// Payment rate limiter
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 200,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

// API routes
app.use('/api/equipment', equipmentRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/favorites', favoritesRoutes);
app.use('/api/owner', ownerRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/payments', paymentLimiter, paymentRoutes);

// 404
app.use((req, res) => {
  console.log('[404]', req.method, req.originalUrl);

  return res.status(404).json({
    message: 'Route not found',
    path: req.originalUrl,
  });
});

// Error handler
app.use((
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  console.error('Server error:', error);

  return res.status(500).json({
    message: 'Internal server error',
  });
});

export default app;

// Local development
if (process.env.NODE_ENV !== 'production') {
  const port = Number(process.env.PORT || 5000);

  app.listen(port, () => {
    console.log(`Equiply API running on port ${port}`);
  });
}
