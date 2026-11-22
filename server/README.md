# Equiply API

Express API using MongoDB, Better Auth (email/password and optional Google OAuth), session-based authorization, equipment, bookings, favorites, owner/admin APIs, and Stripe Checkout.

## Setup
1. Copy `.env.example` to `.env`.
2. Set `MONGODB_URI`, a 32+ character `BETTER_AUTH_SECRET`, and your frontend/backend URLs.
3. Optional: configure Google OAuth and Stripe test credentials.
4. Run `npm install`, then `npm run dev`.
5. Check `http://localhost:5000/api/health`.

## Auth
Better Auth handles `/api/auth/*`. The frontend should use cookie-based sessions and send requests with `credentials: 'include'`. Do not send or trust role values from the client. Google callback URL (local): `http://localhost:5000/api/auth/callback/google`.

## API
See `API_DOCUMENTATION.md` for the endpoint overview. Protected routes use the Better Auth session cookie.

## Stripe
Checkout: `POST /api/payments/checkout/:bookingId`. Webhook: `POST /api/payments/webhook`. Configure the webhook endpoint in Stripe and use test keys only while developing. The webhook requires its signing secret.

## Demo seed
`npm run seed:demo` creates/resets demo credentials. Run only in a development database; never use these credentials in production.

## Notes
Credentials and environment files are not included in this package. MongoDB/Stripe/Google OAuth integration still requires your own credentials and local testing.
