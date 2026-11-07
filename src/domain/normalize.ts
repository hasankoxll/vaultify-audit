export function supplierKey(supplierId: string, supplierName: string): string | null {
  const id = supplierId.normalize("NFKC").trim();
  if (id) {
    const compact = id.replace(/\s+/g, "").toUpperCase();
    return compact ? `id:${compact}` : null;
  }
  const name = supplierName.normalize("NFKC").trim().toLowerCase();
  if (!name) return null;
  const cleaned = name
    .replace(/[.,'"’`/\\_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? `name:${cleaned}` : null;
}

export function invoiceKey(invoiceNumber: string): string | null {
  const raw = invoiceNumber.normalize("NFKC").trim();
  if (!raw) return null;
  const key = raw.toUpperCase().replace(/[\s.\-/_]+/g, "");
  return key || null;
}

export function normalizePaymentStatus(raw: string): string {
  const value = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!value) return "";
  const mapped: Record<string, string> = {
    paid: "paid",
    settled: "paid",
    unpaid: "unpaid",
    open: "unpaid",
    due: "unpaid",
    partial: "partial",
    partially_paid: "partial",
    credit: "credit",
    credit_note: "credit",
    credited: "credit",
    cancelled: "cancelled",
    canceled: "cancelled",
    void: "cancelled",
  };
  return mapped[value] ?? "other";
}

const DOCUMENT_KINDS = new Set(["invoice", "credit", "installment", "recurring"]);

export function normalizeDocumentKind(raw: string): { kind: string | null; error: boolean } {
  const value = raw.trim().toLowerCase();
  if (!value) return { kind: "invoice", error: false };
  if (DOCUMENT_KINDS.has(value)) return { kind: value, error: false };
  return { kind: null, error: true };
}
