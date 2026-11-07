/** Explicit allowlist. Unknown ISO codes are rejected rather than guessed. */
export const CURRENCIES: Record<string, { minorDigits: number }> = {
  SAR: { minorDigits: 2 },
  USD: { minorDigits: 2 },
  EUR: { minorDigits: 2 },
  GBP: { minorDigits: 2 },
  AED: { minorDigits: 2 },
  QAR: { minorDigits: 2 },
  EGP: { minorDigits: 2 },
  BHD: { minorDigits: 3 },
  KWD: { minorDigits: 3 },
  OMR: { minorDigits: 3 },
  JPY: { minorDigits: 0 },
};

export function currencyDigits(code: string): number | null {
  return CURRENCIES[code]?.minorDigits ?? null;
}
