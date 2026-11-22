import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { toNodeHandler } from 'better-auth/node';
import { connectDB } from './db.js';
import { createAuth } from './auth.js';
import equipmentRoutes from './routes/equipment.js';
import bookingsRoutes from './routes/bookings.js';
import favoritesRoutes from './routes/favorites.js';
import adminRoutes from './routes/admin.js';
import paymentRoutes from './routes/payments.js';
import { stripeWebhook } from './routes/webhook.js';
import ownerRoutes from './routes/owner.js';
import { authenticate } from './middleware/auth.js';
import { getDB } from './db.js';

const app = express();
const required = ['MONGODB_URI', 'BETTER_AUTH_SECRET'];
const missing = required.filter(key => !process.env[key]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}
if (process.env.BETTER_AUTH_SECRET.length < 32) {
  console.error('BETTER_AUTH_SECRET must contain at least 32 characters.');
  process.exit(1);
}

app.use(helmet());
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:3000')
  .split(',').map(value => value.trim()).filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin not allowed by CORS'));
  },
  credentials: true
}));

// Stripe requires the untouched request body to verify its signature.
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), stripeWebhook);

// Better Auth is registered after MongoDB connects and before the server starts listening.
function registerApiRoutes() {
app.use(express.json({ limit: '1mb' }));

app.use('/api/equipment', equipmentRoutes);
app.use('/api/bookings', bookingsRoutes);
app.use('/api/favorites', favoritesRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/owner', ownerRoutes);
app.use('/api/payments', rateLimit({ windowMs: 15 * 60 * 1000, max: 30 }), paymentRoutes);
app.get('/api/profile', authenticate, (req, res) => res.json({ user: { ...req.user, id: String(req.user._id) } }));
app.patch('/api/profile', authenticate, async (req, res, next) => {
  try {
    const name = req.body?.name;
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80) {
      return res.status(400).json({ message: 'Name must be between 2 and 80 characters' });
    }
    await getDB().collection('users').updateOne({ _id: req.user._id }, { $set: { name: name.trim(), updatedAt: new Date() } });
    return res.json({ message: 'Profile updated', name: name.trim() });
  } catch (error) { return next(error); }
});
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use((req, res) => res.status(404).json({ message: 'Route not found' }));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error?.message === 'Origin not allowed by CORS') {
    return res.status(403).json({ message: 'Origin not allowed' });
  }
  console.error(error);
  return res.status(500).json({ message: 'Server error' });
});

}

const port = Number(process.env.PORT || 5000);
connectDB()
  .then(() => {
    const auth = createAuth();
    const authHandler = toNodeHandler(auth);
    // Register Better Auth before JSON parsing and the API's 404 handler.
    app.all('/api/auth/*', rateLimit({ windowMs: 15 * 60 * 1000, max: 80 }), authHandler);
    registerApiRoutes();
    app.listen(port, () => console.log(`Equiply API listening on ${port}`));
  })
  .catch(error => {
    console.error('Database connection failed:', error);
    process.exit(1);
  });
