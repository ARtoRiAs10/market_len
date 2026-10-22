/**
 * Shared helpers for strategy implementations.
 *
 * These utilities normalise the messy parts of working with the
 * `FinancialQuarter` fact table: Decimal → number conversion, safe ratio
 * maths, and quarter-window slicing.
 */

import { FinancialQuarter } from "@prisma/client";

export function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "object" && value !== null && "toNumber" in (value as any)
    ? (value as any).toNumber()
    : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Safe division — returns null when the denominator is missing or zero. */
export function div(a: number | null, b: number | null | undefined): number | null {
  if (a === null || b === null || b === undefined || b === 0) return null;
  const r = a / b;
  return Number.isFinite(r) ? r : null;
}

/** Sort quarters chronologically (oldest → newest). */
export function sortQuarters(quarters: FinancialQuarter[]): FinancialQuarter[] {
  return [...quarters].sort(
    (a, b) => a.fiscalYear - b.fiscalYear || a.fiscalQuarter - b.fiscalQuarter
  );
}

/** Trailing window of the most recent `n` quarters. */
export function lastQuarters(quarters: FinancialQuarter[], n: number): FinancialQuarter[] {
  return sortQuarters(quarters).slice(-Math.max(1, n));
}

/** Label used in charts and tables. */
export function quarterLabel(q: FinancialQuarter): string {
  return `Q${q.fiscalQuarter} FY${q.fiscalYear}`;
}

/** Market capitalisation implied by the last close price and share count. */
export function marketCapOf(q: FinancialQuarter): number | null {
  const price = num(q.closePrice);
  const shares = num(q.sharesOutstanding);
  if (price === null || shares === null) return null;
  return price * shares;
}

/** Net working capital (current assets − current liabilities). */
export function netWorkingCapital(q: FinancialQuarter): number | null {
  const ca = num(q.currentAssets);
  const cl = num(q.currentLiabilities);
  if (ca === null || cl === null) return null;
  return ca - cl;
}

/** Total debt (falls back to long-term debt only). */
export function totalDebtOf(q: FinancialQuarter): number | null {
  const td = num(q.totalDebt);
  if (td !== null) return td;
  return num(q.longTermDebt);
}

/** Free cash flow (OCF − capex) with fallbacks. */
export function freeCashFlowOf(q: FinancialQuarter): number | null {
  const fcf = num(q.freeCashFlow);
  if (fcf !== null) return fcf;
  const ocf = num(q.operatingCashFlow);
  const capex = num(q.capex);
  if (ocf === null || capex === null) return null;
  return ocf - capex;
}

/** Annualise a quarterly flow value (×4). */
export function annualise(q: FinancialQuarter, value: number | null): number | null {
  return value === null ? null : value * 4;
}

/**
 * Cross-sectional percentile of `value` within `universe` (0–100).
 * Returns null when the universe is too small to be meaningful.
 */
export function percentileOf(value: number | null, universe: number[]): number | null {
  if (value === null) return null;
  const peers = universe.filter((v) => Number.isFinite(v));
  if (peers.length < 3) return null;
  const below = peers.filter((v) => v < value).length;
  return (below / peers.length) * 100;
}

/** Z-score of `value` within `universe`. */
export function zOf(value: number | null, universe: number[]): number | null {
  if (value === null) return null;
  const peers = universe.filter((v) => Number.isFinite(v));
  if (peers.length < 3) return null;
  const m = peers.reduce((a, b) => a + b, 0) / peers.length;
  const sd = Math.sqrt(peers.reduce((a, b) => a + (b - m) ** 2, 0) / (peers.length - 1));
  return sd > 0 ? (value - m) / sd : null;
}

/** Mean of an array of nullable numbers. */
export function meanOf(values: (number | null)[]): number | null {
  const vals = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}
