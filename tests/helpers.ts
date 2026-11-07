import { createApp, type AppDeps } from "../src/server/app.js";
import { loadConfig, type AppConfig } from "../src/server/config.js";
import { openDatabase, type AppDb } from "../src/server/db.js";
import { migrate } from "../src/server/migrate.js";
import type { Logger } from "../src/server/logger.js";

export interface TestContext {
  app: ReturnType<typeof createApp>;
  db: AppDb;
  logs: Array<{ level: string; event: string; fields?: Record<string, unknown> }>;
  config: AppConfig;
}

export function testContext(overrides: Record<string, string> = {}): TestContext {
  const db = openDatabase(":memory:");
  migrate(db);
  const config = loadConfig({
    VA_ENABLE_DEMO: "false",
    VA_MAX_UPLOAD_BYTES: "2000000",
    VA_MAX_IMPORT_ROWS: "5000",
    VA_LOGIN_RATE_LIMIT: "1000",
    VA_LOGIN_RATE_WINDOW_SECONDS: "900",
    VA_ALLOW_TEST_IP_HEADER: "true",
    VA_COOKIE_SECURE: "false",
    VA_SESSION_TTL_HOURS: "12",
    ...overrides,
  });
  const logs: TestContext["logs"] = [];
  const logger: Logger = (level, event, fields) => logs.push({ level, event, fields });
  const deps: AppDeps = { db, config, logger, staticRoot: null };
  return { app: createApp(deps), db, logs, config };
}

export async function login(app: TestContext["app"], email: string, password: string, ip = "203.0.113.10") {
  const response = await app.request("http://localhost/api/auth/login", {
    method: "POST",
    headers: mutationHeaders(undefined, undefined, ip),
    body: JSON.stringify({ email, password }),
  });
  const json = (await response.json()) as { csrfToken?: string; error?: { code: string } };
  const setCookie = response.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";")[0] ?? "";
  return { status: response.status, json, cookie, csrf: json.csrfToken ?? "", setCookie };
}

export function mutationHeaders(cookie?: string, csrf?: string, ip = "203.0.113.10", extra: Record<string, string> = {}) {
  return {
    origin: "http://localhost",
    host: "localhost",
    "x-vaultify-request": "1",
    "x-test-ip": ip,
    ...(cookie ? { cookie } : {}),
    ...(csrf ? { "x-csrf-token": csrf } : {}),
    "content-type": "application/json",
    ...extra,
  };
}

export function readHeaders(cookie: string) {
  return { cookie, host: "localhost", "x-test-ip": "203.0.113.10" };
}
