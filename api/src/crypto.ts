import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

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
