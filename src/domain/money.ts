import { currencyDigits } from "./currencies.js";

export type AmountLocale = "plain" | "en-US" | "eu";

export type AmountErrorCode = "empty_amount" | "invalid_amount" | "ambiguous_amount" | "too_many_decimals";

export type AmountParseResult =
  | { ok: true; minor: bigint }
  | { ok: false; code: AmountErrorCode };

const MAX_WHOLE_DIGITS = 12;

export function parseAmount(raw: string, locale: AmountLocale, minorDigits: number): AmountParseResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, code: "empty_amount" };
  if (trimmed.length > 100) return { ok: false, code: "invalid_amount" };
  if (locale === "plain") return parsePlain(trimmed, minorDigits);
  return parseLocalized(trimmed, locale, minorDigits);
}

export function parseAmountForCurrency(
  raw: string,
  locale: AmountLocale,
  currency: string,
): AmountParseResult | { ok: false; code: "unsupported_currency" } {
  const digits = currencyDigits(currency);
  if (digits === null) return { ok: false, code: "unsupported_currency" };
  return parseAmount(raw, locale, digits);
}

function parsePlain(value: string, minorDigits: number): AmountParseResult {
  if (!/^-?\d+(\.\d+)?$/.test(value)) return { ok: false, code: "invalid_amount" };
  return scaleCanonical(value.startsWith("-") ? value.slice(1) : value, value.startsWith("-"), minorDigits);
}

function parseLocalized(value: string, locale: AmountLocale, minorDigits: number): AmountParseResult {
  if (!/^-?[\d.,]+$/.test(value)) return { ok: false, code: "invalid_amount" };
  const negative = value.startsWith("-");
  const body = negative ? value.slice(1) : value;
  if (!body || body.startsWith(",") || body.startsWith(".")) return { ok: false, code: "invalid_amount" };
  const en = tryEn(body);
  const eu = tryEu(body);
  const selected = locale === "en-US" ? en : eu;
  if (!selected) return { ok: false, code: "invalid_amount" };
  if (en && eu && en !== eu) return { ok: false, code: "ambiguous_amount" };
  return scaleCanonical(selected, negative, minorDigits);
}

function tryEn(body: string): string | null {
  const match = body.match(/^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/);
  const wholePart = match?.[1];
  if (!wholePart) return null;
  const whole = wholePart.replace(/,/g, "");
  return match[2] !== undefined ? `${whole}.${match[2]}` : whole;
}

function tryEu(body: string): string | null {
  const match = body.match(/^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?$/);
  const wholePart = match?.[1];
  if (!match || !wholePart) return null;
  const whole = wholePart.replace(/\./g, "");
  return match[2] !== undefined ? `${whole}.${match[2]}` : whole;
}

function scaleCanonical(canonical: string, negative: boolean, minorDigits: number): AmountParseResult {
  const [whole, frac = ""] = canonical.split(".");
  if (!whole || whole.length > MAX_WHOLE_DIGITS) return { ok: false, code: "invalid_amount" };
  if (frac.length > minorDigits) return { ok: false, code: "too_many_decimals" };
  const padded = frac.padEnd(minorDigits, "0");
  const digits = `${whole}${padded}`.replace(/^0+(?=\d)/, "");
  const minor = BigInt(digits === "" ? "0" : digits);
  return { ok: true, minor: negative ? -minor : minor };
}

export function formatMinor(minor: bigint, digits: number): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const raw = abs.toString().padStart(digits + 1, "0");
  const whole = digits === 0 ? raw : raw.slice(0, raw.length - digits);
  const frac = digits === 0 ? "" : raw.slice(raw.length - digits);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = digits === 0 ? grouped : `${grouped}.${frac}`;
  return negative ? `-${body}` : body;
}

export function formatPlainMinor(minor: bigint, digits: number): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const raw = abs.toString().padStart(digits + 1, "0");
  const whole = digits === 0 ? raw : raw.slice(0, -digits);
  const frac = digits === 0 ? "" : raw.slice(-digits);
  const body = digits === 0 ? whole : `${whole}.${frac}`;
  return negative ? `-${body}` : body;
}
