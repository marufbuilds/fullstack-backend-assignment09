import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { hashPassword } from '@better-auth/utils/password';

const DEMO_USERS = [
  {
    name: 'Equiply Admin',
    email: 'admin@equiply.dev',
    password: 'Admin12345!',
    role: 'admin',
  },
  {
    name: 'Rahman Equipment',
    email: 'owner@equiply.dev',
    password: 'Owner12345!',
    role: 'owner',
  },
  {
    name: 'Demo Renter',
    email: 'renter@equiply.dev',
    password: 'Renter12345!',
    role: 'customer',
  },
];

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function ensureDemoUser(db, demo) {
  const users = db.collection('users');
  const accounts = db.collection('account');
  const now = new Date();
  const email = demo.email.toLowerCase();

  // Keep the seed idempotent and avoid duplicate records for the same email.
  const existingUsers = await users
    .find({ email })
    .sort({ createdAt: 1, _id: 1 })
    .toArray();

  let user = existingUsers[0];

  if (!user) {
    const doc = {
      name: demo.name,
      email,
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
      role: demo.role,
    };
    const result = await users.insertOne(doc);
    user = { ...doc, _id: result.insertedId };
    console.log(`created user: ${email}`);
  } else {
    await users.updateOne(
      { _id: user._id },
      {
        $set: {
          name: demo.name,
          email,
          role: demo.role,
          updatedAt: now,
        },
      },
    );
    user = { ...user, name: demo.name, email, role: demo.role };
    console.log(`updated user: ${email}`);
  }

  // If duplicates exist for the same email, keep the canonical user and remove extras.
  const duplicateIds = existingUsers.slice(1).map((item) => item._id);
  if (duplicateIds.length > 0) {
    await accounts.deleteMany({ userId: { $in: duplicateIds } });
    await users.deleteMany({ _id: { $in: duplicateIds } });
    console.log(`removed duplicate users for: ${email} (${duplicateIds.length})`);
  }

  // Hash through Better Auth's own password utility so verification matches login.
  const passwordHash = await hashPassword(demo.password);

  const credentialAccounts = await accounts
    .find({ userId: user._id, providerId: 'credential' })
    .sort({ createdAt: 1, _id: 1 })
    .toArray();

  const accountDoc = {
    accountId: String(user._id),
    providerId: 'credential',
    userId: user._id,
    password: passwordHash,
    updatedAt: now,
  };

  if (credentialAccounts[0]) {
    await accounts.updateOne({ _id: credentialAccounts[0]._id }, { $set: accountDoc });
    const extraAccountIds = credentialAccounts.slice(1).map((item) => item._id);
    if (extraAccountIds.length > 0) {
      await accounts.deleteMany({ _id: { $in: extraAccountIds } });
    }
    console.log(`reset credential password: ${email}`);
  } else {
    await accounts.insertOne({ ...accountDoc, createdAt: now });
    console.log(`created credential account: ${email}`);
  }
}

async function main() {
  const mongoUri = requireEnv('MONGODB_URI');
  const dbName = process.env.DB_NAME || 'equiply';

  const client = new MongoClient(mongoUri);
  await client.connect();

  try {
    const db = client.db(dbName);

    for (const demo of DEMO_USERS) {
      await ensureDemoUser(db, demo);
    }

    const users = db.collection('users');
    const summary = await users
      .find(
        { email: { $in: DEMO_USERS.map((item) => item.email) } },
        { projection: { email: 1, role: 1, name: 1 } },
      )
      .toArray();

    console.log('Demo accounts ready:');
    for (const item of summary) {
      console.log(`- ${item.email} (${item.role})`);
    }
    console.log('Passwords: Admin12345! / Owner12345! / Renter12345!');
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error('Demo seed failed:', error);
  process.exit(1);
});
