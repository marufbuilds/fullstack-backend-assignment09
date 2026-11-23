import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
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
app.use(helmet());
app.use(cors({
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    credentials: true,
}));
// Stripe webhook must be before express.json()
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), stripeWebhook);
app.use(express.json());
let initializationPromise = null;
async function initialize() {
    const db = await connectDB();
    const auth = createAuth();
    app.locals.db = db;
    app.locals.auth = auth;
}
function ensureInitialized(_req, res, next) {
    if (!initializationPromise) {
        initializationPromise = initialize();
    }
    initializationPromise
        .then(() => next())
        .catch((error) => {
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
app.use(ensureInitialized);
// Better Auth
app.all('/api/auth/*', async (req, res) => {
    try {
        const auth = app.locals.auth;
        const { toNodeHandler } = await import('better-auth/node');
        return toNodeHandler(auth)(req, res);
    }
    catch (error) {
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
app.use('/api/payments', paymentLimiter);
// API routes
app.use('/api/equipment', equipmentRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/favorites', favoritesRoutes);
app.use('/api/owner', ownerRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/payments', paymentRoutes);
// 404
app.use((_req, res) => {
    res.status(404).json({
        message: 'Route not found',
    });
});
// Error handler
app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(500).json({
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
