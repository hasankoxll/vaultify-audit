import { aggregateCases } from "../../domain/aggregate.js";
import { encodeCsv } from "../../domain/csv.js";
import { currencyDigits } from "../../domain/currencies.js";
import { formatPlainMinor } from "../../domain/money.js";
import type { AppDb } from "../db.js";
import { requiredText } from "../db.js";

export function dashboard(db: AppDb, workspaceId: string) {
  const cases = db
    .prepare(
      `SELECT match_type, currency, exposure_minor, recovered_minor, status FROM cases WHERE workspace_id = ?`,
    )
    .all(workspaceId);
  const totals = aggregateCases(
    cases.map((row) => ({
      matchType: requiredText(row, "match_type") as "exact" | "proximity",
      currency: requiredText(row, "currency"),
      exposureMinor: BigInt(requiredText(row, "exposure_minor")),
      recoveredMinor: BigInt(requiredText(row, "recovered_minor")),
      status: requiredText(row, "status"),
    })),
  );
  const rowStats = db
    .prepare(
      `SELECT COUNT(*) AS source_rows,
              COALESCE(SUM(CASE WHEN error_codes != '[]' THEN 1 ELSE 0 END), 0) AS invalid_rows,
              COALESCE(SUM(CASE WHEN error_codes = '[]' AND exclusion_codes != '[]' THEN 1 ELSE 0 END), 0) AS excluded_rows,
              COALESCE(SUM(CASE WHEN matchable = 1 THEN 1 ELSE 0 END), 0) AS matchable_rows
       FROM source_rows WHERE workspace_id = ?`,
    )
    .get(workspaceId);
  const importCount = db.prepare("SELECT COUNT(*) AS n FROM imports WHERE workspace_id = ?").get(workspaceId);
  const countStatus = (status: string) => cases.filter((row) => requiredText(row, "status") === status).length;
  return {
    exactExposure: totals.exactExposure.map(serializeTotal),
    proximityExposure: totals.proximityExposure.map(serializeTotal),
    realizedRecovery: totals.realizedRecovery.map(serializeTotal),
    counts: {
      imports: asNumber(importCount?.n),
      sourceRows: asNumber(rowStats?.source_rows),
      invalidRows: asNumber(rowStats?.invalid_rows),
      excludedRows: asNumber(rowStats?.excluded_rows),
      matchableRows: asNumber(rowStats?.matchable_rows),
      openCases: countStatus("open"),
      confirmedCases: countStatus("confirmed_for_review"),
      falsePositiveCases: countStatus("false_positive"),
      exactCases: cases.filter((row) => requiredText(row, "match_type") === "exact" && requiredText(row, "status") !== "dissolved").length,
      proximityCases: cases.filter((row) => requiredText(row, "match_type") === "proximity" && requiredText(row, "status") !== "dissolved").length,
    },
  };
}

export function listImports(db: AppDb, workspaceId: string) {
  return db
    .prepare(
      `SELECT id, filename, status, row_count, valid_count, invalid_count, excluded_count, created_at, committed_at
       FROM imports WHERE workspace_id = ? ORDER BY created_at DESC`,
    )
    .all(workspaceId)
    .map((row) => ({
      id: requiredText(row, "id"),
      filename: requiredText(row, "filename"),
      status: requiredText(row, "status"),
      rowCount: asNumber(row.row_count),
      validCount: asNumber(row.valid_count),
      invalidCount: asNumber(row.invalid_count),
      excludedCount: asNumber(row.excluded_count),
      createdAt: requiredText(row, "created_at"),
      committedAt: row.committed_at == null ? null : requiredText(row, "committed_at"),
    }));
}

export function getImport(db: AppDb, workspaceId: string, importId: string) {
  const row = db
    .prepare(
      `SELECT id, filename, status, row_count, valid_count, invalid_count, excluded_count, created_at, committed_at, mapping_json, amount_locale, date_format
       FROM imports WHERE id = ? AND workspace_id = ?`,
    )
    .get(importId, workspaceId);
  if (!row) return null;
  const issues = db
    .prepare(
      `SELECT row_number, supplier_name_raw, supplier_id_raw, invoice_number_raw, error_codes, exclusion_codes
       FROM source_rows
       WHERE import_id = ? AND workspace_id = ? AND (error_codes != '[]' OR exclusion_codes != '[]')
       ORDER BY row_number ASC LIMIT 200`,
    )
    .all(importId, workspaceId)
    .map((issue) => ({
      rowNumber: asNumber(issue.row_number),
      supplierName: requiredText(issue, "supplier_name_raw") || requiredText(issue, "supplier_id_raw"),
      invoiceNumber: requiredText(issue, "invoice_number_raw"),
      errorCodes: jsonStringArray(requiredText(issue, "error_codes")),
      exclusionCodes: jsonStringArray(requiredText(issue, "exclusion_codes")),
    }));
  return {
    id: requiredText(row, "id"),
    filename: requiredText(row, "filename"),
    status: requiredText(row, "status"),
    rowCount: asNumber(row.row_count),
    validCount: asNumber(row.valid_count),
    invalidCount: asNumber(row.invalid_count),
    excludedCount: asNumber(row.excluded_count),
    createdAt: requiredText(row, "created_at"),
    committedAt: row.committed_at == null ? null : requiredText(row, "committed_at"),
    amountLocale: row.amount_locale == null ? null : requiredText(row, "amount_locale"),
    dateFormat: row.date_format == null ? null : requiredText(row, "date_format"),
    issues,
  };
}

export interface CaseFilters {
  status: string;
  matchType: string;
  currency: string;
  q: string;
  limit: number;
  offset: number;
}

export function listCases(db: AppDb, workspaceId: string, filters: CaseFilters) {
  const pattern = filters.q ? `%${filters.q.toLowerCase().replace(/[\\%_]/g, (char) => `\\${char}`)}%` : "";
  const rows = db
    .prepare(
      `SELECT id, match_type, currency, exposure_minor, recovered_minor, confidence, status, display_supplier, display_invoice,
              reasons_json, member_fingerprint, updated_at
       FROM cases
       WHERE workspace_id = ?
         AND (? = '' OR status = ?)
         AND (? = '' OR match_type = ?)
         AND (? = '' OR currency = ?)
         AND (
           ? = ''
           OR lower(display_supplier) LIKE ? ESCAPE '\\'
           OR lower(display_invoice) LIKE ? ESCAPE '\\'
           OR EXISTS (
             SELECT 1 FROM case_rows cr
             JOIN source_rows sr ON sr.id = cr.source_row_id AND sr.workspace_id = cr.workspace_id
             WHERE cr.case_id = cases.id AND cr.workspace_id = cases.workspace_id
               AND (
                 lower(sr.supplier_name_raw) LIKE ? ESCAPE '\\'
                 OR lower(sr.supplier_id_raw) LIKE ? ESCAPE '\\'
                 OR lower(sr.invoice_number_raw) LIKE ? ESCAPE '\\'
               )
           )
         )
       ORDER BY updated_at DESC, id ASC`,
    )
    .all(
      workspaceId,
      filters.status,
      filters.status,
      filters.matchType,
      filters.matchType,
      filters.currency,
      filters.currency,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
    );
  const page = rows.slice(filters.offset, filters.offset + filters.limit).map(mapCaseSummary);
  return { total: rows.length, cases: page };
}

export function getCase(db: AppDb, workspaceId: string, caseId: string) {
  const row = db.prepare("SELECT * FROM cases WHERE id = ? AND workspace_id = ?").get(caseId, workspaceId);
  if (!row) return null;
  const members = db
    .prepare(
      `SELECT sr.*, cr.role AS member_role
       FROM case_rows cr
       JOIN source_rows sr ON sr.id = cr.source_row_id AND sr.workspace_id = cr.workspace_id
       WHERE cr.case_id = ? AND cr.workspace_id = ?
       ORDER BY CASE cr.role WHEN 'primary' THEN 0 ELSE 1 END, sr.row_number ASC`,
    )
    .all(caseId, workspaceId)
    .map(mapMember);
  const decisions = db
    .prepare(
      `SELECT d.id AS id, d.decision AS decision, d.comment AS comment, d.recovered_minor AS recovered_minor,
              d.created_at AS created_at, u.name AS actor_name
       FROM decisions d JOIN users u ON u.id = d.user_id
       WHERE d.case_id = ? AND d.workspace_id = ?
       ORDER BY d.created_at DESC`,
    )
    .all(caseId, workspaceId)
    .map((decision) => ({
      id: requiredText(decision, "id"),
      decision: requiredText(decision, "decision"),
      comment: requiredText(decision, "comment"),
      recoveredMinor: decision.recovered_minor == null ? null : requiredText(decision, "recovered_minor"),
      createdAt: requiredText(decision, "created_at"),
      actorName: requiredText(decision, "actor_name"),
    }));
  return { ...mapCaseSummary(row), members, decisions };
}

export function listAudit(db: AppDb, workspaceId: string, limit: number, offset: number) {
  const totalRow = db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE workspace_id = ?").get(workspaceId);
  const events = db
    .prepare(
      `SELECT id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at
       FROM audit_events WHERE workspace_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    )
    .all(workspaceId, limit, offset)
    .map((row) => ({
      id: requiredText(row, "id"),
      actorUserId: row.actor_user_id == null ? null : requiredText(row, "actor_user_id"),
      action: requiredText(row, "action"),
      entityType: requiredText(row, "entity_type"),
      entityId: requiredText(row, "entity_id"),
      metadata: jsonObject(requiredText(row, "metadata_json")),
      createdAt: requiredText(row, "created_at"),
    }));
  return { total: asNumber(totalRow?.n), events };
}

export function findingsCsv(db: AppDb, workspaceId: string): string {
  const rows = db
    .prepare(
      `SELECT c.id AS id, c.match_type AS match_type, c.status AS status, c.confidence AS confidence, c.currency AS currency,
              c.exposure_minor AS exposure_minor, c.recovered_minor AS recovered_minor, c.display_supplier AS display_supplier,
              c.display_invoice AS display_invoice, c.reasons_json AS reasons_json,
              d.decision AS decision, d.comment AS comment, d.created_at AS decision_at
       FROM cases c
       LEFT JOIN decisions d ON d.id = (
         SELECT id FROM decisions WHERE case_id = c.id AND workspace_id = c.workspace_id ORDER BY created_at DESC LIMIT 1
       )
       WHERE c.workspace_id = ?
       ORDER BY c.currency ASC, c.display_supplier ASC, c.id ASC`,
    )
    .all(workspaceId);
  const header = [
    "case_id",
    "match_type",
    "status",
    "confidence",
    "currency",
    "potential_exposure",
    "recorded_recovery",
    "supplier_display",
    "invoice_display",
    "reason_codes",
    "latest_decision",
    "latest_comment",
    "latest_decision_at",
    "notice",
  ];
  const body = rows.map((row) => {
    const currency = requiredText(row, "currency");
    const digits = currencyDigits(currency) ?? 2;
    return [
      requiredText(row, "id"),
      requiredText(row, "match_type"),
      requiredText(row, "status"),
      requiredText(row, "confidence"),
      currency,
      formatPlainMinor(BigInt(requiredText(row, "exposure_minor")), digits),
      formatPlainMinor(BigInt(requiredText(row, "recovered_minor")), digits),
      requiredText(row, "display_supplier"),
      requiredText(row, "display_invoice"),
      jsonStringArray(requiredText(row, "reasons_json")).join("|"),
      row.decision == null ? "" : requiredText(row, "decision"),
      row.comment == null ? "" : requiredText(row, "comment"),
      row.decision_at == null ? "" : requiredText(row, "decision_at"),
      "Heuristic review signal only. Not a fraud finding and not a financial transaction.",
    ];
  });
  return encodeCsv([header, ...body]);
}

export function importErrorsCsv(db: AppDb, workspaceId: string, importId: string): string | null {
  const found = db.prepare("SELECT id FROM imports WHERE id = ? AND workspace_id = ?").get(importId, workspaceId);
  if (!found) return null;
  const rows = db
    .prepare(
      `SELECT row_number, supplier_id_raw, supplier_name_raw, invoice_number_raw, invoice_date_raw, amount_raw, currency_raw,
              payment_status_raw, document_kind_raw, error_codes, exclusion_codes
       FROM source_rows WHERE import_id = ? AND workspace_id = ? ORDER BY row_number ASC`,
    )
    .all(importId, workspaceId);
  const header = [
    "row_number",
    "supplier_id",
    "supplier_name",
    "invoice_number",
    "invoice_date",
    "amount",
    "currency",
    "payment_status",
    "document_kind",
    "error_codes",
    "exclusion_codes",
  ];
  const body = rows.map((row) => [
    String(asNumber(row.row_number)),
    requiredText(row, "supplier_id_raw"),
    requiredText(row, "supplier_name_raw"),
    requiredText(row, "invoice_number_raw"),
    requiredText(row, "invoice_date_raw"),
    requiredText(row, "amount_raw"),
    requiredText(row, "currency_raw"),
    requiredText(row, "payment_status_raw"),
    requiredText(row, "document_kind_raw"),
    jsonStringArray(requiredText(row, "error_codes")).join("|"),
    jsonStringArray(requiredText(row, "exclusion_codes")).join("|"),
  ]);
  return encodeCsv([header, ...body]);
}

export function auditCsv(db: AppDb, workspaceId: string): string {
  const rows = db
    .prepare(
      `SELECT created_at, action, entity_type, entity_id, actor_user_id, metadata_json
       FROM audit_events WHERE workspace_id = ? ORDER BY created_at ASC, id ASC`,
    )
    .all(workspaceId);
  const header = ["created_at", "action", "entity_type", "entity_id", "actor_user_id", "metadata_json"];
  const body = rows.map((row) => [
    requiredText(row, "created_at"),
    requiredText(row, "action"),
    requiredText(row, "entity_type"),
    requiredText(row, "entity_id"),
    row.actor_user_id == null ? "" : requiredText(row, "actor_user_id"),
    requiredText(row, "metadata_json"),
  ]);
  return encodeCsv([header, ...body]);
}

function mapCaseSummary(row: Record<string, unknown>) {
  const fingerprint = requiredText(row, "member_fingerprint");
  return {
    id: requiredText(row, "id"),
    matchType: requiredText(row, "match_type"),
    currency: requiredText(row, "currency"),
    exposureMinor: requiredText(row, "exposure_minor"),
    recoveredMinor: requiredText(row, "recovered_minor"),
    confidence: requiredText(row, "confidence"),
    status: requiredText(row, "status"),
    displaySupplier: requiredText(row, "display_supplier"),
    displayInvoice: requiredText(row, "display_invoice"),
    reasons: jsonStringArray(requiredText(row, "reasons_json")),
    memberCount: fingerprint ? fingerprint.split(",").filter(Boolean).length : 0,
    updatedAt: requiredText(row, "updated_at"),
  };
}

function mapMember(row: Record<string, unknown>) {
  return {
    role: requiredText(row, "member_role"),
    sourceRowId: requiredText(row, "id"),
    importId: requiredText(row, "import_id"),
    rowNumber: asNumber(row.row_number),
    supplierId: requiredText(row, "supplier_id_raw"),
    supplierName: requiredText(row, "supplier_name_raw"),
    invoiceNumber: requiredText(row, "invoice_number_raw"),
    invoiceDate: row.invoice_date == null ? null : requiredText(row, "invoice_date"),
    invoiceDateRaw: requiredText(row, "invoice_date_raw"),
    amountRaw: requiredText(row, "amount_raw"),
    amountMinor: row.amount_minor == null ? null : requiredText(row, "amount_minor"),
    currency: row.currency == null ? null : requiredText(row, "currency"),
    paymentStatus: requiredText(row, "payment_status_raw"),
    paymentStatusNormalized: requiredText(row, "payment_status"),
    documentKind: requiredText(row, "document_kind_raw"),
    raw: jsonObject(requiredText(row, "raw_json")),
  };
}

function serializeTotal(total: { currency: string; minor: bigint }) {
  return { currency: total.currency, minor: total.minor.toString() };
}

function jsonStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) return [];
    return parsed;
  } catch {
    return [];
  }
}

function jsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    return {};
  } catch {
    return {};
  }
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  if (value == null) return 0;
  throw new Error("bad_number");
}
