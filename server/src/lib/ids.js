import { ObjectId } from 'mongodb';

/** Normalize a Better Auth/Mongo ID into a stable string representation. */
export function normalizeId(value) {
  if (value == null) return '';
  if (typeof value === 'object' && typeof value.toHexString === 'function') {
    return value.toHexString();
  }
  return String(value).trim();
}

/** Match both legacy BSON ObjectId values and current string IDs. */
export function idValues(value) {
  const id = normalizeId(value);
  const values = [id];
  if (ObjectId.isValid(id)) values.push(new ObjectId(id));
  return values;
}

export function idMatches(a, b) {
  return normalizeId(a) !== '' && normalizeId(a) === normalizeId(b);
}

export function ownerFilter(ownerId) {
  return { ownerId: { $in: idValues(ownerId) } };
}
