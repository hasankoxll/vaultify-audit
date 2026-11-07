import { describe, expect, it } from "vitest";
import { parseCsv, protectFormula, encodeCsv } from "../src/domain/csv.js";
import { parseDate } from "../src/domain/dates.js";
import { parseAmount } from "../src/domain/money.js";
import { invoiceKey, supplierKey } from "../src/domain/normalize.js";

describe("strict amounts", () => {
  it("parses plain decimals and rejects locale punctuation", () => {
    expect(parseAmount("1500.00", "plain", 2)).toEqual({ ok: true, minor: 150000n });
    expect(parseAmount("-150.00", "plain", 2)).toEqual({ ok: true, minor: -15000n });
    expect(parseAmount("1.234", "plain", 3)).toEqual({ ok: true, minor: 1234n });
    expect(parseAmount("1000", "plain", 0)).toEqual({ ok: true, minor: 1000n });
    expect(parseAmount("1,234.56", "plain", 2).ok).toBe(false);
    expect(parseAmount("1.234", "plain", 2)).toMatchObject({ ok: false, code: "too_many_decimals" });
    expect(parseAmount("1000.50", "plain", 0)).toMatchObject({ ok: false, code: "too_many_decimals" });
    expect(parseAmount("1.2340", "plain", 3)).toMatchObject({ ok: false, code: "too_many_decimals" });
  });

  it("rejects values that are valid under two locales with different magnitudes", () => {
    expect(parseAmount("1.234", "en-US", 3)).toMatchObject({ ok: false, code: "ambiguous_amount" });
    expect(parseAmount("1,234", "en-US", 2)).toMatchObject({ ok: false, code: "ambiguous_amount" });
    expect(parseAmount("1,234.56", "en-US", 2)).toEqual({ ok: true, minor: 123456n });
    expect(parseAmount("1.234,56", "eu", 2)).toEqual({ ok: true, minor: 123456n });
    expect(parseAmount("1.234,56", "en-US", 2)).toMatchObject({ ok: false, code: "invalid_amount" });
    expect(parseAmount("12,34", "eu", 2)).toEqual({ ok: true, minor: 1234n });
    expect(parseAmount("(100.00)", "plain", 2)).toMatchObject({ ok: false, code: "invalid_amount" });
    expect(parseAmount("1e3", "plain", 2)).toMatchObject({ ok: false, code: "invalid_amount" });
  });
});

describe("strict dates", () => {
  it("accepts only the selected format and real calendar days", () => {
    expect(parseDate("2026-02-29", "YYYY-MM-DD")).toMatchObject({ ok: false, code: "invalid_date" });
    expect(parseDate("2024-02-29", "YYYY-MM-DD")).toEqual({ ok: true, iso: "2024-02-29" });
    expect(parseDate("2026-02-31", "YYYY-MM-DD")).toMatchObject({ ok: false, code: "invalid_date" });
    expect(parseDate("01/02/2026", "YYYY-MM-DD")).toMatchObject({ ok: false, code: "invalid_date" });
    expect(parseDate("01/02/2026", "MM/DD/YYYY")).toEqual({ ok: true, iso: "2026-01-02" });
    expect(parseDate("01/02/2026", "DD/MM/YYYY")).toEqual({ ok: true, iso: "2026-02-01" });
    expect(parseDate("02/31/2026", "MM/DD/YYYY")).toMatchObject({ ok: false, code: "invalid_date" });
    expect(parseDate("31/04/2026", "DD/MM/YYYY")).toMatchObject({ ok: false, code: "invalid_date" });
  });
});

describe("csv and normalization", () => {
  it("parses quoted csv and preserves formula-like text", () => {
    const table = parseCsv('supplier,note\r\n"North, Wind","say ""hi"""\n=cmd,"line\nbreak"\n');
    expect(table.headers).toEqual(["supplier", "note"]);
    expect(table.records[0]?.cells).toEqual(["North, Wind", 'say "hi"']);
    expect(table.records[1]?.cells).toEqual(["=cmd", "line\nbreak"]);
    expect(table.records.map((record) => record.rowNumber)).toEqual([2, 3]);
  });

  it("prefixes spreadsheet formulas on export", () => {
    expect(protectFormula('=HYPERLINK("http://evil.example","Click")')).toBe('\'=HYPERLINK("http://evil.example","Click")');
    expect(protectFormula("+cmd")).toBe("'+cmd");
    expect(protectFormula("-10+20")).toBe("'-10+20");
    expect(protectFormula("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(protectFormula("\t=1")).toBe("'\t=1");
    expect(protectFormula("  =1")).toBe("'  =1");
    const csv = encodeCsv([
      ["supplier", "amount"],
      ['=HYPERLINK("http://evil.example","Click")', "-10.00"],
    ]);
    expect(csv).toContain(`'=HYPERLINK`);
    expect(csv).toContain("'-10.00");
    expect(csv.startsWith("\uFEFF")).toBe(true);
  });

  it("normalizes supplier and invoice keys without fuzzy similarity", () => {
    expect(supplierKey("sup 001", "Other Name")).toBe("id:SUP001");
    expect(supplierKey("", "North Wind, LLC")).toBe(supplierKey("", "north wind llc"));
    expect(supplierKey("", "Acme Inc")).not.toBe(supplierKey("", "Acme Incorporated"));
    expect(invoiceKey("inv 1001")).toBe(invoiceKey("INV-1001"));
    expect(invoiceKey("INV-1001")).not.toBe(invoiceKey("INV-1002"));
    expect(invoiceKey("")).toBeNull();
  });
});
