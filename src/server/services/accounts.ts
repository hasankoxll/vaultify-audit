import { randomUUID } from "node:crypto";
import type { AppDb } from "../db.js";
import { requiredNumber, requiredText } from "../db.js";
import { dummyPasswordCheck, hashPassword, verifyPassword } from "../crypto.js";
import { cleanName, normalizeEmail, passwordError } from "../passwords.js";
import { DEMO_WORKSPACE_ID } from "../demo-constants.js";

export type Role = "owner" | "reviewer" | "read_only";

export interface MembershipView {
  workspaceId: string;
  workspaceName: string;
  isDemo: boolean;
  role: Role;
  dateWindowDays: number;
  amountToleranceMinor: string;
}

export function createWorkspace(
  db: AppDb,
  input: { id?: string; name: string; isDemo?: boolean; now: string },
): string {
  const id = input.id ?? randomUUID();
  db.prepare(
    `INSERT INTO workspaces (id, name, is_demo, date_window_days, amount_tolerance_minor, created_at)
     VALUES (?, ?, ?, 3, '0', ?)`,
  ).run(id, input.name, input.isDemo ? 1 : 0, input.now);
  return id;
}

export function createUser(
  db: AppDb,
  input: { id?: string; email: string; name: string; password: string; now: string; skipPolicy?: boolean },
): string {
  const email = normalizeEmail(input.email);
  const name = cleanName(input.name);
  if (!email || !name) throw new ServiceError("invalid_user", 400);
  if (!input.skipPolicy) {
    const error = passwordError(input.password);
    if (error) throw new ServiceError(error, 400);
  }
  const id = input.id ?? randomUUID();
  db.prepare(`INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)`).run(
    id,
    email,
    name,
    hashPassword(input.password),
    input.now,
  );
  return id;
}

export function addMembership(db: AppDb, input: { workspaceId: string; userId: string; role: Role; now: string }): string {
  if (!isRole(input.role)) throw new ServiceError("invalid_role", 400);
  const workspace = db.prepare("SELECT is_demo FROM workspaces WHERE id = ?").get(input.workspaceId);
  if (!workspace) throw new ServiceError("workspace_not_found", 404);
  const existing = db
    .prepare(
      `SELECT w.is_demo AS is_demo FROM memberships m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ?`,
    )
    .all(input.userId);
  const targetDemo = requiredNumber(workspace, "is_demo") === 1;
  const hasDemo = existing.some((row) => requiredNumber(row, "is_demo") === 1);
  const hasReal = existing.some((row) => requiredNumber(row, "is_demo") === 0);
  if ((targetDemo && (hasDemo || hasReal)) || (!targetDemo && hasDemo)) throw new ServiceError("demo_isolation", 409);
  const id = randomUUID();
  db.prepare(`INSERT INTO memberships (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)`).run(
    id,
    input.workspaceId,
    input.userId,
    input.role,
    input.now,
  );
  return id;
}

export function authenticate(db: AppDb, emailRaw: string, password: string): { userId: string } | null {
  if (typeof password !== "string" || password.length < 1 || password.length > 128) {
    dummyPasswordCheck("invalid-password");
    return null;
  }
  const email = normalizeEmail(emailRaw);
  if (!email) {
    dummyPasswordCheck(password);
    return null;
  }
  const user = db.prepare("SELECT id, password_hash FROM users WHERE email = ?").get(email);
  if (!user) {
    dummyPasswordCheck(password);
    return null;
  }
  const ok = verifyPassword(password, requiredText(user, "password_hash"));
  if (!ok) return null;
  return { userId: requiredText(user, "id") };
}

export function listMemberships(db: AppDb, userId: string): MembershipView[] {
  const rows = db
    .prepare(
      `SELECT w.id AS workspace_id, w.name AS workspace_name, w.is_demo AS is_demo, w.date_window_days AS date_window_days,
              w.amount_tolerance_minor AS amount_tolerance_minor, m.role AS role
       FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
       WHERE m.user_id = ?
       ORDER BY w.is_demo ASC, w.name ASC`,
    )
    .all(userId);
  return rows.map(mapMembership);
}

export function membershipFor(db: AppDb, userId: string, workspaceId: string): MembershipView | null {
  const row = db
    .prepare(
      `SELECT w.id AS workspace_id, w.name AS workspace_name, w.is_demo AS is_demo, w.date_window_days AS date_window_days,
              w.amount_tolerance_minor AS amount_tolerance_minor, m.role AS role
       FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
       WHERE m.user_id = ? AND w.id = ?`,
    )
    .get(userId, workspaceId);
  return row ? mapMembership(row) : null;
}

export function createMember(
  db: AppDb,
  input: { workspaceId: string; actorIsDemo: boolean; email: string; name: string; password: string; role: string; now: string },
): { userId: string; email: string; name: string; role: Role } {
  if (input.actorIsDemo || input.workspaceId === DEMO_WORKSPACE_ID) throw new ServiceError("demo_forbidden", 403);
  if (!isRole(input.role)) throw new ServiceError("invalid_role", 400);
  const email = normalizeEmail(input.email);
  const name = cleanName(input.name);
  if (!email || !name) throw new ServiceError("invalid_user", 400);
  const policy = passwordError(input.password);
  if (policy) throw new ServiceError(policy, 400);
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) throw new ServiceError("email_in_use", 409);
  const userId = createUser(db, { email, name, password: input.password, now: input.now });
  addMembership(db, { workspaceId: input.workspaceId, userId, role: input.role, now: input.now });
  return { userId, email, name, role: input.role };
}

export function setMemberPassword(
  db: AppDb,
  input: { workspaceId: string; actorIsDemo: boolean; userId: string; password: string },
): void {
  if (input.actorIsDemo || input.workspaceId === DEMO_WORKSPACE_ID) throw new ServiceError("demo_forbidden", 403);
  const membership = db
    .prepare("SELECT id FROM memberships WHERE workspace_id = ? AND user_id = ?")
    .get(input.workspaceId, input.userId);
  if (!membership) throw new ServiceError("not_found", 404);
  const policy = passwordError(input.password);
  if (policy) throw new ServiceError(policy, 400);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(input.password), input.userId);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(input.userId);
}

export function listWorkspaceMembers(db: AppDb, workspaceId: string) {
  return db
    .prepare(
      `SELECT u.id AS id, u.email AS email, u.name AS name, m.role AS role, m.created_at AS created_at
       FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = ?
       ORDER BY u.email ASC`,
    )
    .all(workspaceId)
    .map((row) => ({
      id: requiredText(row, "id"),
      email: requiredText(row, "email"),
      name: requiredText(row, "name"),
      role: requiredText(row, "role"),
      createdAt: requiredText(row, "created_at"),
    }));
}

export class ServiceError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: string[];

  constructor(code: string, status: number, details: string[] = []) {
    super(code);
    this.name = "ServiceError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function isRole(value: string): value is Role {
  return value === "owner" || value === "reviewer" || value === "read_only";
}

function mapMembership(row: Record<string, unknown>): MembershipView {
  const role = requiredText(row, "role");
  if (!isRole(role)) throw new ServiceError("invalid_role", 500);
  return {
    workspaceId: requiredText(row, "workspace_id"),
    workspaceName: requiredText(row, "workspace_name"),
    isDemo: requiredNumber(row, "is_demo") === 1,
    role,
    dateWindowDays: requiredNumber(row, "date_window_days"),
    amountToleranceMinor: requiredText(row, "amount_tolerance_minor"),
  };
}
