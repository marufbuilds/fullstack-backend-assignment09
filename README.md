# Equiply — Backend

The Equiply backend powers an equipment rental platform where customers can rent equipment, owners can manage their listings, and administrators can manage platform activities.

It provides the APIs, database operations, authentication, authorization, and business logic required by the frontend.

## Tech Stack

- **Node.js** — JavaScript runtime
- **Express.js** — Backend framework
- **TypeScript** — Type safety
- **MongoDB** — Database
- **Better Auth** — Authentication
- **JWT** — Token-based authorization
- **Stripe** — Payment processing
- **dotenv** — Environment configuration
- **CORS** — Cross-origin request handling

## Main Responsibilities

- Connect and communicate with MongoDB
- Manage users and authentication
- Handle role-based permissions
- Create, update, retrieve, and delete equipment
- Manage rental bookings
- Handle favorites
- Process payment-related requests
- Provide APIs for customer, owner, and admin dashboards
- Validate requests and handle errors

## Project Structure

```text
server/
├── src/
│   ├── routes/
│   ├── middleware/
│   ├── lib/
│   ├── config/
│   └── ...
├── package.json
├── tsconfig.json
└── README.md
```

_The exact folders may vary depending on the current backend implementation._

## Getting Started

### 1. Clone the repository

```bash
git clone <your-backend-repository-url>
cd server
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env` file in the backend root.

Example configuration:

```env
PORT=5000
MONGODB_URL=your_mongodb_connection_string
BETTER_AUTH_SECRET=your_better_auth_secret
BETTER_AUTH_URL=http://localhost:5000
FRONTEND_URL=http://localhost:3000

STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret

GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
```

Use the actual environment variable names required by the backend source code. Never commit real secrets or credentials to GitHub.

### 4. Start the development server

Use the script configured in `package.json`. For example:

```bash
npm run dev
```

The local backend runs at:

```text
http://localhost:5000
```

API base URL:

```text
http://localhost:5000/api
```

## Development Challenges and Lessons Learned

Building the backend was one of the most important parts of Equiply because the frontend depends on it for real data and business operations.

### 1. MongoDB Connection and Database Management

One of our initial challenges was establishing a reliable MongoDB connection and making sure the application could access the correct database and collections.

We also needed to organize database operations so different features could work with the same database connection.

**What we learned:** A database connection is not just about connecting successfully. We also need to understand collections, documents, queries, updates, and how data moves through the application.

### 2. Designing and Connecting API Routes

Creating API endpoints for different features required careful planning.

We had to deal with:

- GET requests for retrieving data
- POST requests for creating records
- PATCH requests for updating records
- DELETE requests for removing records
- Correct route paths and request parameters
- Consistent API responses

A route mismatch between the frontend and backend could make an otherwise functional feature fail.

**What we learned:** API contracts matter. The frontend and backend must agree on endpoint paths, request bodies, response structures, and HTTP methods.

### 3. Authentication with Better Auth

Setting up authentication was more challenging than simply creating a login form.

We needed to consider email and password login, Google sign-in, session management, authentication callbacks, and communication between the frontend and backend.

**What we learned:** Authentication involves several moving parts, including provider configuration, callback URLs, cookies, sessions, and environment variables. A small configuration mistake can prevent the entire login flow from working.

### 4. Role-Based Authorization

Equiply has three main user roles:

- Customer
- Equipment Owner
- Administrator

Each role needs different permissions.

We needed to consider how to identify authenticated users, verify their roles, and prevent users from accessing operations that do not belong to them.

**What we learned:** Authorization must be enforced by the backend. Frontend restrictions alone cannot protect sensitive operations.

### 5. Frontend and Backend Integration

Connecting the separate Next.js frontend and Express backend was a major integration challenge.

We encountered issues involving:

- Incorrect API URLs
- CORS configuration
- Environment variables
- Request and response handling
- Authentication cookies and sessions
- Local and production server differences

**What we learned:** A full-stack application is a connected system. A feature is only complete when its frontend, backend, and database work together correctly.

### 6. Booking Management

The rental booking process requires more than saving a record.

The backend needs to handle booking information, user ownership, equipment details, and booking status while ensuring that users cannot manipulate records they are not authorized to access.

**What we learned:** Business logic and validation are essential. The server must verify important information instead of trusting data submitted by the browser.

### 7. Stripe Payment Integration

Payment integration introduces additional complexity because payment status must be handled reliably.

We needed to consider checkout creation, payment confirmation, webhook events, and what happens when a payment fails.

**What we learned:** Payment confirmation should be verified on the server, using trusted payment-provider events. The frontend redirect alone is not sufficient proof of payment.

### 8. Error Handling and Debugging

During development, we had to investigate problems involving server startup, database connectivity, API responses, authentication configuration, and frontend integration.

Understanding the actual cause of an error was often more important than simply changing code until it worked.

**What we learned:** Debugging is a core backend development skill. Reading error messages, checking server logs, and tracing requests help us build more reliable applications.

## What This Project Taught Us

Working on the Equiply backend helped us understand:

- Building REST APIs with Express
- Connecting Node.js applications to MongoDB
- Organizing backend routes and middleware
- Authentication and session management
- Role-based authorization
- Validating incoming requests
- Managing equipment and rental bookings
- Integrating payment services
- Handling CORS and environment configuration
- Debugging full-stack integration issues

## Future Improvements

- Add comprehensive automated API tests
- Improve request validation and error handling
- Strengthen security and access control
- Improve logging and monitoring
- Optimize database queries and indexes
- Expand payment and booking reliability

---

**Equiply Backend — Built to support a practical equipment rental platform while learning the real challenges of backend development and full-stack integration.**
