import { randomBytes, createHash, scryptSync, timingSafeEqual } from 'node:crypto';

// Prefixed so a leaked key is recognizable at a glance (e.g. in a log
// line accidentally left in), the same way GitHub/Stripe tokens are.
export function generateApiKey(): string {
  return `bop_${randomBytes(32).toString('hex')}`;
}

export function hashSecret(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

// Compares two secrets without leaking timing information about where
// they first differ. Hashing both to a fixed 32-byte digest first also
// avoids the length-based short-circuit that a naive
// `timingSafeEqual(Buffer.from(a), Buffer.from(b))` would need (that API
// throws on mismatched buffer lengths).
export function secretsMatch(provided: string | undefined, expected: string | undefined): boolean {
  if (!provided || !expected) {
    return false;
  }
  const providedDigest = createHash('sha256').update(provided, 'utf8').digest();
  const expectedDigest = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

const SCRYPT_KEYLEN = 64;

// scrypt over bcrypt: node:crypto built-in, no extra dependency for a
// backend that otherwise depends on nothing beyond express/better-sqlite3/
// zod. Format `scrypt:<saltHex>:<hashHex>` keeps the salt alongside the
// hash (standard practice) without needing a second stored column.
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt:${salt.toString('hex')}:${derived.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  if (salt.length === 0 || expected.length === 0) {
    return false;
  }
  const derived = scryptSync(password, salt, expected.length);
  return timingSafeEqual(derived, expected);
}

// Opaque session bearer token carried in an httpOnly cookie. Only its
// hashSecret() digest is ever persisted (see sessions.token_hash) — same
// pattern as the agent API key.
export function generateSessionToken(): string {
  return randomBytes(32).toString('hex');
}
