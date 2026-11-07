import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { aggregateCases } from "../src/domain/aggregate.js";
import { suggestMapping } from "../src/domain/fields.js";
import { parseCsv } from "../src/domain/csv.js";
import { parseImportTable } from "../src/domain/import-parse.js";
import { buildCaseDrafts, type MatchableRow } from "../src/domain/matching.js";

const settings = { dateWindowDays: 3, amountToleranceMinor: 0n };

function row(partial: Partial<MatchableRow> & Pick<MatchableRow, "id" | "invoiceKey" | "amountMinor">): MatchableRow {
  return {
    supplierKey: "id:SUP",
    currency: "SAR",
    invoiceDate: "2026-01-01",
    supplierDisplay: "Supplier",
    invoiceDisplay: partial.invoiceKey,
    ...partial,
  };
}

describe("duplicate exposure", () => {
  it("counts extras once and keeps currencies apart", () => {
    const drafts = buildCaseDrafts(
      [
        row({ id: "a", invoiceKey: "INV100", amountMinor: 100000n }),
        row({ id: "b", invoiceKey: "INV100", amountMinor: 100000n, invoiceDate: "2026-01-02" }),
        row({ id: "c", invoiceKey: "INV100", amountMinor: 100000n, invoiceDate: "2026-01-03" }),
        row({ id: "d", invoiceKey: "INV100", amountMinor: 100000n, currency: "USD" }),
        row({ id: "e", invoiceKey: "INV100", amountMinor: 100000n, currency: "USD" }),
        row({ id: "f", invoiceKey: "OTHER", amountMinor: 50000n, supplierKey: "id:OTHER" }),
        row({ id: "g", invoiceKey: "OTHER", amountMinor: 50000n, supplierKey: "id:DIFFERENT" }),
      ],
      settings,
    );
    const sar = drafts.find((draft) => draft.currency === "SAR" && draft.matchType === "exact");
    const usd = drafts.find((draft) => draft.currency === "USD");
    expect(sar?.exposureMinor).toBe(200000n);
    expect(sar?.members.filter((member) => member.role === "primary")).toHaveLength(1);
    expect(usd?.exposureMinor).toBe(100000n);
    expect(drafts.some((draft) => draft.supplierKey === "id:OTHER")).toBe(false);
    expect(buildCaseDrafts(drafts.flatMap(() => []), settings)).toEqual([]);
    expect(buildCaseDrafts([row({ id: "a", invoiceKey: "INV100", amountMinor: 100000n })], settings)[0]?.groupKey).toBe(
      buildCaseDrafts([row({ id: "a", invoiceKey: "INV100", amountMinor: 100000n })], settings)[0]?.groupKey,
    );
  });

  it("uses the larger amount as the kept invoice when amounts differ", () => {
    const [draft] = buildCaseDrafts(
      [
        row({ id: "low", invoiceKey: "INV200", amountMinor: 45000n }),
        row({ id: "high", invoiceKey: "INV200", amountMinor: 50000n }),
      ],
      settings,
    );
    expect(draft?.exposureMinor).toBe(45000n);
    expect(draft?.confidence).toBe("heuristic_exact_key_amount_differs");
    expect(draft?.members[0]).toEqual({ id: "high", role: "primary" });
  });

  it("clusters proximity rows once and does not cross currency", () => {
    const drafts = buildCaseDrafts(
      [
        row({ id: "a", invoiceKey: "A", amountMinor: 10000n, invoiceDate: "2026-03-01" }),
        row({ id: "b", invoiceKey: "B", amountMinor: 10000n, invoiceDate: "2026-03-02" }),
        row({ id: "c", invoiceKey: "C", amountMinor: 10000n, invoiceDate: "2026-03-03" }),
        row({ id: "usd", invoiceKey: "D", amountMinor: 10000n, invoiceDate: "2026-03-02", currency: "USD" }),
      ],
      settings,
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.matchType).toBe("proximity");
    expect(drafts[0]?.exposureMinor).toBe(20000n);
    expect(drafts[0]?.confidence).toBe("heuristic_proximity");
    expect(drafts[0]?.reasons).toContain("currencies_not_crossed");
  });

  it("respects the date window and amount tolerance boundaries", () => {
    const rows = [
      row({ id: "a", invoiceKey: "A", amountMinor: 10000n, invoiceDate: "2026-03-01" }),
      row({ id: "b", invoiceKey: "B", amountMinor: 10050n, invoiceDate: "2026-03-04" }),
    ];
    expect(buildCaseDrafts(rows, { dateWindowDays: 3, amountToleranceMinor: 0n })).toHaveLength(0);
    expect(buildCaseDrafts(rows, { dateWindowDays: 3, amountToleranceMinor: 50n })[0]?.exposureMinor).toBe(10000n);
    expect(buildCaseDrafts(rows, { dateWindowDays: 2, amountToleranceMinor: 50n })).toHaveLength(0);
  });

  it("locks the synthetic demo exposure figures", () => {
    const csv = readFileSync("samples/synthetic-demo.csv", "utf8");
    const table = parseCsv(csv);
    const mapping = suggestMapping(table.headers);
    const parsed = parseImportTable(table, { mapping, amountLocale: "plain", dateFormat: "YYYY-MM-DD" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows).toHaveLength(31);
    expect(parsed.invalidCount).toBe(0);
    expect(parsed.excludedCount).toBe(10);
    expect(parsed.matchableCount).toBe(21);
    const matchable = parsed.rows.filter((item) => item.matchable);
    const drafts = buildCaseDrafts(
      matchable.map((item) => ({
        id: String(item.rowNumber),
        supplierKey: item.supplierKey ?? "",
        invoiceKey: item.invoiceKey ?? "",
        currency: item.currency ?? "",
        amountMinor: item.amountMinor ?? 0n,
        invoiceDate: item.invoiceDate ?? "",
        supplierDisplay: item.supplierNameRaw || item.supplierIdRaw,
        invoiceDisplay: item.invoiceNumberRaw,
      })),
      settings,
    );
    const totals = aggregateCases(
      drafts.map((draft) => ({
        matchType: draft.matchType,
        currency: draft.currency,
        exposureMinor: draft.exposureMinor,
        recoveredMinor: 0n,
        status: "open",
      })),
    );
    expect(totals.exactExposure).toEqual([
      { currency: "SAR", minor: 290500n },
      { currency: "EUR", minor: 100000n },
    ]);
    expect(totals.proximityExposure).toEqual([{ currency: "SAR", minor: 264000n }]);
    expect(totals.realizedRecovery).toEqual([]);
    const alNoor = drafts.find((draft) => draft.displaySupplier === "شركة النور للتجارة");
    expect(alNoor?.exposureMinor).toBe(12500n);
    expect(drafts.find((draft) => draft.invoiceKey === "INV1100" && draft.currency === "SAR")).toBeUndefined();
    expect(drafts.find((draft) => draft.displaySupplier === "Zeta Telecom")).toBeUndefined();
  });
});
