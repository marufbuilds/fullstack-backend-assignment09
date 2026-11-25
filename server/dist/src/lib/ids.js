import { ObjectId } from 'mongodb';
/**
 * Normalize a Better Auth/MongoDB ID
 * into a stable string representation.
 */
export function normalizeId(value) {
    if (value == null)
        return '';
    if (typeof value === 'object' &&
        typeof value.toHexString === 'function') {
        return value.toHexString();
    }
    return String(value).trim();
}
/**
 * Match both MongoDB ObjectId values
 * and string-based IDs.
 */
export function idValues(value) {
    const id = normalizeId(value);
    if (!id)
        return [];
    const values = [id];
    if (ObjectId.isValid(id)) {
        values.push(new ObjectId(id));
    }
    return values;
}
/**
 * Compare two IDs safely.
 */
export function idMatches(a, b) {
    const first = normalizeId(a);
    const second = normalizeId(b);
    return first !== '' && first === second;
}
/**
 * Find equipment and bookings belonging
 * to the currently logged-in owner.
 */
export function ownerFilter(ownerId) {
    const values = idValues(ownerId);
    if (values.length === 0) {
        return { ownerId: null };
    }
    return {
        ownerId: { $in: values }
    };
}
