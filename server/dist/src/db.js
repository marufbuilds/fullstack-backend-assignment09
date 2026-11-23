import { MongoClient } from 'mongodb';
let client;
let db;
export async function connectDB() {
    if (db)
        return db;
    client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    db = client.db(process.env.DB_NAME || 'equiply');
    await Promise.all([
        db.collection('users').createIndex({ email: 1 }, { unique: true }),
        db.collection('equipment').createIndex({
            status: 1,
            category: 1,
            location: 1
        }),
        db.collection('equipment').createIndex({
            title: 'text',
            description: 'text'
        }),
        db.collection('bookings').createIndex({
            equipmentId: 1,
            startDate: 1,
            endDate: 1
        }),
        db.collection('bookings').createIndex({
            renterId: 1,
            createdAt: -1
        }),
        db.collection('bookings').createIndex({
            ownerId: 1,
            createdAt: -1
        }),
        db.collection('favorites').createIndex({ userId: 1, equipmentId: 1 }, { unique: true }),
        db.collection('payments').createIndex({ checkoutSessionId: 1 }, { unique: true, sparse: true }),
        db.collection('payments').createIndex({ stripeEventId: 1 }, { unique: true, sparse: true }),
        db.collection('payments').createIndex({
            renterId: 1,
            createdAt: -1
        }),
        db.collection('stripeEvents').createIndex({ eventId: 1 }, { unique: true })
    ]);
    console.log('MongoDB connected and indexes are ready');
    return db;
}
export function getDB() {
    if (!db) {
        throw new Error('Database not initialized');
    }
    return db;
}
