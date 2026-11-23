 
import { MongoClient } from 'mongodb';

let client;
let db;

export async function connectDB() {
  if (db) return db;

  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is missing');
  }

  client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();

  db = client.db(process.env.DB_NAME || 'equiply');

  await Promise.all([
    db.collection('users').createIndex({ email: 1 }, { unique: true }),
    db.collection('equipment').createIndex({ status: 1, category: 1 }),
    db.collection('bookings').createIndex({ renterId: 1, createdAt: -1 }),
    db.collection('bookings').createIndex({ ownerId: 1, createdAt: -1 }),
  ]);

  console.log('MongoDB connected');

  return db;
}

export function getDB() {
  if (!db) {
    throw new Error('Database is not connected');
  }

  return db;
}
