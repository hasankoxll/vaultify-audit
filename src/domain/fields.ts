export const IMPORT_FIELDS = [
  "supplier_id",
  "supplier_name",
  "invoice_number",
  "invoice_date",
  "amount",
  "currency",
  "payment_status",
  "document_kind",
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

export type FieldMapping = Partial<Record<ImportField, string | null>>;

const ALIASES: Record<ImportField, string[]> = {
  supplier_id: ["supplierid", "vendorid", "suppliercode"],
  supplier_name: ["suppliername", "vendorname", "vendor", "supplier"],
  invoice_number: ["invoicenumber", "invoiceno", "invno", "invoicenum"],
  invoice_date: ["invoicedate", "date"],
  amount: ["amount", "invoiceamount", "amountdue", "total"],
  currency: ["currency", "currencycode", "ccy"],
  payment_status: ["paymentstatus", "status"],
  document_kind: ["documentkind", "doctype", "type"],
};

export function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, "");
}

export function suggestMapping(headers: string[]): FieldMapping {
  const remaining = new Set(headers);
  const mapping: FieldMapping = {};
  for (const field of IMPORT_FIELDS) {
    const canonical = normalizeHeader(field);
    const exact = headers.find((header) => remaining.has(header) && normalizeHeader(header) === canonical);
    if (exact) {
      mapping[field] = exact;
      remaining.delete(exact);
    }
  }
  for (const field of IMPORT_FIELDS) {
    if (mapping[field]) continue;
    const aliases = new Set(ALIASES[field]);
    const match = headers.find((header) => remaining.has(header) && aliases.has(normalizeHeader(header)));
    if (match) {
      mapping[field] = match;
      remaining.delete(match);
    }
  }
  return mapping;
}

export function mappingErrors(headers: string[], mapping: FieldMapping): string[] {
  const known = new Set(headers);
  const errors: string[] = [];
  const used = new Map<string, ImportField>();
  for (const field of IMPORT_FIELDS) {
    const header = mapping[field];
    if (header == null || header === "") continue;
    if (!known.has(header)) errors.push(`unknown_column:${field}`);
    const previous = used.get(header);
    if (previous) errors.push(`duplicate_mapping:${field}`);
    used.set(header, field);
  }
  if (!mapping.amount) errors.push("missing_mapping:amount");
  if (!mapping.currency) errors.push("missing_mapping:currency");
  if (!mapping.invoice_date) errors.push("missing_mapping:invoice_date");
  if (!mapping.invoice_number) errors.push("missing_mapping:invoice_number");
  if (!mapping.supplier_id && !mapping.supplier_name) errors.push("missing_mapping:supplier");
  return errors;
}
