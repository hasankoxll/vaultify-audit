import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1 } as const;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(password, salt, KEY_LENGTH, SCRYPT_OPTIONS).toString("base64url");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algo, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const actual = scryptSync(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  const expected = Buffer.from(hash, "base64url");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

const DUMMY_HASH = hashPassword("not-a-real-credential");

export function dummyPasswordCheck(password: string): void {
  verifyPassword(password, DUMMY_HASH);
}

export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function tokensMatch(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
