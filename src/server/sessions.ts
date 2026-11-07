import { randomUUID } from "node:crypto";
import type { AppDb } from "./db.js";
import { requiredNumber, requiredText } from "./db.js";
import { hashToken, randomToken } from "./crypto.js";
import { isRole, membershipFor, type Role, ServiceError } from "./services/accounts.js";

export interface SessionContext {
  sessionId: string;
  userId: string;
  email: string;
  name: string;
  workspaceId: string;
  workspaceName: string;
  role: Role;
  isDemo: boolean;
  csrfToken: string;
  dateWindowDays: number;
  amountToleranceMinor: string;
}

export function createSession(
  db: AppDb,
  input: { userId: string; workspaceId: string; isDemo: boolean; ttlHours: number; now: Date },
): { token: string; csrfToken: string } {
  const token = randomToken();
  const csrfToken = randomToken();
  const expires = new Date(input.now.getTime() + input.ttlHours * 3_600_000).toISOString();
  db.prepare(
    `INSERT INTO sessions (id, user_id, workspace_id, token_hash, csrf_token, is_demo, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    input.userId,
    input.workspaceId,
    hashToken(token),
    csrfToken,
    input.isDemo ? 1 : 0,
    expires,
    input.now.toISOString(),
  );
  return { token, csrfToken };
}

export function readSession(db: AppDb, token: string, now: Date): SessionContext | null {
  const row = db
    .prepare(
      `SELECT s.id AS session_id, s.user_id AS user_id, s.workspace_id AS workspace_id, s.csrf_token AS csrf_token,
              s.is_demo AS session_demo, s.expires_at AS expires_at, u.email AS email, u.name AS name, m.role AS role,
              w.name AS workspace_name, w.is_demo AS workspace_demo, w.date_window_days AS date_window_days,
              w.amount_tolerance_minor AS amount_tolerance_minor
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN memberships m ON m.user_id = s.user_id AND m.workspace_id = s.workspace_id
       JOIN workspaces w ON w.id = s.workspace_id
       WHERE s.token_hash = ?`,
    )
    .get(hashToken(token));
  if (!row) return null;
  if (requiredText(row, "expires_at") <= now.toISOString()) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(requiredText(row, "session_id"));
    return null;
  }
  const workspaceDemo = requiredNumber(row, "workspace_demo") === 1;
  const sessionDemo = requiredNumber(row, "session_demo") === 1;
  if (workspaceDemo !== sessionDemo) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(requiredText(row, "session_id"));
    return null;
  }
  const role = requiredText(row, "role");
  if (!isRole(role)) return null;
  return {
    sessionId: requiredText(row, "session_id"),
    userId: requiredText(row, "user_id"),
    email: requiredText(row, "email"),
    name: requiredText(row, "name"),
    workspaceId: requiredText(row, "workspace_id"),
    workspaceName: requiredText(row, "workspace_name"),
    role,
    isDemo: workspaceDemo,
    csrfToken: requiredText(row, "csrf_token"),
    dateWindowDays: requiredNumber(row, "date_window_days"),
    amountToleranceMinor: requiredText(row, "amount_tolerance_minor"),
  };
}

export function deleteSession(db: AppDb, token: string): void {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

export function switchWorkspace(db: AppDb, session: SessionContext, workspaceId: string): void {
  const membership = membershipFor(db, session.userId, workspaceId);
  if (!membership) throw new ServiceError("not_found", 404);
  if (membership.isDemo !== session.isDemo) throw new ServiceError("demo_isolation", 403);
  if (session.isDemo && membership.workspaceId !== session.workspaceId) throw new ServiceError("demo_isolation", 403);
  db.prepare("UPDATE sessions SET workspace_id = ?, is_demo = ? WHERE id = ? AND user_id = ?").run(
    membership.workspaceId,
    membership.isDemo ? 1 : 0,
    session.sessionId,
    session.userId,
  );
}
