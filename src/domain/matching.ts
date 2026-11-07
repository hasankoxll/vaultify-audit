import { daysBetweenIso } from "./dates.js";

export type MatchType = "exact" | "proximity";

export type ConfidenceCode =
  | "heuristic_exact_amount"
  | "heuristic_exact_key_amount_differs"
  | "heuristic_proximity";

export type ReasonCode =
  | "same_supplier_key"
  | "same_normalized_invoice_number"
  | "same_currency"
  | "currencies_not_crossed"
  | "amounts_equal"
  | "amounts_differ"
  | "dates_equal"
  | "dates_differ"
  | "dates_within_window"
  | "different_invoice_numbers"
  | "amount_within_tolerance"
  | "primary_row_excluded_from_exposure";

export interface MatchableRow {
  id: string;
  supplierKey: string;
  invoiceKey: string;
  currency: string;
  amountMinor: bigint;
  invoiceDate: string;
  supplierDisplay: string;
  invoiceDisplay: string;
}

export interface MatchSettings {
  dateWindowDays: number;
  amountToleranceMinor: bigint;
}

export interface CaseMember {
  id: string;
  role: "primary" | "extra";
}

export interface CaseDraft {
  matchType: MatchType;
  groupKey: string;
  supplierKey: string;
  invoiceKey: string | null;
  currency: string;
  exposureMinor: bigint;
  confidence: ConfidenceCode;
  reasons: ReasonCode[];
  members: CaseMember[];
  fingerprint: string;
  displaySupplier: string;
  displayInvoice: string;
}

/**
 * Potential exposure is the sum of member amounts minus the primary amount.
 * The primary invoice is the largest amount, then the earliest date, then the lowest id.
 * It is not counted again as duplicate exposure.
 */
export function buildCaseDrafts(rows: MatchableRow[], settings: MatchSettings): CaseDraft[] {
  const exactGroups = new Map<string, MatchableRow[]>();
  for (const row of rows) {
    const key = `${row.supplierKey}\u001f${row.invoiceKey}\u001f${row.currency}`;
    const list = exactGroups.get(key);
    if (list) list.push(row);
    else exactGroups.set(key, [row]);
  }

  const exactDrafts: CaseDraft[] = [];
  const consumed = new Set<string>();
  const exactKeys = [...exactGroups.keys()].sort();
  for (const key of exactKeys) {
    const group = exactGroups.get(key) ?? [];
    if (group.length < 2) continue;
    for (const row of group) consumed.add(row.id);
    exactDrafts.push(toDraft("exact", group, settings));
  }

  const proximityPool = rows.filter((row) => !consumed.has(row.id));
  const buckets = new Map<string, MatchableRow[]>();
  for (const row of proximityPool) {
    const key = `${row.supplierKey}\u001f${row.currency}`;
    const list = buckets.get(key);
    if (list) list.push(row);
    else buckets.set(key, [row]);
  }

  const proximityDrafts: CaseDraft[] = [];
  for (const key of [...buckets.keys()].sort()) {
    const bucket = (buckets.get(key) ?? []).slice().sort(compareRows);
    const parent = bucket.map((_, index) => index);
    const find = (index: number): number => {
      let cursor = index;
      while (parent[cursor] !== cursor) {
        parent[cursor] = parent[parent[cursor] ?? cursor] ?? cursor;
        cursor = parent[cursor] ?? cursor;
      }
      return cursor;
    };
    const union = (left: number, right: number) => {
      const a = find(left);
      const b = find(right);
      if (a === b) return;
      if (a < b) parent[b] = a;
      else parent[a] = b;
    };
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const left = bucket[i];
        const right = bucket[j];
        if (!left || !right) continue;
        const dayGap = daysBetweenIso(left.invoiceDate, right.invoiceDate);
        if (dayGap > settings.dateWindowDays) break;
        const amountGap = left.amountMinor > right.amountMinor ? left.amountMinor - right.amountMinor : right.amountMinor - left.amountMinor;
        if (amountGap > settings.amountToleranceMinor) continue;
        if (left.invoiceKey === right.invoiceKey) continue;
        union(i, j);
      }
    }
    const clusters = new Map<number, MatchableRow[]>();
    for (let index = 0; index < bucket.length; index += 1) {
      const root = find(index);
      const row = bucket[index];
      if (!row) continue;
      const list = clusters.get(root);
      if (list) list.push(row);
      else clusters.set(root, [row]);
    }
    for (const cluster of clusters.values()) {
      if (cluster.length < 2) continue;
      proximityDrafts.push(toDraft("proximity", cluster, settings));
    }
  }

  return [...exactDrafts, ...proximityDrafts].sort((a, b) => (a.groupKey < b.groupKey ? -1 : a.groupKey > b.groupKey ? 1 : 0));
}

function toDraft(matchType: MatchType, rows: MatchableRow[], _settings: MatchSettings): CaseDraft {
  const ordered = rows.slice().sort(primarySort);
  const primary = ordered[0];
  if (!primary) throw new Error("empty_group");
  const extras = ordered.slice(1);
  const exposureMinor = extras.reduce((sum, row) => sum + row.amountMinor, 0n);
  const amountsEqual = ordered.every((row) => row.amountMinor === primary.amountMinor);
  const datesEqual = ordered.every((row) => row.invoiceDate === primary.invoiceDate);
  const invoiceKeys = [...new Set(ordered.map((row) => row.invoiceKey))].sort();
  const reasons: ReasonCode[] = ["same_supplier_key", "same_currency", "currencies_not_crossed", "primary_row_excluded_from_exposure"];
  if (matchType === "exact") {
    reasons.push("same_normalized_invoice_number", amountsEqual ? "amounts_equal" : "amounts_differ", datesEqual ? "dates_equal" : "dates_differ");
  } else {
    reasons.push("different_invoice_numbers", "dates_within_window", "amount_within_tolerance", amountsEqual ? "amounts_equal" : "amounts_differ");
  }
  const groupKey =
    matchType === "exact"
      ? `exact\u001f${primary.supplierKey}\u001f${primary.invoiceKey}\u001f${primary.currency}`
      : `prox\u001f${primary.supplierKey}\u001f${primary.currency}\u001f${invoiceKeys.join(",")}`;
  const members = [
    { id: primary.id, role: "primary" as const },
    ...extras.map((row) => ({ id: row.id, role: "extra" as const })),
  ];
  return {
    matchType,
    groupKey,
    supplierKey: primary.supplierKey,
    invoiceKey: matchType === "exact" ? primary.invoiceKey : null,
    currency: primary.currency,
    exposureMinor,
    confidence:
      matchType === "proximity"
        ? "heuristic_proximity"
        : amountsEqual
          ? "heuristic_exact_amount"
          : "heuristic_exact_key_amount_differs",
    reasons,
    members,
    fingerprint: ordered
      .map((row) => row.id)
      .sort()
      .join(","),
    displaySupplier: primary.supplierDisplay,
    displayInvoice: matchType === "exact" ? primary.invoiceDisplay : invoiceKeys.join(", "),
  };
}

function primarySort(a: MatchableRow, b: MatchableRow): number {
  if (a.amountMinor !== b.amountMinor) return a.amountMinor > b.amountMinor ? -1 : 1;
  if (a.invoiceDate !== b.invoiceDate) return a.invoiceDate < b.invoiceDate ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function compareRows(a: MatchableRow, b: MatchableRow): number {
  if (a.invoiceDate !== b.invoiceDate) return a.invoiceDate < b.invoiceDate ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}
