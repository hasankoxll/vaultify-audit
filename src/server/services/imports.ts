import { createHash, randomBytes } from "node:crypto";
import { parseCsv, type CsvTable } from "../../domain/csv.js";
import { suggestMapping, type FieldMapping } from "../../domain/fields.js";
import { parseImportTable, type ParsedRow } from "../../domain/import-parse.js";
import type { AmountLocale } from "../../domain/money.js";
import type { DateFormat } from "../../domain/dates.js";
import type { AppDb } from "../db.js";
import { requiredNumber, requiredText, transaction } from "../db.js";
import { writeAudit } from "../audit.js";
import { ServiceError } from "./accounts.js";
import { recomputeWorkspace, type RecomputeResult } from "./review.js";

const LOCALES = new Set<AmountLocale>(["plain", "en-US", "eu"]);
const DATE_FORMATS = new Set<DateFormat>(["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY", "DD-MM-YYYY"]);

export interface UploadResult {
  id: string;
  filename: string;
  headers: string[];
  sample: { header: string; values: string[] }[];
  suggestedMapping: FieldMapping;
  dataRows: number;
}

export function createUpload(
  db: AppDb,
  input: {
    workspaceId: string;
    userId: string;
    filename: string;
    bytes: Uint8Array;
    declaredType: string;
    maxUploadBytes: number;
    maxImportRows: number;
    now: string;
  },
): UploadResult {
  if (!isCsvUpload(input.filename, input.declaredType)) throw new ServiceError("invalid_file_type", 415);
  if (input.bytes.byteLength > input.maxUploadBytes) throw new ServiceError("file_too_large", 413);
  const csvText = decodeCsv(input.bytes);
  const table = parseTable(csvText, input.maxImportRows);
  if (table.records.length > input.maxImportRows) throw new ServiceError("too_many_rows", 422);
  const id = `imp_${randomBytes(16).toString("hex")}`;
  const filename = sanitizeFilename(input.filename);
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  transaction(db, () => {
    db.prepare(
      `INSERT INTO imports (
        id, workspace_id, created_by, filename, byte_length, sha256, status, row_count, valid_count, invalid_count, excluded_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'uploaded', ?, 0, 0, 0, ?)`,
    ).run(id, input.workspaceId, input.userId, filename, input.bytes.byteLength, sha256, table.records.length, input.now);
    db.prepare("INSERT INTO import_files (import_id, csv_text) VALUES (?, ?)").run(id, csvText);
    writeAudit(db, {
      workspaceId: input.workspaceId,
      actorUserId: input.userId,
      action: "import_uploaded",
      entityType: "import",
      entityId: id,
      metadata: { byteLength: input.bytes.byteLength, dataRows: table.records.length, sha256 },
      now: input.now,
    });
  });
  return {
    id,
    filename,
    headers: table.headers,
    sample: sampleColumns(table),
    suggestedMapping: suggestMapping(table.headers),
    dataRows: table.records.length,
  };
}

export function buildPreview(
  db: AppDb,
  input: {
    workspaceId: string;
    importId: string;
    mapping: FieldMapping;
    amountLocale: string;
    dateFormat: string;
    maxImportRows: number;
  },
) {
  const loaded = loadTable(db, input.workspaceId, input.importId, input.maxImportRows);
  const options = parseOptions(input.mapping, input.amountLocale, input.dateFormat);
  const parsed = parseImportTable(loaded.table, options);
  if (!parsed.ok) throw new ServiceError("invalid_mapping", 422, parsed.errors);
  return {
    importId: input.importId,
    status: loaded.status,
    filename: loaded.filename,
    headers: loaded.table.headers,
    sample: sampleColumns(loaded.table),
    suggestedMapping: suggestMapping(loaded.table.headers),
    summary: {
      dataRows: parsed.rows.length,
      invalidCount: parsed.invalidCount,
      excludedCount: parsed.excludedCount,
      matchableCount: parsed.matchableCount,
    },
    previewRows: parsed.rows.slice(0, 20).map(publicRow),
    issues: parsed.rows
      .filter((row) => row.errorCodes.length > 0 || row.exclusionCodes.length > 0)
      .slice(0, 100)
      .map(publicIssue),
  };
}

export function commitImport(
  db: AppDb,
  input: {
    workspaceId: string;
    userId: string;
    importId: string;
    mapping: FieldMapping;
    amountLocale: string;
    dateFormat: string;
    maxImportRows: number;
    now: string;
  },
): { summary: { dataRows: number; invalidCount: number; excludedCount: number; matchableCount: number }; recompute: RecomputeResult } {
  const loaded = loadTable(db, input.workspaceId, input.importId, input.maxImportRows);
  if (loaded.status !== "uploaded") throw new ServiceError("already_committed", 409);
  const options = parseOptions(input.mapping, input.amountLocale, input.dateFormat);
  const parsed = parseImportTable(loaded.table, options);
  if (!parsed.ok) throw new ServiceError("invalid_mapping", 422, parsed.errors);
  if (parsed.rows.length > input.maxImportRows) throw new ServiceError("too_many_rows", 422);
  let recompute: RecomputeResult = { created: 0, updated: 0, removed: 0, dissolved: 0 };
  transaction(db, () => {
    insertRows(db, input.workspaceId, input.importId, parsed.rows);
    const status = parsed.invalidCount > 0 ? "committed_with_errors" : "committed";
    const structurallyValid = parsed.rows.length - parsed.invalidCount;
    db.prepare(
      `UPDATE imports SET status = ?, mapping_json = ?, amount_locale = ?, date_format = ?, row_count = ?, valid_count = ?,
       invalid_count = ?, excluded_count = ?, committed_at = ? WHERE id = ? AND workspace_id = ?`,
    ).run(
      status,
      JSON.stringify(options.mapping),
      options.amountLocale,
      options.dateFormat,
      parsed.rows.length,
      structurallyValid,
      parsed.invalidCount,
      parsed.excludedCount,
      input.now,
      input.importId,
      input.workspaceId,
    );
    recompute = recomputeWorkspace(db, input.workspaceId, input.now);
    writeAudit(db, {
      workspaceId: input.workspaceId,
      actorUserId: input.userId,
      action: "import_committed",
      entityType: "import",
      entityId: input.importId,
      metadata: {
        dataRows: parsed.rows.length,
        invalidCount: parsed.invalidCount,
        excludedCount: parsed.excludedCount,
        matchableCount: parsed.matchableCount,
        casesCreated: recompute.created,
        casesUpdated: recompute.updated,
      },
      now: input.now,
    });
  });
  return {
    summary: {
      dataRows: parsed.rows.length,
      invalidCount: parsed.invalidCount,
      excludedCount: parsed.excludedCount,
      matchableCount: parsed.matchableCount,
    },
    recompute,
  };
}

export function commitCsvText(
  db: AppDb,
  input: {
    workspaceId: string;
    userId: string;
    filename: string;
    csvText: string;
    maxImportRows: number;
    now: string;
    amountLocale?: AmountLocale;
    dateFormat?: DateFormat;
    inTransaction?: boolean;
  },
): string {
  const table = parseTable(input.csvText, input.maxImportRows);
  const mapping = suggestMapping(table.headers);
  const id = `imp_${randomBytes(16).toString("hex")}`;
  const sha256 = createHash("sha256").update(input.csvText).digest("hex");
  const write = () => {
    db.prepare(
      `INSERT INTO imports (
        id, workspace_id, created_by, filename, byte_length, sha256, status, row_count, valid_count, invalid_count, excluded_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'uploaded', 0, 0, 0, 0, ?)`,
    ).run(id, input.workspaceId, input.userId, input.filename, Buffer.byteLength(input.csvText), sha256, input.now);
    db.prepare("INSERT INTO import_files (import_id, csv_text) VALUES (?, ?)").run(id, input.csvText);
    commitImportUnlocked(db, {
      workspaceId: input.workspaceId,
      userId: input.userId,
      importId: id,
      table,
      mapping,
      amountLocale: input.amountLocale ?? "plain",
      dateFormat: input.dateFormat ?? "YYYY-MM-DD",
      now: input.now,
    });
  };
  if (input.inTransaction) write();
  else transaction(db, write);
  return id;
}

export function deleteImport(db: AppDb, input: { workspaceId: string; userId: string; importId: string; isDemo: boolean; now: string }) {
  if (input.isDemo) throw new ServiceError("demo_forbidden", 403);
  const found = db.prepare("SELECT id FROM imports WHERE id = ? AND workspace_id = ?").get(input.importId, input.workspaceId);
  if (!found) throw new ServiceError("not_found", 404);
  transaction(db, () => {
    db.prepare(
      `DELETE FROM case_rows WHERE workspace_id = ? AND source_row_id IN (SELECT id FROM source_rows WHERE import_id = ? AND workspace_id = ?)`,
    ).run(input.workspaceId, input.importId, input.workspaceId);
    db.prepare("DELETE FROM source_rows WHERE import_id = ? AND workspace_id = ?").run(input.importId, input.workspaceId);
    db.prepare("DELETE FROM import_files WHERE import_id = ?").run(input.importId);
    db.prepare("DELETE FROM imports WHERE id = ? AND workspace_id = ?").run(input.importId, input.workspaceId);
    const recompute = recomputeWorkspace(db, input.workspaceId, input.now);
    writeAudit(db, {
      workspaceId: input.workspaceId,
      actorUserId: input.userId,
      action: "import_deleted",
      entityType: "import",
      entityId: input.importId,
      metadata: { removedCases: recompute.removed, dissolvedCases: recompute.dissolved, updatedCases: recompute.updated },
      now: input.now,
    });
  });
}

export function deleteInvoiceData(db: AppDb, input: { workspaceId: string; userId: string; isDemo: boolean; confirm: string; now: string }) {
  if (input.isDemo) throw new ServiceError("demo_forbidden", 403);
  if (input.confirm !== "DELETE INVOICE DATA") throw new ServiceError("confirmation_required", 400);
  transaction(db, () => {
    const imports = db.prepare("SELECT COUNT(*) AS n FROM imports WHERE workspace_id = ?").get(input.workspaceId);
    const rows = db.prepare("SELECT COUNT(*) AS n FROM source_rows WHERE workspace_id = ?").get(input.workspaceId);
    db.prepare("DELETE FROM decisions WHERE workspace_id = ?").run(input.workspaceId);
    db.prepare("DELETE FROM case_rows WHERE workspace_id = ?").run(input.workspaceId);
    db.prepare("DELETE FROM cases WHERE workspace_id = ?").run(input.workspaceId);
    db.prepare("DELETE FROM source_rows WHERE workspace_id = ?").run(input.workspaceId);
    db.prepare("DELETE FROM import_files WHERE import_id IN (SELECT id FROM imports WHERE workspace_id = ?)").run(input.workspaceId);
    db.prepare("DELETE FROM imports WHERE workspace_id = ?").run(input.workspaceId);
    writeAudit(db, {
      workspaceId: input.workspaceId,
      actorUserId: input.userId,
      action: "invoice_data_deleted",
      entityType: "workspace",
      entityId: input.workspaceId,
      metadata: {
        imports: imports ? requiredNumber(imports, "n") : 0,
        rows: rows ? requiredNumber(rows, "n") : 0,
      },
      now: input.now,
    });
  });
}

function commitImportUnlocked(
  db: AppDb,
  input: {
    workspaceId: string;
    userId: string;
    importId: string;
    table: CsvTable;
    mapping: FieldMapping;
    amountLocale: AmountLocale;
    dateFormat: DateFormat;
    now: string;
  },
) {
  const parsed = parseImportTable(input.table, {
    mapping: input.mapping,
    amountLocale: input.amountLocale,
    dateFormat: input.dateFormat,
  });
  if (!parsed.ok) throw new ServiceError("invalid_mapping", 422, parsed.errors);
  insertRows(db, input.workspaceId, input.importId, parsed.rows);
  const status = parsed.invalidCount > 0 ? "committed_with_errors" : "committed";
  db.prepare(
    `UPDATE imports SET status = ?, mapping_json = ?, amount_locale = ?, date_format = ?, row_count = ?, valid_count = ?,
     invalid_count = ?, excluded_count = ?, committed_at = ? WHERE id = ? AND workspace_id = ?`,
  ).run(
    status,
    JSON.stringify(input.mapping),
    input.amountLocale,
    input.dateFormat,
    parsed.rows.length,
    parsed.rows.length - parsed.invalidCount,
    parsed.invalidCount,
    parsed.excludedCount,
    input.now,
    input.importId,
    input.workspaceId,
  );
  const recompute = recomputeWorkspace(db, input.workspaceId, input.now);
  writeAudit(db, {
    workspaceId: input.workspaceId,
    actorUserId: input.userId,
    action: "import_committed",
    entityType: "import",
    entityId: input.importId,
    metadata: {
      dataRows: parsed.rows.length,
      invalidCount: parsed.invalidCount,
      excludedCount: parsed.excludedCount,
      matchableCount: parsed.matchableCount,
      casesCreated: recompute.created,
    },
    now: input.now,
  });
}

function insertRows(db: AppDb, workspaceId: string, importId: string, rows: ParsedRow[]) {
  const insert = db.prepare(
    `INSERT INTO source_rows (
      id, workspace_id, import_id, row_number, raw_json, supplier_id_raw, supplier_name_raw, invoice_number_raw,
      invoice_date_raw, amount_raw, currency_raw, payment_status_raw, document_kind_raw, supplier_key, invoice_key,
      invoice_date, amount_minor, currency, payment_status, document_kind, error_codes, exclusion_codes, matchable
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const row of rows) {
    insert.run(
      `row_${randomBytes(12).toString("hex")}`,
      workspaceId,
      importId,
      row.rowNumber,
      JSON.stringify(row.raw),
      row.supplierIdRaw,
      row.supplierNameRaw,
      row.invoiceNumberRaw,
      row.invoiceDateRaw,
      row.amountRaw,
      row.currencyRaw,
      row.paymentStatusRaw,
      row.documentKindRaw,
      row.supplierKey,
      row.invoiceKey,
      row.invoiceDate,
      row.amountMinor === null ? null : row.amountMinor.toString(),
      row.currency,
      row.paymentStatus,
      row.documentKind,
      JSON.stringify(row.errorCodes),
      JSON.stringify(row.exclusionCodes),
      row.matchable ? 1 : 0,
    );
  }
}

function loadTable(db: AppDb, workspaceId: string, importId: string, maxImportRows: number) {
  const row = db
    .prepare(
      `SELECT i.status AS status, i.filename AS filename, f.csv_text AS csv_text
       FROM imports i JOIN import_files f ON f.import_id = i.id
       WHERE i.id = ? AND i.workspace_id = ?`,
    )
    .get(importId, workspaceId);
  if (!row) throw new ServiceError("not_found", 404);
  const table = parseTable(requiredText(row, "csv_text"), maxImportRows);
  return { status: requiredText(row, "status"), filename: requiredText(row, "filename"), table };
}

function parseTable(csvText: string, maxImportRows: number): CsvTable {
  try {
    return parseCsv(csvText, { maxRows: maxImportRows, maxColumns: 50, maxCellLength: 5_000 });
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String((error as { code: string }).code) : "invalid_csv";
    throw new ServiceError(code || "invalid_csv", 422);
  }
}

function parseOptions(mapping: FieldMapping, amountLocale: string, dateFormat: string) {
  if (!LOCALES.has(amountLocale as AmountLocale) || !DATE_FORMATS.has(dateFormat as DateFormat)) {
    throw new ServiceError("invalid_mapping", 422, ["invalid_parse_options"]);
  }
  return { mapping, amountLocale: amountLocale as AmountLocale, dateFormat: dateFormat as DateFormat };
}

function publicRow(row: ParsedRow) {
  return {
    rowNumber: row.rowNumber,
    supplierId: row.supplierIdRaw,
    supplierName: row.supplierNameRaw,
    invoiceNumber: row.invoiceNumberRaw,
    invoiceDate: row.invoiceDate,
    invoiceDateRaw: row.invoiceDateRaw,
    amountMinor: row.amountMinor?.toString() ?? null,
    amountRaw: row.amountRaw,
    currency: row.currency,
    paymentStatus: row.paymentStatusRaw,
    documentKind: row.documentKindRaw,
    errorCodes: row.errorCodes,
    exclusionCodes: row.exclusionCodes,
    matchable: row.matchable,
  };
}

function publicIssue(row: ParsedRow) {
  return {
    rowNumber: row.rowNumber,
    errorCodes: row.errorCodes,
    exclusionCodes: row.exclusionCodes,
    invoiceNumber: row.invoiceNumberRaw,
    supplierName: row.supplierNameRaw || row.supplierIdRaw,
  };
}

function sampleColumns(table: CsvTable) {
  return table.headers.map((header, index) => ({
    header,
    values: table.records.slice(0, 5).map((record) => record.cells[index] ?? ""),
  }));
}

function decodeCsv(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ServiceError("invalid_encoding", 422);
  }
}

function isCsvUpload(filename: string, declaredType: string): boolean {
  if (!filename.toLowerCase().endsWith(".csv")) return false;
  const type = declaredType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!type) return true;
  return ["text/csv", "application/vnd.ms-excel", "text/plain", "application/octet-stream"].includes(type);
}

function sanitizeFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? "upload.csv";
  const cleaned = [...base].filter((char) => char.charCodeAt(0) >= 32).join("").slice(0, 120);
  return cleaned.toLowerCase().endsWith(".csv") ? cleaned : "upload.csv";
}
