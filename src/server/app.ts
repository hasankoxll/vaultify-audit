import { extname, join, normalize, sep } from "node:path";
import { readFile } from "node:fs/promises";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { IMPORT_FIELDS, type FieldMapping } from "../domain/fields.js";
import type { AppConfig } from "./config.js";
import { tokensMatch } from "./crypto.js";
import type { AppDb } from "./db.js";
import { DEMO_ACK, DEMO_EMAIL, DEMO_PASSWORD, DEMO_WORKSPACE_ID } from "./demo-constants.js";
import { readSyntheticCsv, resetDemo } from "./demo.js";
import type { Logger } from "./logger.js";
import { createRateLimiter } from "./rate-limit.js";
import { createSession, deleteSession, readSession, switchWorkspace, type SessionContext } from "./sessions.js";
import { writeAudit } from "./audit.js";
import {
  authenticate,
  createMember,
  listMemberships,
  listWorkspaceMembers,
  setMemberPassword,
  type Role,
  ServiceError,
} from "./services/accounts.js";
import {
  buildPreview,
  commitImport,
  createUpload,
  deleteImport,
  deleteInvoiceData,
} from "./services/imports.js";
import { auditCsv, dashboard, findingsCsv, getCase, getImport, importErrorsCsv, listAudit, listCases, listImports } from "./services/queries.js";
import { applyDecision, updateSettings } from "./services/review.js";

const MESSAGES: Record<string, string> = {
  invalid_credentials: "Email or password is incorrect.",
  unauthenticated: "Sign in is required.",
  forbidden: "You do not have access to do that.",
  not_found: "That record was not found.",
  csrf_failed: "The request was rejected.",
  rate_limited: "Too many attempts. Wait and try again.",
  demo_disabled: "Synthetic demo mode is turned off.",
  demo_forbidden: "That action is not available in the synthetic demo workspace.",
  demo_isolation: "Demo access stays inside the synthetic workspace.",
  invalid_user: "Check the name and email.",
  invalid_password: "Use a password between 12 and 128 characters that is not a published example.",
  invalid_role: "Choose owner, reviewer, or read-only.",
  email_in_use: "That email is already in use.",
  invalid_file_type: "Upload a CSV file.",
  file_too_large: "That file is larger than the configured limit.",
  too_many_rows: "That file has more rows than the configured limit.",
  invalid_csv: "That file is not a valid CSV.",
  invalid_encoding: "The file must be UTF-8.",
  empty_csv: "The CSV file is empty.",
  empty_header: "The CSV header row has an empty column name.",
  duplicate_header: "The CSV header row repeats a column name.",
  nul_byte: "The file was rejected.",
  cell_too_long: "A CSV cell is longer than the allowed size.",
  too_many_columns: "The CSV has too many columns.",
  invalid_mapping: "The field mapping is incomplete.",
  already_committed: "This import was already committed.",
  invalid_comment: "A comment between 3 and 2000 characters is required.",
  invalid_decision: "That decision is not available.",
  invalid_state: "That case cannot take this decision.",
  invalid_recovery: "Enter a plain decimal recovery amount greater than zero and no larger than the case exposure.",
  recovery_exact_only: "Recorded recovery is only available on exact-key duplicate cases.",
  invalid_settings: "Check the date window and amount tolerance.",
  confirmation_required: "Type DELETE INVOICE DATA to confirm.",
  invalid_json: "The request body could not be read.",
  payload_too_large: "The request is too large.",
  internal_error: "Something went wrong.",
};

export interface AppDeps {
  db: AppDb;
  config: AppConfig;
  logger: Logger;
  staticRoot?: string | null;
  now?: () => Date;
}

export function createApp(deps: AppDeps) {
  const uploadLimiter = createRateLimiter(200, 15 * 60 * 1000);
  const loginLimiter = createRateLimiter(deps.config.loginRateLimit, deps.config.loginRateWindowSeconds * 1000);
  const app = new Hono();

  app.use("*", async (c, next) => {
    await next();
    c.header("x-content-type-options", "nosniff");
    c.header("referrer-policy", "no-referrer");
    c.header("x-frame-options", "DENY");
    c.header(
      "content-security-policy",
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    );
    if (c.req.path.startsWith("/api/")) c.header("cache-control", "no-store");
  });

  const current = () => deps.now?.() ?? new Date();

  const run = async (c: Context, fn: () => Promise<Response> | Response) => {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof ServiceError) return fail(c, error.status, error.code, error.details);
      const errorId = crypto.randomUUID();
      deps.logger("error", "unhandled", { errorId, method: c.req.method });
      return c.json({ error: { code: "internal_error", message: MESSAGES.internal_error, errorId } }, 500);
    }
  };

  app.get("/api/health", (c) => {
    deps.db.prepare("SELECT 1 AS ok").get();
    return c.json({ ok: true });
  });

  app.post("/api/auth/login", (c) =>
    run(c, async () => {
      const blocked = assertBrowserMutation(c);
      if (blocked) return blocked;
      if (!loginLimiter.allow(`login:${clientIp(c)}`)) return fail(c, 429, "rate_limited");
      const body = await readJson(c);
      if (!body.ok) return fail(c, body.status, body.status === 413 ? "payload_too_large" : "invalid_json");
      if (!isRecord(body.value)) return fail(c, 400, "invalid_json");
      const email = typeof body.value.email === "string" ? body.value.email : "";
      const password = typeof body.value.password === "string" ? body.value.password : "";
      const auth = authenticate(deps.db, email, password);
      if (!auth) {
        deps.logger("info", "login_failed", {});
        return fail(c, 401, "invalid_credentials");
      }
      const memberships = listMemberships(deps.db, auth.userId).filter((item) => deps.config.enableDemo || !item.isDemo);
      const home = memberships[0];
      if (!home) return fail(c, 403, "forbidden");
      const session = createSession(deps.db, {
        userId: auth.userId,
        workspaceId: home.workspaceId,
        isDemo: home.isDemo,
        ttlHours: deps.config.sessionTtlHours,
        now: current(),
      });
      setSessionCookie(c, session.token);
      writeAudit(deps.db, {
        workspaceId: home.workspaceId,
        actorUserId: auth.userId,
        action: "login_succeeded",
        entityType: "session",
        entityId: home.workspaceId,
        metadata: { demo: home.isDemo },
        now: current().toISOString(),
      });
      deps.logger("info", "login_succeeded", { demo: home.isDemo });
      return c.json(sessionPayload(deps.db, auth.userId, home.workspaceId, session.csrfToken));
    }),
  );

  app.post("/api/auth/demo", (c) =>
    run(c, async () => {
      const blocked = assertBrowserMutation(c);
      if (blocked) return blocked;
      if (!deps.config.enableDemo) return fail(c, 404, "not_found");
      if (!loginLimiter.allow(`demo:${clientIp(c)}`)) return fail(c, 429, "rate_limited");
      const body = await readJson(c);
      if (!body.ok) return fail(c, body.status, body.status === 413 ? "payload_too_large" : "invalid_json");
      if (!isRecord(body.value)) return fail(c, 400, "invalid_json");
      if (body.value.acknowledge !== DEMO_ACK || body.value.password !== DEMO_PASSWORD) {
        return fail(c, 401, "invalid_credentials");
      }
      const auth = authenticate(deps.db, DEMO_EMAIL, DEMO_PASSWORD);
      if (!auth) return fail(c, 503, "demo_disabled");
      const session = createSession(deps.db, {
        userId: auth.userId,
        workspaceId: DEMO_WORKSPACE_ID,
        isDemo: true,
        ttlHours: deps.config.sessionTtlHours,
        now: current(),
      });
      setSessionCookie(c, session.token);
      writeAudit(deps.db, {
        workspaceId: DEMO_WORKSPACE_ID,
        actorUserId: auth.userId,
        action: "demo_login",
        entityType: "session",
        entityId: DEMO_WORKSPACE_ID,
        metadata: { synthetic: true },
        now: current().toISOString(),
      });
      return c.json(sessionPayload(deps.db, auth.userId, DEMO_WORKSPACE_ID, session.csrfToken));
    }),
  );

  app.post("/api/auth/logout", (c) =>
    run(c, async () => {
      const session = await requireSession(c, true);
      if (session instanceof Response) return session;
      const token = getCookie(c, "va_session");
      if (token) deleteSession(deps.db, token);
      deleteCookie(c, "va_session", { path: "/", secure: deps.config.cookieSecure, sameSite: "Lax" });
      return c.json({ ok: true });
    }),
  );

  app.get("/api/auth/me", (c) =>
    run(c, async () => {
      const session = await requireSession(c, false);
      if (session instanceof Response) return session;
      return c.json(sessionPayload(deps.db, session.userId, session.workspaceId, session.csrfToken));
    }),
  );

  app.post("/api/auth/switch", (c) =>
    run(c, async () => {
      const session = await requireSession(c, true);
      if (session instanceof Response) return session;
      const body = await readJson(c);
      if (!body.ok || !isRecord(body.value) || typeof body.value.workspaceId !== "string") return fail(c, 400, "invalid_json");
      switchWorkspace(deps.db, session, body.value.workspaceId);
      const next = readSession(deps.db, getCookie(c, "va_session") ?? "", current());
      if (!next) return fail(c, 401, "unauthenticated");
      return c.json(sessionPayload(deps.db, next.userId, next.workspaceId, next.csrfToken));
    }),
  );

  app.post("/api/demo/reset", (c) =>
    run(c, async () => {
      const session = await requireSession(c, true);
      if (session instanceof Response) return session;
      if (!session.isDemo || !deps.config.enableDemo) return fail(c, 403, "demo_forbidden");
      resetDemo(deps.db, session.userId, readSyntheticCsv(), current().toISOString());
      return c.json({ ok: true, synthetic: true });
    }),
  );

  app.get("/api/dashboard", (c) =>
    run(c, async () => {
      const session = await requireSession(c, false);
      if (session instanceof Response) return session;
      return c.json(dashboard(deps.db, session.workspaceId));
    }),
  );

  app.get("/api/template.csv", (c) =>
    run(c, async () => {
      const session = await requireSession(c, false);
      if (session instanceof Response) return session;
      const csv = await readFile(join(process.cwd(), "samples", "template.csv"));
      return csvResponse(c, csv.toString("utf8"), "vaultify-template.csv");
    }),
  );

  app.get("/api/imports", (c) =>
    run(c, async () => {
      const session = await requireSession(c, false);
      if (session instanceof Response) return session;
      return c.json({ imports: listImports(deps.db, session.workspaceId) });
    }),
  );

  app.post("/api/imports", (c) =>
    run(c, async () => {
      const session = await requireSession(c, true);
      if (session instanceof Response) return session;
      if (!canWrite(session.role)) return fail(c, 403, "forbidden");
      if (!uploadLimiter.allow(`upload:${clientIp(c)}`)) return fail(c, 429, "rate_limited");
      const declared = Number(c.req.header("content-length") ?? "0");
      if (Number.isFinite(declared) && declared > deps.config.maxUploadBytes + 65_536) return fail(c, 413, "file_too_large");
      const form = await c.req.parseBody();
      const file = form.file;
      if (!(file instanceof File)) return fail(c, 400, "invalid_file_type");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = createUpload(deps.db, {
        workspaceId: session.workspaceId,
        userId: session.userId,
        filename: file.name,
        bytes,
        declaredType: file.type,
        maxUploadBytes: deps.config.maxUploadBytes,
        maxImportRows: deps.config.maxImportRows,
        now: current().toISOString(),
      });
      deps.logger("info", "import_uploaded", { importId: result.id, bytes: bytes.byteLength });
      return c.json(result, 201);
    }),
  );

  app.get("/api/imports/:id", (c) =>
    run(c, async () => {
      const session = await requireSession(c, false);
      if (session instanceof Response) return session;
      const id = recordId(c.req.param("id"));
      if (!id) return fail(c, 404, "not_found");
      const detail = getImport(deps.db, session.workspaceId, id);
      if (!detail) return fail(c, 404, "not_found");
      return c.json(detail);
    }),
  );

  app.post("/api/imports/:id/preview", (c) =>
    run(c, async () => {
      const session = await requireSession(c, true);
      if (session instanceof Response) return session;
      if (!canWrite(session.role)) return fail(c, 403, "forbidden");
      const id = recordId(c.req.param("id"));
      if (!id) return fail(c, 404, "not_found");
      const options = await readImportOptions(c);
      return c.json(
        buildPreview(deps.db, {
          workspaceId: session.workspaceId,
          importId: id,
          ...options,
          maxImportRows: deps.config.maxImportRows,
        }),
      );
    }),
  );

  app.post("/api/imports/:id/commit", (c) =>
    run(c, async () => {
      const session = await requireSession(c, true);
      if (session instanceof Response) return session;
      if (!canWrite(session.role)) return fail(c, 403, "forbidden");
      const id = recordId(c.req.param("id"));
      if (!id) return fail(c, 404, "not_found");
      const options = await readImportOptions(c);
      const result = commitImport(deps.db, {
        workspaceId: session.workspaceId,
        userId: session.userId,
        importId: id,
        ...options,
        maxImportRows: deps.config.maxImportRows,
        now: current().toISOString(),
      });
      deps.logger("info", "import_committed", { importId: id });
      return c.json(result);
    }),
  );

  app.delete("/api/imports/:id", (c) =>
    run(c, async () => {
      const session = await requireSession(c, true);
      if (session instanceof Response) return session;
      if (session.role !== "owner") return fail(c, 403, "forbidden");
      const id = recordId(c.req.param("id"));
      if (!id) return fail(c, 404, "not_found");
      deleteImport(deps.db, {
        workspaceId: session.workspaceId,
        userId: session.userId,
        importId: id,
        isDemo: session.isDemo,
        now: current().toISOString(),
      });
      return c.json({ ok: true });
    }),
  );

  app.get("/api/imports/:id/errors.csv", (c) =>
    run(c, async () => {
      const session = await requireSession(c, false);
      if (session instanceof Response) return session;
      const id = recordId(c.req.param("id"));
      if (!id) return fail(c, 404, "not_found");
      const csv = importErrorsCsv(deps.db, session.workspaceId, id);
      if (!csv) return fail(c, 404, "not_found");
      return csvResponse(c, csv, "vaultify-import-errors.csv");
    }),
  );

  app.get("/api/cases", (c) =>
    run(c, async () => {
      const session = await requireSession(c, false);
      if (session instanceof Response) return session;
      const status = c.req.query("status") ?? "";
      const matchType = c.req.query("matchType") ?? "";
      const currency = (c.req.query("currency") ?? "").trim().toUpperCase();
      const q = (c.req.query("q") ?? "").trim().slice(0, 100);
      if (status && !["open", "confirmed_for_review", "false_positive", "dissolved"].includes(status)) return fail(c, 400, "invalid_json");
      if (matchType && !["exact", "proximity"].includes(matchType)) return fail(c, 400, "invalid_json");
      if (currency && !/^[A-Z]{3}$/.test(currency)) return fail(c, 400, "invalid_json");
      const limit = clampInt(c.req.query("limit"), 50, 1, 100);
      const offset = clampInt(c.req.query("offset"), 0, 0, 100_000);
      return c.json(listCases(deps.db, session.workspaceId, { status, matchType, currency, q, limit, offset }));
    }),
  );

  app.get("/api/cases/:id", (c) =>
    run(c, async () => {
      const session = await requireSession(c, false);
      if (session instanceof Response) return session;
      const id = recordId(c.req.param("id"));
      if (!id) return fail(c, 404, "not_found");
      const detail = getCase(deps.db, session.workspaceId, id);
      if (!detail) return fail(c, 404, "not_found");
      return c.json(detail);
    }),
  );

  app.post("/api/cases/:id/decisions", (c) =>
    run(c, async () => {
      const session = await requireSession(c, true);
      if (session instanceof Response) return session;
      if (!canWrite(session.role)) return fail(c, 403, "forbidden");
      const id = recordId(c.req.param("id"));
      if (!id) return fail(c, 404, "not_found");
      const body = await readJson(c);
      if (!body.ok || !isRecord(body.value)) return fail(c, 400, "invalid_json");
      const result = applyDecision(deps.db, {
        workspaceId: session.workspaceId,
        userId: session.userId,
        caseId: id,
        decision: typeof body.value.decision === "string" ? body.value.decision : "",
        comment: typeof body.value.comment === "string" ? body.value.comment : "",
        recoveredAmount: typeof body.value.recoveredAmount === "string" ? body.value.recoveredAmount : undefined,
        now: current().toISOString(),
      });
      deps.logger("info", "decision_recorded", { caseId: id });
      return c.json(result);
    }),
  );

  app.get("/api/exports/findings.csv", (c) =>
    run(c, async () => {
      const session = await requireSession(c, false);
      if (session instanceof Response) return session;
      return csvResponse(c, findingsCsv(deps.db, session.workspaceId), "vaultify-findings.csv");
    }),
  );

  app.get("/api/exports/audit.csv", (c) =>
    run(c, async () => {
      const session = await requireSession(c, false);
      if (session instanceof Response) return session;
      return csvResponse(c, auditCsv(deps.db, session.workspaceId), "vaultify-audit-log.csv");
    }),
  );

  app.get("/api/audit", (c) =>
    run(c, async () => {
      const session = await requireSession(c, false);
      if (session instanceof Response) return session;
      const limit = clampInt(c.req.query("limit"), 50, 1, 100);
      const offset = clampInt(c.req.query("offset"), 0, 0, 100_000);
      return c.json(listAudit(deps.db, session.workspaceId, limit, offset));
    }),
  );

  app.get("/api/settings", (c) =>
    run(c, async () => {
      const session = await requireSession(c, false);
      if (session instanceof Response) return session;
      return c.json({
        dateWindowDays: session.dateWindowDays,
        amountToleranceMinor: session.amountToleranceMinor,
        role: session.role,
        demo: session.isDemo,
        maxUploadBytes: deps.config.maxUploadBytes,
        maxImportRows: deps.config.maxImportRows,
      });
    }),
  );

  app.patch("/api/settings", (c) =>
    run(c, async () => {
      const session = await requireSession(c, true);
      if (session instanceof Response) return session;
      if (session.role !== "owner") return fail(c, 403, "forbidden");
      const body = await readJson(c);
      if (!body.ok || !isRecord(body.value)) return fail(c, 400, "invalid_json");
      if (typeof body.value.dateWindowDays !== "number" || typeof body.value.amountToleranceMinor !== "string") {
        return fail(c, 400, "invalid_settings");
      }
      updateSettings(deps.db, {
        workspaceId: session.workspaceId,
        userId: session.userId,
        isDemo: session.isDemo,
        dateWindowDays: body.value.dateWindowDays,
        amountToleranceMinor: body.value.amountToleranceMinor,
        now: current().toISOString(),
      });
      const fresh = readSession(deps.db, getCookie(c, "va_session") ?? "", current());
      return c.json({
        dateWindowDays: fresh?.dateWindowDays ?? body.value.dateWindowDays,
        amountToleranceMinor: fresh?.amountToleranceMinor ?? body.value.amountToleranceMinor,
      });
    }),
  );

  app.get("/api/members", (c) =>
    run(c, async () => {
      const session = await requireSession(c, false);
      if (session instanceof Response) return session;
      if (session.role !== "owner") return fail(c, 403, "forbidden");
      return c.json({ members: listWorkspaceMembers(deps.db, session.workspaceId) });
    }),
  );

  app.post("/api/members", (c) =>
    run(c, async () => {
      const session = await requireSession(c, true);
      if (session instanceof Response) return session;
      if (session.role !== "owner") return fail(c, 403, "forbidden");
      const body = await readJson(c);
      if (!body.ok || !isRecord(body.value)) return fail(c, 400, "invalid_json");
      const member = createMember(deps.db, {
        workspaceId: session.workspaceId,
        actorIsDemo: session.isDemo,
        email: typeof body.value.email === "string" ? body.value.email : "",
        name: typeof body.value.name === "string" ? body.value.name : "",
        password: typeof body.value.password === "string" ? body.value.password : "",
        role: typeof body.value.role === "string" ? body.value.role : "",
        now: current().toISOString(),
      });
      writeAudit(deps.db, {
        workspaceId: session.workspaceId,
        actorUserId: session.userId,
        action: "member_created",
        entityType: "user",
        entityId: member.userId,
        metadata: { role: member.role },
        now: current().toISOString(),
      });
      return c.json({ id: member.userId, email: member.email, name: member.name, role: member.role }, 201);
    }),
  );

  app.post("/api/members/:id/password", (c) =>
    run(c, async () => {
      const session = await requireSession(c, true);
      if (session instanceof Response) return session;
      if (session.role !== "owner") return fail(c, 403, "forbidden");
      const id = recordId(c.req.param("id"));
      if (!id) return fail(c, 404, "not_found");
      const body = await readJson(c);
      if (!body.ok || !isRecord(body.value) || typeof body.value.password !== "string") return fail(c, 400, "invalid_json");
      setMemberPassword(deps.db, {
        workspaceId: session.workspaceId,
        actorIsDemo: session.isDemo,
        userId: id,
        password: body.value.password,
      });
      writeAudit(deps.db, {
        workspaceId: session.workspaceId,
        actorUserId: session.userId,
        action: "password_changed",
        entityType: "user",
        entityId: id,
        metadata: { self: id === session.userId },
        now: current().toISOString(),
      });
      return c.json({ ok: true, sessionRevoked: id === session.userId });
    }),
  );

  app.post("/api/workspace/invoice-data/delete", (c) =>
    run(c, async () => {
      const session = await requireSession(c, true);
      if (session instanceof Response) return session;
      if (session.role !== "owner") return fail(c, 403, "forbidden");
      const body = await readJson(c);
      if (!body.ok || !isRecord(body.value)) return fail(c, 400, "invalid_json");
      deleteInvoiceData(deps.db, {
        workspaceId: session.workspaceId,
        userId: session.userId,
        isDemo: session.isDemo,
        confirm: typeof body.value.confirm === "string" ? body.value.confirm : "",
        now: current().toISOString(),
      });
      return c.json({ ok: true });
    }),
  );

  if (deps.staticRoot) {
    const root = deps.staticRoot;
    app.get("*", (c) => serveStatic(c, root));
  }

  app.notFound((c) => (c.req.path.startsWith("/api/") ? fail(c, 404, "not_found") : c.text("Not found", 404)));

  async function requireSession(c: Context, mutating: boolean): Promise<SessionContext | Response> {
    if (mutating) {
      const blocked = assertBrowserMutation(c);
      if (blocked) return blocked;
    }
    const token = getCookie(c, "va_session");
    if (!token) return fail(c, 401, "unauthenticated");
    const session = readSession(deps.db, token, current());
    if (!session) return fail(c, 401, "unauthenticated");
    if (mutating && !tokensMatch(c.req.header("x-csrf-token") ?? "", session.csrfToken)) return fail(c, 403, "csrf_failed");
    return session;
  }

  function clientIp(c: Context): string {
    if (deps.config.allowTestIpHeader) {
      const testIp = c.req.header("x-test-ip");
      if (testIp && testIp.length < 80) return testIp;
    }
    if (deps.config.trustProxy) {
      const forwarded = c.req.header("x-forwarded-for");
      const first = forwarded?.split(",")[0]?.trim();
      if (first) return first.slice(0, 80);
    }
    return "local";
  }

  function setSessionCookie(c: Context, token: string) {
    setCookie(c, "va_session", token, {
      httpOnly: true,
      sameSite: "Lax",
      secure: deps.config.cookieSecure,
      path: "/",
      maxAge: deps.config.sessionTtlHours * 3600,
    });
  }

  return app;
}

function sessionPayload(db: AppDb, userId: string, workspaceId: string, csrfToken: string) {
  const memberships = listMemberships(db, userId);
  const current = memberships.find((item) => item.workspaceId === workspaceId) ?? memberships[0];
  if (!current) throw new ServiceError("forbidden", 403);
  const user = db.prepare("SELECT email, name FROM users WHERE id = ?").get(userId);
  if (!user) throw new ServiceError("unauthenticated", 401);
  return {
    csrfToken,
    demo: current.isDemo,
    user: { id: userId, email: String(user.email), name: String(user.name) },
    workspace: {
      id: current.workspaceId,
      name: current.workspaceName,
      isDemo: current.isDemo,
      dateWindowDays: current.dateWindowDays,
      amountToleranceMinor: current.amountToleranceMinor,
    },
    role: current.role,
    memberships: memberships
      .filter((item) => item.isDemo === current.isDemo)
      .map((item) => ({ id: item.workspaceId, name: item.workspaceName, role: item.role, isDemo: item.isDemo })),
  };
}

function canWrite(role: Role): boolean {
  return role === "owner" || role === "reviewer";
}

function assertBrowserMutation(c: Context): Response | null {
  if (c.req.header("x-vaultify-request") !== "1") return fail(c, 403, "csrf_failed");
  const origin = c.req.header("origin");
  if (!origin) return null;
  const host = c.req.header("host");
  try {
    const url = new URL(origin);
    if (!host || url.host !== host) return fail(c, 403, "csrf_failed");
  } catch {
    return fail(c, 403, "csrf_failed");
  }
  return null;
}

function fail(c: Context, status: number, code: string, details: string[] = []) {
  const safeDetails = details.filter((item) => /^[a-z0-9_:-]+$/.test(item)).slice(0, 20);
  return c.json(
    {
      error: {
        code,
        message: MESSAGES[code] ?? "The request could not be completed.",
        ...(safeDetails.length > 0 ? { details: safeDetails } : {}),
      },
    },
    status as 400,
  );
}

async function readJson(c: Context): Promise<{ ok: true; value: unknown } | { ok: false; status: 400 | 413 }> {
  const declared = Number(c.req.header("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > 1_000_000) return { ok: false, status: 413 };
  const text = await c.req.text();
  if (text.length > 1_000_000) return { ok: false, status: 413 };
  if (!text) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 400 };
  }
}

async function readImportOptions(c: Context) {
  const body = await readJson(c);
  if (!body.ok) throw new ServiceError(body.status === 413 ? "payload_too_large" : "invalid_json", body.status);
  if (!isRecord(body.value) || !isRecord(body.value.mapping)) throw new ServiceError("invalid_mapping", 422);
  const mapping: FieldMapping = {};
  for (const field of IMPORT_FIELDS) {
    const raw = body.value.mapping[field];
    if (raw == null || raw === "") continue;
    if (typeof raw !== "string" || raw.length > 200) throw new ServiceError("invalid_mapping", 422);
    mapping[field] = raw;
  }
  return {
    mapping,
    amountLocale: typeof body.value.amountLocale === "string" ? body.value.amountLocale : "",
    dateFormat: typeof body.value.dateFormat === "string" ? body.value.dateFormat : "",
  };
}

function csvResponse(c: Context, csv: string, filename: string) {
  c.header("content-type", "text/csv; charset=utf-8");
  c.header("content-disposition", `attachment; filename="${filename}"`);
  c.header("cache-control", "no-store");
  return c.body(csv);
}

function recordId(value: string | undefined): string | null {
  if (!value || !/^[\w-]{1,80}$/.test(value)) return null;
  return value;
}

function clampInt(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function serveStatic(c: Context, root: string) {
  if (c.req.path.startsWith("/api/")) return fail(c, 404, "not_found");
  let pathname = "/";
  try {
    pathname = decodeURIComponent(new URL(c.req.url).pathname);
  } catch {
    return c.text("Not found", 404);
  }
  if (pathname.includes("\0")) return c.text("Not found", 404);
  const relative = (pathname.endsWith("/") ? `${pathname}index.html` : pathname).replace(/^\/+/, "");
  const full = normalize(join(root, relative));
  const rootNorm = normalize(root + sep);
  if (full !== normalize(root) && !full.startsWith(rootNorm)) return c.text("Not found", 404);
  try {
    const data = await readFile(full);
    c.header("content-type", contentType(full));
    c.header("cache-control", full.endsWith(`${sep}index.html`) || full.endsWith("index.html") ? "no-store" : "public, max-age=3600");
    return c.body(data);
  } catch {
    if (extname(relative)) return c.text("Not found", 404);
    try {
      const html = await readFile(join(root, "index.html"));
      c.header("content-type", "text/html; charset=utf-8");
      c.header("cache-control", "no-store");
      return c.body(html);
    } catch {
      return c.text("Not found", 404);
    }
  }
}

function contentType(path: string): string {
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".map": "application/json; charset=utf-8",
  };
  return types[extname(path)] ?? "application/octet-stream";
}
