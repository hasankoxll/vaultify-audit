export type DateFormat = "YYYY-MM-DD" | "DD/MM/YYYY" | "MM/DD/YYYY" | "DD-MM-YYYY";

export type DateParseResult = { ok: true; iso: string } | { ok: false; code: "empty_date" | "invalid_date" };

const MIN_YEAR = 1990;
const MAX_YEAR = 2100;

export function parseDate(raw: string, format: DateFormat): DateParseResult {
  const value = raw.trim();
  if (!value) return { ok: false, code: "empty_date" };
  if (value.length > 32) return { ok: false, code: "invalid_date" };
  const parts = matchParts(value, format);
  if (!parts) return { ok: false, code: "invalid_date" };
  const { year, month, day } = parts;
  if (!isRealDate(year, month, day)) return { ok: false, code: "invalid_date" };
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { ok: true, iso };
}

function matchParts(value: string, format: DateFormat): { year: number; month: number; day: number } | null {
  if (format === "YYYY-MM-DD") {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  }
  if (format === "DD/MM/YYYY") {
    const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return null;
    return { year: Number(match[3]), month: Number(match[2]), day: Number(match[1]) };
  }
  if (format === "MM/DD/YYYY") {
    const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return null;
    return { year: Number(match[3]), month: Number(match[1]), day: Number(match[2]) };
  }
  const match = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return null;
  return { year: Number(match[3]), month: Number(match[2]), day: Number(match[1]) };
}

function isRealDate(year: number, month: number, day: number): boolean {
  if (year < MIN_YEAR || year > MAX_YEAR) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function daysBetweenIso(a: string, b: string): number {
  const left = Date.parse(`${a}T00:00:00Z`);
  const right = Date.parse(`${b}T00:00:00Z`);
  return Math.abs(Math.round((left - right) / 86_400_000));
}
