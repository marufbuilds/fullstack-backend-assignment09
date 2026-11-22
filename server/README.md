# Equiply API

Express API using MongoDB, Better Auth (email/password + optional Google OAuth), role/ownership middleware, equipment queries, bookings, favorites, admin/owner APIs, and Stripe Checkout.

## 1. Configure environment

Copy `.env.example` to `.env`, then fill in your own values:

- `MONGODB_URI`: MongoDB Atlas connection string.
- `DB_NAME`: database name (default `equiply`).
- `BETTER_AUTH_SECRET`: random secret with at least 32 characters.
- `BETTER_AUTH_URL`: backend origin, e.g. `http://localhost:5000`.
- `CLIENT_URL`: frontend origin, e.g. `http://localhost:3000`. Multiple origins can be comma-separated.
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: optional Google OAuth credentials.
- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`: Stripe test-mode credentials.
- `STRIPE_CURRENCY`: three-letter currency code (default `usd`).

Never commit `.env` or paste production credentials into source files.

## 2. Install and run

```bash
npm install
npm run dev
```

The API listens on port 5000 by default. Check `/api/health`.

## 3. Better Auth setup

Better Auth stores user, session, account and verification records in MongoDB. Application user records use the `users` collection. Roles are server-controlled and default to `customer`; do not accept a role from the registration form.

Email/password endpoints are handled by Better Auth under `/api/auth/*`:
- `POST /api/auth/sign-up/email`
- `POST /api/auth/sign-in/email`
- `POST /api/auth/sign-out`
- `GET /api/auth/get-session`

Google OAuth is enabled only when both Google environment variables are set. Add this callback URL to the Google OAuth client:
`http://localhost:5000/api/auth/callback/google`

The frontend must send cookies for API requests:
```ts
fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/bookings/mine`, {
  credentials: 'include'
});
```
Use `credentials: 'include'` for Better Auth client requests too. The backend CORS allowlist must contain the exact frontend origin.

## 4. Stripe setup

Create a Stripe Checkout session:
`POST /api/payments/checkout/:bookingId`

The signed webhook endpoint is:
`POST /api/payments/webhook`

For local development, forward Stripe test events to:
`http://localhost:5000/api/payments/webhook`

Listen for `checkout.session.completed` and `checkout.session.expired`. The webhook uses the raw request body and signature verification. Do not call the webhook route from the browser.

## 5. Main API routes

- `GET /api/equipment`: search, category, location, type, minPrice, maxPrice, availableFrom, availableTo, sort, page and limit.
- `GET /api/equipment/:id`
- `POST /api/equipment` (owner/admin)
- `GET /api/equipment/owner/mine`
- `PATCH /api/equipment/:id` and `DELETE /api/equipment/:id` (owner/admin; ownership checked)
- `POST /api/bookings`, `GET /api/bookings/mine`, `GET /api/bookings/owner`
- `PATCH /api/bookings/:id/status`
- `GET /api/favorites`, `POST /api/favorites/:equipmentId`, `DELETE /api/favorites/:equipmentId`
- `POST /api/payments/checkout/:bookingId`
- `GET /api/profile`, `PATCH /api/profile`
- `GET /api/owner/analytics`
- Admin: `/api/admin/stats`, `/users`, `/users/:id/role`, `/equipment`, `/equipment/:id/status`, `/bookings`

Protected application routes use the Better Auth session cookie. The backend loads the user and role from MongoDB on each authenticated request; do not trust role values sent by the client.

## Important limitations

- MongoDB and Stripe require valid credentials and have not been live-tested in this environment.
- Google OAuth requires valid Google Cloud credentials and an exact configured redirect URI.
- Booking overlap checking is a query-based guard, not a transaction-backed reservation lock; high-concurrency booking attempts still need transaction/locking work.
- Before production, add automated integration tests, configure HTTPS, review Stripe currency/pricing units, and confirm the frontend uses cookie-based Better Auth sessions.
