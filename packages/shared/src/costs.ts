/**
 * Berlin purchase cost math, preserved from the artifact:
 * all-in = price * (1 + (transfer tax % + notary % + commission %) / 100)
 */
export interface CostSettings {
  /** Grunderwerbsteuer — property transfer tax, % of price. Berlin: 6. */
  gre: number;
  /** Notary + land registry, % of price. Typically 2. */
  notary: number;
  /** Default buyer's commission %, used when a listing has none set. */
  provision: number;
}

export interface AllInCost {
  total: number;
  /** Combined percentage applied on top of the purchase price. */
  pct: number;
  /** The commission % actually used (listing override or default). */
  provision: number;
}

export function allInCost(
  price: number | null | undefined,
  settings: CostSettings,
  provisionOverride?: number | null
): AllInCost | null {
  if (price == null || !(price > 0)) return null;
  const provision = provisionOverride ?? settings.provision;
  const pct = settings.gre + settings.notary + provision;
  return { total: Math.round(price * (1 + pct / 100)), pct, provision };
}

export function pricePerSqm(
  price: number | null | undefined,
  sqm: number | null | undefined
): number | null {
  if (price == null || sqm == null || !(price > 0) || !(sqm > 0)) return null;
  return Math.round(price / sqm);
}
