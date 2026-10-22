/**
 * Factor Engine
 * =============
 * Fundamental factor construction (Fama–French 1992/1993/2015, Carhart 1997,
 * Asness– Frazzini–Pedersen 2019 "Quality Minus Junk", Novy–Marx 2013
 * "Gross Profitability", Sloan 1996 "Accruals") plus Fama–MacBeth
 * cross-sectional regression for estimating factor premia.
 *
 * The factor definitions below are the *implementable proxies* used by
 * academic replication packages and by the Ken French Data Library:
 *
 *   Value          (HML)  : book equity / market capitalisation
 *   Profitability  (RMW)  : operating profitability  (gross profit − SG&A)/assets
 *   Investment     (CMA)  : asset growth  (conservative investment, inverse)
 *   Size           (SMB)  : log market capitalisation (negative exposure = small)
 *   Momentum       (Mom)  : 12−1 month total return (skip the most recent month)
 *   Quality                : gross profitability + low accruals + low leverage
 *   Low volatility         : trailing 3-year daily/quarterly return variance
 *
 * References
 *   - Fama, E. & French, K. (1992, 1993, 2015) — the 3- and 5-factor models.
 *   - Carhart, M. (1997) "On Persistence in Mutual Fund Performance".
 *   - Asness, C., Frazzini, A. & Pedersen, L. (2019) "Quality Minus Junk",
 *     Journal of Financial Economics.
 *   - Novy-Marx, R. (2013) "The Other Side of Value", Journal of Financial
 *     Economics — gross profitability.
 *   - Sloan, R. (1996) "Do Stock Prices Fully Reflect Information in Accruals
 *     and Cash Flows About Future Earnings?", Accounting Review.
 *   - Fama–MacBeth (1973) "Risk, Return and Equilibrium: Empirical Tests".
 */

import type { FinancialQuarter } from "@prisma/client";

export interface FactorDefinition {
  key: string;
  name: string;
  description: string;
  /** Direction in which a *higher* raw value is considered attractive. */
  higherIsBetter: boolean;
  paper: string;
}

export const FACTOR_DEFINITIONS: FactorDefinition[] = [
  {
    key: "value",
    name: "Value (HML)",
    description:
      "Book equity divided by market capitalisation. High Book-to-Market is the classic Fama–French High-Minus-Low leg.",
    higherIsBetter: true,
    paper: "Fama & French (1992), Journal of Finance",
  },
  {
    key: "profitability",
    name: "Profitability (RMW)",
    description:
      "Operating profitability: (gross profit − operating expense) / total assets. Robust, low-risk component of the 5-factor model.",
    higherIsBetter: true,
    paper: "Fama & French (2015), Journal of Financial Economics",
  },
  {
    key: "investment",
    name: "Investment (CMA)",
    description:
      "Conservative investment: year-over-year growth in total assets. Low investment (and low asset growth) is priced as higher expected return.",
    higherIsBetter: false,
    paper: "Fama & French (2015), Journal of Financial Economics",
  },
  {
    key: "size",
    name: "Size (SMB)",
    description: "Log market capitalisation. The size premium loads negatively on this factor.",
    higherIsBetter: false,
    paper: "Fama & French (1992), Journal of Finance",
  },
  {
    key: "momentum",
    name: "Momentum (Mom)",
    description:
      "12−1 month total return: the trailing return skipping the most recent month to avoid the short-term reversal effect.",
    higherIsBetter: true,
    paper: "Jegadeesh & Titman (1993), Journal of Finance; Carhart (1997)",
  },
  {
    key: "quality",
    name: "Quality Minus Junk (QMJ)",
    description:
      "Composite of profitability, growth, safety (leverage) and payout. Combines Novy-Marx gross profitability with the Asness et al. quality definition.",
    higherIsBetter: true,
    paper: "Asness, Frazzini & Pedersen (2019), Journal of Financial Economics",
  },
  {
    key: "accruals",
    name: "Accruals (Sloan)",
    description:
      "Balance-sheet and cash-flow accruals divided by average total assets. High accruals predict lower future returns (earnings quality).",
    higherIsBetter: false,
    paper: "Sloan (1996), The Accounting Review",
  },
  {
    key: "lowVol",
    name: "Low Volatility",
    description: "Inverse of trailing return volatility. Low-beta/low-vol anomaly (Baker, Bradley & Wurgler, 2011).",
    higherIsBetter: false,
    paper: "Baker, Bradley & Wurgler (2011), Financial Analysts Journal",
  },
];

export interface FactorExposure {
  key: string;
  name: string;
  raw: number | null;
  /** Cross-sectional z-score against the peer universe (null if no peers). */
  z: number | null;
  /** Percentile rank within the peer universe (0–100). */
  percentile: number | null;
  higherIsBetter: boolean;
  description: string;
  paper: string;
}

export interface CompanyFactorProfile {
  ticker: string;
  exposures: FactorExposure[];
  /** Composite factor score 0–100 (equal-weighted z-scores, sign-adjusted). */
  compositeScore: number | null;
  /** Top-3 positive factor drivers. */
  drivers: { key: string; name: string; percentile: number | null }[];
  /** Top-3 negative factor drivers. */
  detractors: { key: string; name: string; percentile: number | null }[];
}

function n(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const x = typeof v === "object" && v !== null && "toNumber" in (v as any)
    ? (v as any).toNumber()
    : Number(v);
  return Number.isFinite(x) ? x : null;
}

export interface RawFactors {
  value: number | null;
  profitability: number | null;
  investment: number | null;
  size: number | null;
  momentum: number | null;
  quality: number | null;
  accruals: number | null;
  lowVol: number | null;
}

/**
 * Compute raw factor values for a single company.
 *
 * @param quarters  quarterly fundamentals, oldest → newest
 * @param marketCap latest market capitalisation (price × shares)
 * @param closePrices trailing close prices (oldest → newest), used for momentum & volatility
 */
export function computeRawFactors(
  quarters: FinancialQuarter[],
  marketCap: number | null,
  closePrices: number[]
): RawFactors {
  const sorted = [...quarters].sort(
    (a, b) => a.fiscalYear - b.fiscalYear || a.fiscalQuarter - b.fiscalQuarter
  );
  const latest = sorted[sorted.length - 1];
  const priorYear = sorted[sorted.length - 5]; // same quarter last year
  const empty: RawFactors = {
    value: null, profitability: null, investment: null, size: null,
    momentum: null, quality: null, accruals: null, lowVol: null,
  };
  if (!latest) return empty;

  const equity = n(latest.totalEquity);
  const assets = n(latest.totalAssets);
  const grossProfit = n(latest.grossProfit);
  const opex = n(latest.operatingExpense);
  const netIncome = n(latest.netIncome);
  const ocf = n(latest.operatingCashFlow);
  const totalDebt = n(latest.totalDebt);
  const priorAssets = priorYear ? n(priorYear.totalAssets) : null;

  // Value: book-to-market
  const value = equity !== null && marketCap !== null && marketCap > 0 ? equity / marketCap : null;

  // Profitability: operating profitability (RMW proxy)
  const operatingProfit = grossProfit !== null && opex !== null ? grossProfit - opex : null;
  const profitability =
    operatingProfit !== null && assets !== null && assets > 0 ? operatingProfit / assets : null;

  // Investment: asset growth (CMA proxy)
  const investment =
    priorAssets !== null && assets !== null && priorAssets > 0 ? assets / priorAssets - 1 : null;

  // Size: log market cap
  const size = marketCap !== null && marketCap > 0 ? Math.log(marketCap) : null;

  // Accruals: (NI − OCF) / average total assets (Sloan)
  const avgAssets = priorAssets !== null ? (assets! + priorAssets) / 2 : assets;
  const accruals =
    netIncome !== null && ocf !== null && avgAssets !== null && avgAssets > 0
      ? (netIncome - ocf) / avgAssets
      : null;

  // Quality: profitability − accruals + safety (low leverage) + payout proxy
  const leverage = assets !== null && equity !== null && equity > 0
    ? (totalDebt ?? 0) / assets
    : null;
  const safety = leverage !== null ? -leverage : null;
  const qualityComponents = [profitability, accruals !== null ? -accruals : null, safety].filter(
    (v): v is number => v !== null
  );
  const quality = qualityComponents.length >= 2
    ? qualityComponents.reduce((a, b) => a + b, 0) / qualityComponents.length
    : null;

  // Momentum: 12−1 month return approximated from the close-price series
  const momentum = computeMomentum(closePrices);

  // Low volatility: standard deviation of trailing returns (annualised)
  const lowVol = computeRealizedVol(closePrices);

  return { value, profitability, investment, size, momentum, quality, accruals, lowVol };
}

/**
 * 12−1 month momentum from a price series.
 * `prices` are closes ordered oldest → newest; one observation is assumed to
 * be one month (or is rescaled by `obsPerYear`).
 */
export function computeMomentum(prices: number[], obsPerYear = 12): number | null {
  if (prices.length < 13) return null;
  const end = prices[prices.length - 1];
  const start = prices[prices.length - 12]; // t-12
  const skip = prices[prices.length - 2];   // t-1 (skip the most recent month)
  if (start <= 0 || skip <= 0) return null;
  return skip / start - 1;
}

/** Annualised realised volatility from a price series. */
export function computeRealizedVol(prices: number[], obsPerYear = 252): number | null {
  if (prices.length < 4) return null;
  const rets: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0) rets.push(prices[i] / prices[i - 1] - 1);
  }
  if (rets.length < 3) return null;
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((a, r) => a + (r - m) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(v * obsPerYear);
}

/**
 * Cross-sectional standardisation of raw factors across a peer universe and
 * the construction of a composite score.
 */
export function buildFactorProfile(
  ticker: string,
  raw: RawFactors,
  universe: RawFactors[]
): CompanyFactorProfile {
  const exposures: FactorExposure[] = FACTOR_DEFINITIONS.map((def) => {
    const value = raw[def.key as keyof RawFactors];
    const peers = universe
      .map((u) => u[def.key as keyof RawFactors])
      .filter((v): v is number => v !== null && Number.isFinite(v));

    let z: number | null = null;
    let percentile: number | null = null;
    if (value !== null && peers.length >= 3) {
      const m = peers.reduce((a, b) => a + b, 0) / peers.length;
      const sd = Math.sqrt(peers.reduce((a, b) => a + (b - m) ** 2, 0) / (peers.length - 1));
      z = sd > 0 ? (value - m) / sd : null;
      const below = peers.filter((v) => v < value).length;
      percentile = (below / peers.length) * 100;
    }
    return {
      key: def.key,
      name: def.name,
      raw: value,
      z,
      percentile,
      higherIsBetter: def.higherIsBetter,
      description: def.description,
      paper: def.paper,
    };
  });

  const scored = exposures.filter((e) => e.z !== null);
  const compositeScore = scored.length
    ? Math.round(
        (scored.reduce((acc, e) => acc + (e.higherIsBetter ? e.z! : -e.z!), 0) / scored.length) *
          25 +
          50
      )
    : null;

  const ranked = [...exposures].filter((e) => e.percentile !== null).sort(
    (a, b) => (b.percentile ?? 0) - (a.percentile ?? 0)
  );

  return {
    ticker,
    exposures,
    compositeScore,
    drivers: ranked.slice(0, 3).map((e) => ({ key: e.key, name: e.name, percentile: e.percentile })),
    detractors: ranked.slice(-3).reverse().map((e) => ({ key: e.key, name: e.name, percentile: e.percentile })),
  };
}

export interface FamaMacBethResult {
  periods: number;
  /** Average cross-sectional premium per factor (per period). */
  premia: { key: string; name: string; premium: number; tStat: number }[];
}

/**
 * Fama–MacBeth two-pass regression: in each period, regress asset returns on
 * their factor exposures, then average the slopes across periods to obtain
 * factor premia and their t-statistics.
 */
export function famaMacBeth(
  periods: {
    returns: number[];
    exposures: { key: string; value: number }[][]; // periods × assets
    names: string[];
  }[]
): FamaMacBethResult {
  const factorKeys = Array.from(new Set(periods.flatMap((p) => p.exposures.flatMap((e) => e.map((x) => x.key)))));
  const premiums: Record<string, number[]> = {};

  for (const period of periods) {
    const nAssets = period.returns.length;
    if (nAssets < factorKeys.length + 2) continue;

    // Build the design matrix: intercept + factor dummies
    const X: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < nAssets; i++) {
      const row = [1];
      for (const fk of factorKeys) {
        const e = period.exposures[i]?.find((x) => x.key === fk);
        row.push(e?.value ?? 0);
      }
      X.push(row);
      y.push(period.returns[i]);
    }

    // Ridge-regularised least squares (small k, n large enough)
    const lambda = 0.05;
    const k = X[0].length;
    const XtX: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
    const Xty: number[] = new Array(k).fill(0);
    for (let i = 0; i < X.length; i++) {
      for (let a = 0; a < k; a++) {
        Xty[a] += X[i][a] * y[i];
        for (let b = 0; b < k; b++) XtX[a][b] += X[i][a] * X[i][b];
      }
    }
    for (let a = 0; a < k; a++) XtX[a][a] += lambda;
    const inv = invert(XtX);
    if (!inv) continue;
    const beta = inv.map((row) => row.reduce((acc, v, j) => acc + v * Xty[j], 0));

    factorKeys.forEach((fk, idx) => {
      if (!premiums[fk]) premiums[fk] = [];
      premiums[fk].push(beta[idx + 1]);
    });
  }

  const premia = factorKeys
    .map((fk) => {
      const series = premiums[fk] ?? [];
      const def = FACTOR_DEFINITIONS.find((d) => d.key === fk);
      if (series.length < 2) {
        return { key: fk, name: def?.name ?? fk, premium: 0, tStat: 0 };
      }
      const m = series.reduce((a, b) => a + b, 0) / series.length;
      const sd = Math.sqrt(series.reduce((a, b) => a + (b - m) ** 2, 0) / (series.length - 1));
      return {
        key: fk,
        name: def?.name ?? fk,
        premium: m,
        tStat: sd > 0 ? m / (sd / Math.sqrt(series.length)) : 0,
      };
    })
    .sort((a, b) => b.tStat - a.tStat);

  return { periods: periods.length, premia };
}

function invert(m: number[][]): number[][] | null {
  const n = m.length;
  if (n === 0) return null;
  const a = m.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    if (pivot !== col) { const t = a[pivot]; a[pivot] = a[col]; a[col] = t; }
    const p = a[col][col];
    for (let c = 0; c < 2 * n; c++) a[col][c] /= p;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = a[r][col];
      if (f === 0) continue;
      for (let c = 0; c < 2 * n; c++) a[r][c] -= f * a[col][c];
    }
  }
  return a.map((r) => r.slice(n));
}
