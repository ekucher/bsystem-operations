import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

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
//
// Async (node:crypto's callback `scrypt`, promisified) rather than
// `scryptSync` on purpose: scrypt's whole cost is CPU-bound key
// derivation, and the sync form blocks the single event loop for its
// entire ~50-100ms for every login attempt — under any concurrent load
// that stalls unrelated requests. The callback form runs on libuv's
// threadpool instead.
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, SCRYPT_KEYLEN)) as Buffer;
  return `scrypt:${salt.toString('hex')}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  if (salt.length === 0 || expected.length === 0) {
    return false;
  }
  const derived = (await scrypt(password, salt, expected.length)) as Buffer;
  return timingSafeEqual(derived, expected);
}

// Fixed dummy hash, computed once and memoized, so an unknown-username
// login can still pay the same scrypt cost as a real lookup (see
// routes/auth.ts) instead of short-circuiting straight to 401 — a
// response-time gap between "no such user" and "wrong password" is
// itself a username-enumeration oracle.
let dummyPasswordHashPromise: Promise<string> | undefined;
export function getDummyPasswordHash(): Promise<string> {
  if (!dummyPasswordHashPromise) {
    dummyPasswordHashPromise = hashPassword('timing-normalization-dummy-password');
  }
  return dummyPasswordHashPromise;
}

// Opaque session bearer token carried in an httpOnly cookie. Only its
// hashSecret() digest is ever persisted (see sessions.token_hash) — same
// pattern as the agent API key.
export function generateSessionToken(): string {
  return randomBytes(32).toString('hex');
}
