import { parseDate, type DateFormat } from "./dates.js";
import { mappingErrors, type FieldMapping } from "./fields.js";
import { parseAmountForCurrency, type AmountLocale } from "./money.js";
import { invoiceKey, normalizeDocumentKind, normalizePaymentStatus, supplierKey } from "./normalize.js";
import { recordsToObjects, type CsvTable } from "./csv.js";

export interface ParsedIssue {
  rowNumber: number;
  code: string;
  field?: string;
}

export interface ParsedRow {
  rowNumber: number;
  raw: Record<string, string>;
  supplierIdRaw: string;
  supplierNameRaw: string;
  invoiceNumberRaw: string;
  invoiceDateRaw: string;
  amountRaw: string;
  currencyRaw: string;
  paymentStatusRaw: string;
  documentKindRaw: string;
  errorCodes: string[];
  exclusionCodes: string[];
  supplierKey: string | null;
  invoiceKey: string | null;
  invoiceDate: string | null;
  amountMinor: bigint | null;
  currency: string | null;
  paymentStatus: string;
  documentKind: string;
  matchable: boolean;
}

export interface ImportParseOptions {
  mapping: FieldMapping;
  amountLocale: AmountLocale;
  dateFormat: DateFormat;
}

export interface ImportParseSuccess {
  ok: true;
  rows: ParsedRow[];
  invalidCount: number;
  excludedCount: number;
  matchableCount: number;
}

export interface ImportParseFailure {
  ok: false;
  errors: string[];
}

const FIELD_LIMITS: Record<string, number> = {
  supplier_id: 300,
  supplier_name: 300,
  invoice_number: 120,
  invoice_date: 32,
  amount: 100,
  currency: 12,
  payment_status: 80,
  document_kind: 40,
};

export function parseImportTable(table: CsvTable, options: ImportParseOptions): ImportParseSuccess | ImportParseFailure {
  const errors = mappingErrors(table.headers, options.mapping);
  if (errors.length > 0) return { ok: false, errors };
  const rows = table.records.map((record) => parseRecord(table.headers, record.rowNumber, record.cells, options));
  return {
    ok: true,
    rows,
    invalidCount: rows.filter((row) => row.errorCodes.length > 0).length,
    excludedCount: rows.filter((row) => row.errorCodes.length === 0 && row.exclusionCodes.length > 0).length,
    matchableCount: rows.filter((row) => row.matchable).length,
  };
}

function parseRecord(headers: string[], rowNumber: number, cells: string[], options: ImportParseOptions): ParsedRow {
  const padded = headers.map((_, index) => cells[index] ?? "");
  const columnMismatch = cells.length > headers.length;
  const raw = recordsToObjects(headers, padded);
  const value = (field: keyof FieldMapping): string => {
    const header = options.mapping[field];
    if (!header) return "";
    return raw[header] ?? "";
  };

  const supplierIdRaw = value("supplier_id").trim();
  const supplierNameRaw = value("supplier_name").trim();
  const invoiceNumberRaw = value("invoice_number").trim();
  const invoiceDateRaw = value("invoice_date").trim();
  const amountRaw = value("amount").trim();
  const currencyRaw = value("currency").trim().toUpperCase();
  const paymentStatusRaw = value("payment_status").trim();
  const documentKindRaw = value("document_kind").trim();

  const errorCodes: string[] = [];
  if (columnMismatch) errorCodes.push("column_count_mismatch");
  for (const [field, limit] of Object.entries(FIELD_LIMITS)) {
    const current = {
      supplier_id: supplierIdRaw,
      supplier_name: supplierNameRaw,
      invoice_number: invoiceNumberRaw,
      invoice_date: invoiceDateRaw,
      amount: amountRaw,
      currency: currencyRaw,
      payment_status: paymentStatusRaw,
      document_kind: documentKindRaw,
    }[field];
    if ((current ?? "").length > limit) errorCodes.push(`field_too_long:${field}`);
  }

  const kindResult = normalizeDocumentKind(documentKindRaw);
  if (kindResult.error) errorCodes.push("unknown_document_kind");

  let amountMinor: bigint | null = null;
  let currency: string | null = null;
  if (!currencyRaw) errorCodes.push("missing_currency");
  else if (!/^[A-Z]{3}$/.test(currencyRaw)) errorCodes.push("unsupported_currency");
  else {
    currency = currencyRaw;
    const parsedAmount = parseAmountForCurrency(amountRaw, options.amountLocale, currencyRaw);
    if (!parsedAmount.ok) errorCodes.push(parsedAmount.code);
    else if (parsedAmount.minor === 0n) errorCodes.push("amount_zero");
    else amountMinor = parsedAmount.minor;
  }

  let invoiceDate: string | null = null;
  const parsedDate = parseDate(invoiceDateRaw, options.dateFormat);
  if (!parsedDate.ok) errorCodes.push(parsedDate.code);
  else invoiceDate = parsedDate.iso;

  const supplier = errorCodes.some((code) => code.startsWith("field_too_long:supplier"))
    ? null
    : supplierKey(supplierIdRaw, supplierNameRaw);
  const invoice = errorCodes.some((code) => code.startsWith("field_too_long:invoice_number"))
    ? null
    : invoiceKey(invoiceNumberRaw);
  const paymentStatus = normalizePaymentStatus(paymentStatusRaw);
  const documentKind = kindResult.kind ?? "";

  const exclusionCodes: string[] = [];
  if (errorCodes.length === 0) {
    if (documentKind === "recurring") exclusionCodes.push("recurring");
    if (documentKind === "installment") exclusionCodes.push("installment");
    if (documentKind === "credit" || paymentStatus === "credit" || (amountMinor !== null && amountMinor < 0n)) {
      exclusionCodes.push("credit");
    }
    if (paymentStatus === "cancelled") exclusionCodes.push("cancelled");
    if (!supplier) exclusionCodes.push("missing_supplier");
    if (!invoice) exclusionCodes.push("missing_invoice");
  }

  return {
    rowNumber,
    raw,
    supplierIdRaw,
    supplierNameRaw,
    invoiceNumberRaw,
    invoiceDateRaw,
    amountRaw,
    currencyRaw,
    paymentStatusRaw,
    documentKindRaw,
    errorCodes,
    exclusionCodes,
    supplierKey: supplier,
    invoiceKey: invoice,
    invoiceDate,
    amountMinor,
    currency,
    paymentStatus,
    documentKind,
    matchable: errorCodes.length === 0 && exclusionCodes.length === 0,
  };
}
