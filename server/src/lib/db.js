const { MongoClient } = require("mongodb");
let client;
let db;
async function connectDB() {
  if (db) return db;
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is missing");
  client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  db = client.db(process.env.DB_NAME || "equiply");
  await db.collection("users").createIndex({ email: 1 }, { unique: true });
  await db.collection("equipment").createIndex({ status: 1, category: 1 });
  await db.collection("bookings").createIndex({ renterId: 1, createdAt: -1 });
  return db;
}
function getDB() {
  if (!db) throw new Error("Database is not connected");
  return db;
}
module.exports = { connectDB, getDB };
