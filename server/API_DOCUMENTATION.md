# Equiply API Documentation

Base URL: `http://localhost:5000/api`

Authenticated routes require `Authorization: Bearer <token>`.

| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | `/auth/register` | Public | Create account |
| POST | `/auth/login` | Public | Login, receive JWT |
| GET | `/equipment` | Public | Approved marketplace listings; supports query, category, location, maxPrice, sort |
| GET | `/equipment/:id` | Public | Get approved listing |
| POST | `/equipment` | Owner | Submit equipment |
| GET | `/equipment/mine/list` | Owner | Owner's listings |
| PATCH | `/equipment/:id/status` | Admin | Approve/reject listing |
| DELETE | `/equipment/:id` | Owner/Admin | Remove own listing or admin listing |
| POST | `/bookings` | Customer | Create booking request |
| GET | `/bookings/mine` | Customer | Customer bookings |
| GET | `/bookings/owner` | Owner | Incoming owner bookings |
| PATCH | `/bookings/:id/status` | Owner/Admin | Approve, reject, complete booking |
| GET | `/equipment/admin/all` | Admin | All listings, including pending |
| GET | `/bookings/admin/all` | Admin | All bookings |
