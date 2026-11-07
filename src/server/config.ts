import { existsSync, readFileSync } from "node:fs";

export interface AppConfig {
  dataDir: string;
  host: string;
  port: number;
  cookieSecure: boolean;
  sessionTtlHours: number;
  maxUploadBytes: number;
  maxImportRows: number;
  enableDemo: boolean;
  trustProxy: boolean;
  loginRateLimit: number;
  loginRateWindowSeconds: number;
  allowTestIpHeader: boolean;
  seedOwnerEmail: string | null;
  seedOwnerName: string | null;
  seedOwnerPassword: string | null;
  seedWorkspaceName: string;
}

export function loadEnvFile(path = ".env"): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    dataDir: env.VA_DATA_DIR?.trim() || "./data",
    host: env.VA_HOST?.trim() || "127.0.0.1",
    port: parsePort(env.VA_PORT, 8787),
    cookieSecure: env.VA_COOKIE_SECURE === "true",
    sessionTtlHours: parseBoundedInt(env.VA_SESSION_TTL_HOURS, 12, 1, 24 * 14),
    maxUploadBytes: parseBoundedInt(env.VA_MAX_UPLOAD_BYTES, 2_000_000, 1_024, 20_000_000),
    maxImportRows: parseBoundedInt(env.VA_MAX_IMPORT_ROWS, 5_000, 1, 50_000),
    enableDemo: env.VA_ENABLE_DEMO !== "false",
    trustProxy: env.VA_TRUST_PROXY === "true",
    loginRateLimit: parseBoundedInt(env.VA_LOGIN_RATE_LIMIT, 10, 1, 1_000),
    loginRateWindowSeconds: parseBoundedInt(env.VA_LOGIN_RATE_WINDOW_SECONDS, 900, 10, 86_400),
    allowTestIpHeader: env.VA_ALLOW_TEST_IP_HEADER === "true",
    seedOwnerEmail: env.VA_SEED_OWNER_EMAIL?.trim() || null,
    seedOwnerName: env.VA_SEED_OWNER_NAME?.trim() || null,
    seedOwnerPassword: env.VA_SEED_OWNER_PASSWORD ?? null,
    seedWorkspaceName: env.VA_SEED_WORKSPACE_NAME?.trim() || "Pilot workspace",
  };
}

function parsePort(value: string | undefined, fallback: number): number {
  return parseBoundedInt(value, fallback, 1, 65535);
}

function parseBoundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  if (!/^\d+$/.test(value.trim())) {
    throw new Error(`Invalid numeric environment value`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Numeric environment value is out of range`);
  }
  return parsed;
}
