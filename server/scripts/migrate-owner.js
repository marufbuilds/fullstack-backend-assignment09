import 'dotenv/config';
import { ObjectId } from 'mongodb';
import { connectDB, getDB } from '../src/db.js';

const oldOwnerIds = String(process.env.OLD_OWNER_IDS || process.env.OLD_OWNER_ID || '6b02609eb032f7046c0b95f4,6b02609eb032f7046c0b95f7')
  .split(',').map((value) => value.trim()).filter(Boolean);
const newOwnerId = String(process.env.NEW_OWNER_ID || '6b0265d5b032f7046c0b95fe').trim();
const apply = process.argv.includes('--apply');

if (!oldOwnerIds.length || !newOwnerId || !ObjectId.isValid(newOwnerId)) {
  console.error('Set OLD_OWNER_IDS (comma-separated) and a valid NEW_OWNER_ID (24-character Mongo ID).');
  process.exit(1);
}
if (oldOwnerIds.includes(newOwnerId)) {
  console.error('Target ID is included among old IDs; migration stopped.');
  process.exit(1);
}

const variants = (id) => {
  const values = [id];
  if (ObjectId.isValid(id)) values.push(new ObjectId(id));
  return values;
};
const oldVariants = oldOwnerIds.flatMap(variants);

await connectDB();
const db = getDB();

const targetUser = await db.collection('users').findOne({
  $or: [{ _id: newOwnerId }, { _id: new ObjectId(newOwnerId) }, { id: newOwnerId }],
});
if (!targetUser) {
  console.error('Target owner account was not found. Migration stopped.');
  process.exit(1);
}

const equipmentFilter = { ownerId: { $in: oldVariants } };
const bookingFilter = { ownerId: { $in: oldVariants } };
const equipmentCount = await db.collection('equipment').countDocuments(equipmentFilter);
const bookingCount = await db.collection('bookings').countDocuments(bookingFilter);
console.log(`Target account: ${targetUser.name || targetUser.email || newOwnerId}`);
console.log(`Old owner IDs: ${oldOwnerIds.join(', ')}`);
console.log(`Equipment documents to change: ${equipmentCount}`);
console.log(`Booking documents to change: ${bookingCount}`);

if (!apply) {
  console.log('DRY RUN ONLY. No documents changed. Re-run with --apply to perform the migration.');
  process.exit(0);
}

await db.collection('users').updateOne(
  { _id: targetUser._id },
  { $set: { role: 'owner', updatedAt: new Date() } },
);
const equipmentResult = await db.collection('equipment').updateMany(
  equipmentFilter,
  { $set: { ownerId: newOwnerId, updatedAt: new Date() } },
);
const bookingResult = await db.collection('bookings').updateMany(
  bookingFilter,
  { $set: { ownerId: newOwnerId, updatedAt: new Date() } },
);

console.log('Migration completed.');
console.log(`Equipment updated: ${equipmentResult.modifiedCount}`);
console.log(`Bookings updated: ${bookingResult.modifiedCount}`);
console.log('Migrated ownerId values are now consistent strings.');
