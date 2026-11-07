import { randomUUID } from "node:crypto";
import type { AppDb } from "./db.js";

export function writeAudit(
  db: AppDb,
  event: {
    workspaceId: string;
    actorUserId: string | null;
    action: string;
    entityType: string;
    entityId: string;
    metadata: Record<string, string | number | boolean | null>;
    now: string;
  },
): void {
  db.prepare(
    `INSERT INTO audit_events (id, workspace_id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    event.workspaceId,
    event.actorUserId,
    event.action,
    event.entityType,
    event.entityId,
    JSON.stringify(event.metadata),
    event.now,
  );
}
