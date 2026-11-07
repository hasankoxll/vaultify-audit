import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { currencyDigits } from "../../domain/currencies.js";
import { parseAmount } from "../../domain/money.js";
import { buildCaseDrafts, type MatchableRow } from "../../domain/matching.js";
import type { AppDb } from "../db.js";
import { requiredNumber, requiredText, transaction } from "../db.js";
import { writeAudit } from "../audit.js";
import { ServiceError } from "./accounts.js";

export interface RecomputeResult {
  created: number;
  updated: number;
  removed: number;
  dissolved: number;
}

export function recomputeWorkspace(db: AppDb, workspaceId: string, now: string): RecomputeResult {
  const workspace = db
    .prepare("SELECT date_window_days, amount_tolerance_minor FROM workspaces WHERE id = ?")
    .get(workspaceId);
  if (!workspace) throw new ServiceError("workspace_not_found", 404);
  const tolerance = BigInt(requiredText(workspace, "amount_tolerance_minor"));
  const settings = {
    dateWindowDays: requiredNumber(workspace, "date_window_days"),
    amountToleranceMinor: tolerance,
  };
  const source = db
    .prepare(
      `SELECT id, supplier_key, invoice_key, currency, amount_minor, invoice_date, supplier_name_raw, supplier_id_raw, invoice_number_raw
       FROM source_rows WHERE workspace_id = ? AND matchable = 1`,
    )
    .all(workspaceId);
  const matchable: MatchableRow[] = source.map((row) => ({
    id: requiredText(row, "id"),
    supplierKey: requiredText(row, "supplier_key"),
    invoiceKey: requiredText(row, "invoice_key"),
    currency: requiredText(row, "currency"),
    amountMinor: BigInt(requiredText(row, "amount_minor")),
    invoiceDate: requiredText(row, "invoice_date"),
    supplierDisplay: requiredText(row, "supplier_name_raw") || requiredText(row, "supplier_id_raw"),
    invoiceDisplay: requiredText(row, "invoice_number_raw"),
  }));
  const drafts = buildCaseDrafts(matchable, settings);
  const existingRows = db.prepare("SELECT * FROM cases WHERE workspace_id = ?").all(workspaceId);
  const existing = new Map(existingRows.map((row) => [requiredText(row, "group_key"), row]));
  const seen = new Set<string>();
  const result: RecomputeResult = { created: 0, updated: 0, removed: 0, dissolved: 0 };

  for (const draft of drafts) {
    seen.add(draft.groupKey);
    const previous = existing.get(draft.groupKey);
    const reasons = JSON.stringify(draft.reasons);
    if (!previous) {
      const id = stableCaseId(workspaceId, draft.groupKey);
      db.prepare(
        `INSERT INTO cases (
          id, workspace_id, match_type, group_key, supplier_key, invoice_key, currency, exposure_minor, recovered_minor,
          confidence, reasons_json, status, display_supplier, display_invoice, member_fingerprint, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '0', ?, ?, 'open', ?, ?, ?, ?, ?)`,
      ).run(
        id,
        workspaceId,
        draft.matchType,
        draft.groupKey,
        draft.supplierKey,
        draft.invoiceKey,
        draft.currency,
        draft.exposureMinor.toString(),
        draft.confidence,
        reasons,
        draft.displaySupplier,
        draft.displayInvoice,
        draft.fingerprint,
        now,
        now,
      );
      replaceMembers(db, workspaceId, id, draft.members);
      result.created += 1;
      continue;
    }
    const caseId = requiredText(previous, "id");
    let status = requiredText(previous, "status");
    if (status === "dissolved") status = "open";
    const changed =
      requiredText(previous, "exposure_minor") !== draft.exposureMinor.toString() ||
      requiredText(previous, "member_fingerprint") !== draft.fingerprint ||
      requiredText(previous, "reasons_json") !== reasons ||
      requiredText(previous, "confidence") !== draft.confidence ||
      requiredText(previous, "display_supplier") !== draft.displaySupplier ||
      requiredText(previous, "display_invoice") !== draft.displayInvoice ||
      requiredText(previous, "status") !== status;
    if (changed) {
      db.prepare(
        `UPDATE cases SET exposure_minor = ?, confidence = ?, reasons_json = ?, status = ?, display_supplier = ?,
         display_invoice = ?, member_fingerprint = ?, invoice_key = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`,
      ).run(
        draft.exposureMinor.toString(),
        draft.confidence,
        reasons,
        status,
        draft.displaySupplier,
        draft.displayInvoice,
        draft.fingerprint,
        draft.invoiceKey,
        now,
        caseId,
        workspaceId,
      );
      replaceMembers(db, workspaceId, caseId, draft.members);
      result.updated += 1;
    }
  }

  for (const row of existingRows) {
    const groupKey = requiredText(row, "group_key");
    if (seen.has(groupKey)) continue;
    const caseId = requiredText(row, "id");
    const status = requiredText(row, "status");
    const recovered = requiredText(row, "recovered_minor");
    if (status === "open" && recovered === "0") {
      db.prepare("DELETE FROM case_rows WHERE case_id = ? AND workspace_id = ?").run(caseId, workspaceId);
      db.prepare("DELETE FROM decisions WHERE case_id = ? AND workspace_id = ?").run(caseId, workspaceId);
      db.prepare("DELETE FROM cases WHERE id = ? AND workspace_id = ?").run(caseId, workspaceId);
      result.removed += 1;
      continue;
    }
    db.prepare("DELETE FROM case_rows WHERE case_id = ? AND workspace_id = ?").run(caseId, workspaceId);
    db.prepare(
      `UPDATE cases SET status = 'dissolved', exposure_minor = '0', recovered_minor = '0', member_fingerprint = '', updated_at = ?
       WHERE id = ? AND workspace_id = ?`,
    ).run(now, caseId, workspaceId);
    result.dissolved += 1;
  }
  return result;
}

export function applyDecision(
  db: AppDb,
  input: {
    workspaceId: string;
    userId: string;
    caseId: string;
    decision: string;
    comment: string;
    recoveredAmount?: string;
    now: string;
  },
): { status: string; recoveredMinor: string } {
  const allowed = new Set(["confirm_for_review", "false_positive", "reopen", "record_recovery", "clear_recovery"]);
  if (!allowed.has(input.decision)) throw new ServiceError("invalid_decision", 400);
  const comment = input.comment.trim();
  if (comment.length < 3 || comment.length > 2_000) throw new ServiceError("invalid_comment", 400);
  const row = db.prepare("SELECT * FROM cases WHERE id = ? AND workspace_id = ?").get(input.caseId, input.workspaceId);
  if (!row) throw new ServiceError("not_found", 404);
  const status = requiredText(row, "status");
  if (status === "dissolved") throw new ServiceError("invalid_state", 409);
  const matchType = requiredText(row, "match_type");
  const exposure = BigInt(requiredText(row, "exposure_minor"));
  let nextStatus = status;
  let recovered = BigInt(requiredText(row, "recovered_minor"));
  let recorded: string | null = null;

  if (input.decision === "confirm_for_review") {
    if (status === "false_positive") throw new ServiceError("invalid_state", 409);
    nextStatus = "confirmed_for_review";
  } else if (input.decision === "false_positive") {
    nextStatus = "false_positive";
    recovered = 0n;
  } else if (input.decision === "reopen") {
    nextStatus = "open";
  } else if (input.decision === "clear_recovery") {
    if (status === "false_positive") throw new ServiceError("invalid_state", 409);
    recovered = 0n;
  } else if (input.decision === "record_recovery") {
    if (matchType !== "exact") throw new ServiceError("recovery_exact_only", 409);
    if (status === "false_positive") throw new ServiceError("invalid_state", 409);
    const digits = currencyDigits(requiredText(row, "currency"));
    if (digits === null) throw new ServiceError("unsupported_currency", 400);
    const parsed = parseAmount(input.recoveredAmount ?? "", "plain", digits);
    if (!parsed.ok || parsed.minor <= 0n || parsed.minor > exposure) throw new ServiceError("invalid_recovery", 400);
    recovered = parsed.minor;
    recorded = recovered.toString();
  }

  const recoveredText = recovered.toString();
  transaction(db, () => {
    db.prepare(
      `UPDATE cases SET status = ?, recovered_minor = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`,
    ).run(nextStatus, recoveredText, input.now, input.caseId, input.workspaceId);
    db.prepare(
      `INSERT INTO decisions (id, workspace_id, case_id, user_id, decision, comment, recovered_minor, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), input.workspaceId, input.caseId, input.userId, input.decision, comment, recorded, input.now);
    writeAudit(db, {
      workspaceId: input.workspaceId,
      actorUserId: input.userId,
      action: "decision_recorded",
      entityType: "case",
      entityId: input.caseId,
      metadata: {
        decision: input.decision,
        commentLength: comment.length,
        matchType,
        status: nextStatus,
      },
      now: input.now,
    });
  });
  return { status: nextStatus, recoveredMinor: recoveredText };
}

export function updateSettings(
  db: AppDb,
  input: { workspaceId: string; userId: string; isDemo: boolean; dateWindowDays: number; amountToleranceMinor: string; now: string },
): RecomputeResult {
  if (input.isDemo) throw new ServiceError("demo_forbidden", 403);
  if (!Number.isInteger(input.dateWindowDays) || input.dateWindowDays < 0 || input.dateWindowDays > 31) {
    throw new ServiceError("invalid_settings", 400);
  }
  if (!/^\d{1,10}$/.test(input.amountToleranceMinor)) throw new ServiceError("invalid_settings", 400);
  const tolerance = BigInt(input.amountToleranceMinor);
  if (tolerance > 1_000_000_000n) throw new ServiceError("invalid_settings", 400);
  let result: RecomputeResult = { created: 0, updated: 0, removed: 0, dissolved: 0 };
  transaction(db, () => {
    db.prepare("UPDATE workspaces SET date_window_days = ?, amount_tolerance_minor = ? WHERE id = ?").run(
      input.dateWindowDays,
      tolerance.toString(),
      input.workspaceId,
    );
    result = recomputeWorkspace(db, input.workspaceId, input.now);
    writeAudit(db, {
      workspaceId: input.workspaceId,
      actorUserId: input.userId,
      action: "settings_updated",
      entityType: "workspace",
      entityId: input.workspaceId,
      metadata: {
        dateWindowDays: input.dateWindowDays,
        amountToleranceMinor: tolerance.toString(),
        created: result.created,
        updated: result.updated,
        removed: result.removed,
        dissolved: result.dissolved,
      },
      now: input.now,
    });
  });
  return result;
}

function replaceMembers(db: AppDb, workspaceId: string, caseId: string, members: { id: string; role: "primary" | "extra" }[]) {
  db.prepare("DELETE FROM case_rows WHERE case_id = ? AND workspace_id = ?").run(caseId, workspaceId);
  const insert = db.prepare(
    "INSERT INTO case_rows (case_id, source_row_id, workspace_id, role) VALUES (?, ?, ?, ?)",
  );
  for (const member of members) insert.run(caseId, member.id, workspaceId, member.role);
}

function stableCaseId(workspaceId: string, groupKey: string): string {
  const digest = createHash("sha256").update(`${workspaceId}\u001f${groupKey}`).digest("hex").slice(0, 32);
  return `case_${digest}`;
}
