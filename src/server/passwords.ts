const REJECTED = new Set(["replace-with-a-long-password", "synthetic-demo-only", "password", "password1234"]);

export function passwordError(password: string): string | null {
  if (typeof password !== "string") return "invalid_password";
  if (password.length < 12 || password.length > 128) return "invalid_password";
  if ([...password].some((char) => char.charCodeAt(0) < 32)) return "invalid_password";
  if (REJECTED.has(password)) return "invalid_password";
  return null;
}

export function normalizeEmail(email: string): string | null {
  if (typeof email !== "string") return null;
  const value = email.trim().toLowerCase();
  if (value.length < 6 || value.length > 254) return null;
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(value)) return null;
  return value;
}

export function cleanName(name: string): string | null {
  if (typeof name !== "string") return null;
  const value = name.trim().replace(/\s+/g, " ");
  if (value.length < 1 || value.length > 120) return null;
  if ([...value].some((char) => char.charCodeAt(0) < 32)) return null;
  return value;
}
