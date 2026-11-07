export interface AggregateInput {
  matchType: "exact" | "proximity";
  currency: string;
  exposureMinor: bigint;
  recoveredMinor: bigint;
  status: string;
}

export interface CurrencyTotal {
  currency: string;
  minor: bigint;
}

export interface ExposureTotals {
  exactExposure: CurrencyTotal[];
  proximityExposure: CurrencyTotal[];
  realizedRecovery: CurrencyTotal[];
}

const ACTIVE = new Set(["open", "confirmed_for_review"]);

export function aggregateCases(cases: AggregateInput[]): ExposureTotals {
  const exact = new Map<string, bigint>();
  const proximity = new Map<string, bigint>();
  const realized = new Map<string, bigint>();
  for (const item of cases) {
    if (!ACTIVE.has(item.status)) continue;
    const recovered = item.recoveredMinor > item.exposureMinor ? item.exposureMinor : item.recoveredMinor < 0n ? 0n : item.recoveredMinor;
    const potential = item.exposureMinor - recovered;
    if (item.matchType === "exact") {
      add(exact, item.currency, potential);
      add(realized, item.currency, recovered);
    } else if (item.matchType === "proximity") {
      add(proximity, item.currency, potential);
    }
  }
  return {
    exactExposure: entries(exact),
    proximityExposure: entries(proximity),
    realizedRecovery: entries(realized),
  };
}

function add(map: Map<string, bigint>, currency: string, amount: bigint) {
  if (amount === 0n) return;
  map.set(currency, (map.get(currency) ?? 0n) + amount);
}

function entries(map: Map<string, bigint>): CurrencyTotal[] {
  return [...map.entries()]
    .map(([currency, minor]) => ({ currency, minor }))
    .sort((a, b) => currencySort(a.currency, b.currency));
}

export function currencySort(a: string, b: string): number {
  if (a === b) return 0;
  if (a === "SAR") return -1;
  if (b === "SAR") return 1;
  return a < b ? -1 : 1;
}
