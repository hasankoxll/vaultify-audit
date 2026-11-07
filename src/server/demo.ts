import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AppDb } from "./db.js";
import { transaction } from "./db.js";
import { writeAudit } from "./audit.js";
import {
  DEMO_EMAIL,
  DEMO_PASSWORD,
  DEMO_USER_ID,
  DEMO_USER_NAME,
  DEMO_WORKSPACE_ID,
  DEMO_WORKSPACE_NAME,
} from "./demo-constants.js";
import { addMembership, createUser, createWorkspace, ServiceError } from "./services/accounts.js";
import { commitCsvText } from "./services/imports.js";

export function readSyntheticCsv(): string {
  return readFileSync(join(process.cwd(), "samples", "synthetic-demo.csv"), "utf8");
}

export function ensureDemo(db: AppDb, csvText: string, now = new Date().toISOString()): void {
  const workspace = db.prepare("SELECT id FROM workspaces WHERE id = ?").get(DEMO_WORKSPACE_ID);
  if (!workspace) createWorkspace(db, { id: DEMO_WORKSPACE_ID, name: DEMO_WORKSPACE_NAME, isDemo: true, now });
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(DEMO_USER_ID);
  if (!user) {
    createUser(db, {
      id: DEMO_USER_ID,
      email: DEMO_EMAIL,
      name: DEMO_USER_NAME,
      password: DEMO_PASSWORD,
      now,
      skipPolicy: true,
    });
  }
  const membership = db
    .prepare("SELECT id FROM memberships WHERE workspace_id = ? AND user_id = ?")
    .get(DEMO_WORKSPACE_ID, DEMO_USER_ID);
  if (!membership) addMembership(db, { workspaceId: DEMO_WORKSPACE_ID, userId: DEMO_USER_ID, role: "reviewer", now });
  const imported = db
    .prepare("SELECT id FROM imports WHERE workspace_id = ? AND status != 'uploaded' LIMIT 1")
    .get(DEMO_WORKSPACE_ID);
  if (!imported) {
    commitCsvText(db, {
      workspaceId: DEMO_WORKSPACE_ID,
      userId: DEMO_USER_ID,
      filename: "synthetic-demo.csv",
      csvText,
      maxImportRows: 5_000,
      now,
    });
  }
}

export function resetDemo(db: AppDb, actorUserId: string, csvText: string, now: string): void {
  const membership = db
    .prepare("SELECT role FROM memberships WHERE user_id = ? AND workspace_id = ?")
    .get(actorUserId, DEMO_WORKSPACE_ID);
  if (!membership) throw new ServiceError("forbidden", 403);
  transaction(db, () => {
    db.prepare("DELETE FROM decisions WHERE workspace_id = ?").run(DEMO_WORKSPACE_ID);
    db.prepare("DELETE FROM case_rows WHERE workspace_id = ?").run(DEMO_WORKSPACE_ID);
    db.prepare("DELETE FROM cases WHERE workspace_id = ?").run(DEMO_WORKSPACE_ID);
    db.prepare("DELETE FROM source_rows WHERE workspace_id = ?").run(DEMO_WORKSPACE_ID);
    db.prepare("DELETE FROM import_files WHERE import_id IN (SELECT id FROM imports WHERE workspace_id = ?)").run(DEMO_WORKSPACE_ID);
    db.prepare("DELETE FROM imports WHERE workspace_id = ?").run(DEMO_WORKSPACE_ID);
    commitCsvText(db, {
      workspaceId: DEMO_WORKSPACE_ID,
      userId: actorUserId,
      filename: "synthetic-demo.csv",
      csvText,
      maxImportRows: 5_000,
      now,
      inTransaction: true,
    });
    writeAudit(db, {
      workspaceId: DEMO_WORKSPACE_ID,
      actorUserId,
      action: "demo_reset",
      entityType: "workspace",
      entityId: DEMO_WORKSPACE_ID,
      metadata: { synthetic: true },
      now,
    });
  });
}
