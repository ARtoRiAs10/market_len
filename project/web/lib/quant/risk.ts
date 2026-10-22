/**
 * Portfolio Risk Engine
 * =====================
 * Industry-standard risk measures used by institutional risk systems
 * (Barra/BlackRock Aladdin style) implemented in a dependency-free way.
 *
 * Measures implemented
 *   - Annualised return, volatility, Sharpe, Sortino, Calmar, Omega
 *   - Historical & parametric VaR, Expected Shortfall (CVaR)
 *   - Maximum drawdown, drawdown duration, Ulcer Index
 *   - Beta, alpha, tracking error, information ratio vs. a benchmark
 *   - Beta / correlation matrices, marginal & component risk contributions
 *
 * References
 *   - Markowitz, H. (1952) "Portfolio Selection" — mean-variance.
 *   - Sortino, F. & Price, L. (1994) — downside-risk adjusted return.
 *   - Rockafellar, R. & Uryasev, S. (2002) — Conditional Value-at-Risk.
 *   - Ledoit & Wolf (2004) — shrinkage covariance for risk decomposition.
 */

import {
  blockBootstrapCI,
  correlation,
  covarianceMatrix,
  deflatedSharpeRatio,
  geometricMean,
  ledoitWolfCovariance,
  mean,
  normalInv,
  ols,
  quantile,
  skewness,
  stdDev,
} from "./stats";

export const TRADING_DAYS = 252;
export const MONTHS = 12;

export interface RiskMetrics {
  observations: number;
  /** Annualised total return (geometric). */
  cagr: number | null;
  totalReturn: number | null;
  annualisedVol: number | null;
  sharpe: number | null;
  sortino: number | null;
  calmar: number | null;
  omegaRatio: number | null;
  maxDrawdown: number | null;
  maxDrawdownDurationDays: number | null;
  ulcerIndex: number | null;
  var95Historical: number | null;
  cvar95: number | null;
  varParametric95: number | null;
  skew: number | null;
  excessKurtosis: number | null;
  /** Beta to the benchmark (null when no benchmark supplied). */
  beta: number | null;
  /** Annualised Jensen alpha (null without benchmark). */
  alpha: number | null;
  /** Annualised tracking error vs. benchmark. */
  trackingError: number | null;
  informationRatio: number | null;
  /** Correlation to the benchmark. */
  correlationToBenchmark: number | null;
  /** Newey-West (HAC) t-statistic of the alpha estimate. */
  alphaTStat: number | null;
  /** Probability that the true Sharpe is positive after multiple testing. */
  deflatedSharpeProb: number | null;
  /** Block-bootstrap 95% CI for the Sharpe ratio. */
  sharpeCI: { lower: number; upper: number; point: number } | null;
  /** Percent of periods with a positive return. */
  hitRate: number | null;
  /** Best / worst single-period return. */
  bestPeriod: number | null;
  worstPeriod: number | null;
  /** Average return in the worst 5% of periods (tail statistic). */
  expectedShortfall95: number | null;
}

export const EMPTY_RISK_METRICS: RiskMetrics = {
  observations: 0, cagr: null, totalReturn: null, annualisedVol: null, sharpe: null,
  sortino: null, calmar: null, omegaRatio: null, maxDrawdown: null,
  maxDrawdownDurationDays: null, ulcerIndex: null, var95Historical: null, cvar95: null,
  varParametric95: null, skew: null, excessKurtosis: null, beta: null, alpha: null,
  trackingError: null, informationRatio: null, correlationToBenchmark: null,
  alphaTStat: null, deflatedSharpeProb: null, sharpeCI: null, hitRate: null,
  bestPeriod: null, worstPeriod: null, expectedShortfall95: null,
};

/** Number of periods per year for a given sampling frequency. */
export function periodsPerYear(frequency: "daily" | "weekly" | "monthly" | "quarterly"): number {
  switch (frequency) {
    case "daily": return TRADING_DAYS;
    case "weekly": return 52;
    case "monthly": return MONTHS;
    case "quarterly": return 4;
  }
}

/**
 * Drawdown series from a NAV (or cumulative return) path.
 * Returns negative numbers (0 = at a new high).
 */
export function drawdownSeries(nav: number[]): number[] {
  const out: number[] = [];
  let peak = nav.length > 0 ? nav[0] : 0;
  for (const v of nav) {
    if (v > peak) peak = v;
    out.push(peak > 0 ? v / peak - 1 : 0);
  }
  return out;
}

/** Maximum drawdown (negative value, e.g. -0.27 for a 27% drawdown). */
export function maxDrawdown(nav: number[]): number | null {
  const dd = drawdownSeries(nav);
  if (dd.length === 0) return null;
  return Math.min(...dd);
}

/** Longest number of periods spent underwater (drawdown duration). */
export function maxDrawdownDuration(dd: number[]): number | null {
  let longest = 0, current = 0;
  for (const v of dd) {
    if (v < 0) { current++; longest = Math.max(longest, current); } else { current = 0; }
  }
  return longest;
}

/** Ulcer Index (Brown, 1995) — quadratic mean of drawdowns. */
export function ulcerIndex(dd: number[]): number | null {
  if (dd.length === 0) return null;
  const q = Math.sqrt(dd.reduce((acc, v) => acc + v * v, 0) / dd.length);
  return q;
}

/** Historical Value-at-Risk (quantile of the return distribution). */
export function historicalVaR(returns: number[], confidence = 0.95): number | null {
  const q = quantile(returns, 1 - confidence);
  return q === null ? null : -q;
}

/**
 * Expected Shortfall / Conditional VaR (Rockafellar & Uryasev, 2002).
 * The average return in the worst (1 - confidence) tail.
 */
export function expectedShortfall(returns: number[], confidence = 0.95): number | null {
  if (returns.length === 0) return null;
  const cut = quantile(returns, 1 - confidence);
  if (cut === null) return null;
  const tail = returns.filter((r) => r <= cut);
  if (tail.length === 0) return cut;
  return -mean(tail)!;
}

/** Parametric (variance-covariance) VaR under a normal assumption. */
export function parametricVaR(
  returns: number[],
  confidence = 0.95,
  periodsPerYear = TRADING_DAYS
): number | null {
  const mu = mean(returns);
  const sigma = stdDev(returns);
  if (mu === null || sigma === null || sigma === 0) return null;
  const z = normalInv(1 - confidence);
  const dailyVar = -(mu + z * sigma);
  return dailyVar * Math.sqrt(periodsPerYear);
}

/** Omega ratio — probability-weighted gains vs. losses over a threshold. */
export function omegaRatio(returns: number[], threshold = 0): number | null {
  if (returns.length === 0) return null;
  let up = 0, down = 0;
  for (const r of returns) {
    const d = r - threshold;
    if (d > 0) up += d; else down += -d;
  }
  if (down === 0) return null;
  return up / down;
}

/** Downside deviation (Sortino's numerator) relative to a target return. */
export function downsideDeviation(returns: number[], target = 0): number | null {
  if (returns.length === 0) return null;
  let acc = 0;
  let n = 0;
  for (const r of returns) {
    const d = r - target;
    if (d < 0) { acc += d * d; n++; }
  }
  if (n === 0) return 0;
  return Math.sqrt(acc / returns.length);
}

/**
 * Compute the full risk metric set for a return series.
 *
 * @param returns   periodic returns (arithmetic), oldest → newest
 * @param options.benchmark  optional benchmark return series (same length)
 * @param options.frequency  sampling frequency used for annualisation
 * @param options.riskFreeRate  annual risk-free rate (decimal, e.g. 0.04)
 * @param options.trials  number of strategy trials tested (for DSR)
 */
export function computeRiskMetrics(
  returns: number[],
  options: {
    benchmark?: number[];
    frequency?: "daily" | "weekly" | "monthly" | "quarterly";
    riskFreeRate?: number;
    trials?: number;
  } = {}
): RiskMetrics {
  const freq = options.frequency ?? "daily";
  const ppy = periodsPerYear(freq);
  const rfAnnual = options.riskFreeRate ?? 0;
  const rfPerPeriod = Math.pow(1 + rfAnnual, 1 / ppy) - 1;

  if (returns.length < 2) return { ...EMPTY_RISK_METRICS, observations: returns.length };

  const excess = returns.map((r) => r - rfPerPeriod);
  const meanRet = mean(returns)!;
  const vol = stdDev(returns)!;
  const annualVol = vol * Math.sqrt(ppy);

  // NAV path for drawdown statistics
  let nav = 1;
  const navPath = [1];
  for (const r of returns) { nav *= 1 + r; navPath.push(nav); }

  const totalReturn = nav - 1;
  const years = returns.length / ppy;
  const cagr = years > 0 ? Math.pow(nav, 1 / years) - 1 : null;

  const annMeanExcess = mean(excess)! * ppy;
  const sharpe = annualVol > 0 ? annMeanExcess / annualVol : null;

  const dsd = downsideDeviation(excess, 0);
  const annDownside = dsd === null ? null : dsd * Math.sqrt(ppy);
  const sortino = annDownside !== null && annDownside > 0 ? annMeanExcess / annDownside : null;

  const dd = drawdownSeries(navPath);
  const mdd = Math.min(...dd);
  const calmar = mdd < 0 && cagr !== null ? cagr / Math.abs(mdd) : null;

  const omega = omegaRatio(returns, 0);

  const benchmark = options.benchmark;
  let beta: number | null = null;
  let alpha: number | null = null;
  let trackingError: number | null = null;
  let informationRatio: number | null = null;
  let corr: number | null = null;
  let alphaTStat: number | null = null;

  if (benchmark && benchmark.length >= 3) {
    const n = Math.min(returns.length, benchmark.length);
    const y = returns.slice(0, n);
    const x = benchmark.slice(0, n);
    const reg = ols(y, x, freq === "daily" ? 5 : freq === "monthly" ? 2 : 1);
    if (reg) {
      beta = reg.beta;
      alpha = (reg.alpha - rfPerPeriod) * ppy;
      alphaTStat = reg.tStatistic * Math.sqrt(ppy);
    }
    const active = y.map((v, i) => v - x[i]);
    const te = stdDev(active);
    trackingError = te === null ? null : te * Math.sqrt(ppy);
    const activeMean = mean(active)! * ppy;
    informationRatio = trackingError && trackingError > 0 ? activeMean / trackingError : null;
    corr = correlation(y, x);
  }

  const sharpeCI = blockBootstrapCI(excess, (x) => {
    const m = mean(x);
    const s = stdDev(x);
    if (m === null || s === null || s === 0) return 0;
    return (m * ppy) / (s * Math.sqrt(ppy));
  }, { blockSize: freq === "daily" ? 10 : 5, iterations: 500 });

  const dsp = sharpe !== null
    ? deflatedSharpeRatio(sharpe, returns.length, options.trials ?? 1, skewness(returns) ?? 0)
    : null;

  return {
    observations: returns.length,
    cagr,
    totalReturn,
    annualisedVol: annualVol,
    sharpe,
    sortino,
    calmar,
    omegaRatio: omega,
    maxDrawdown: mdd,
    maxDrawdownDurationDays: maxDrawdownDuration(dd),
    ulcerIndex: ulcerIndex(dd),
    var95Historical: historicalVaR(returns, 0.95),
    cvar95: expectedShortfall(returns, 0.95),
    varParametric95: parametricVaR(returns, 0.95, ppy),
    skew: skewness(returns),
    excessKurtosis: null,
    beta,
    alpha,
    trackingError,
    informationRatio,
    correlationToBenchmark: corr,
    alphaTStat,
    deflatedSharpeProb: dsp,
    sharpeCI,
    hitRate: (returns.filter((r) => r > 0).length / returns.length) * 100,
    bestPeriod: Math.max(...returns),
    worstPeriod: Math.min(...returns),
    expectedShortfall95: expectedShortfall(returns, 0.95),
  };
}

export interface CorrelationEntry {
  a: string;
  b: string;
  value: number;
}

export interface RiskContribution {
  name: string;
  weight: number;
  marginalRisk: number;
  componentRisk: number;
  /** Percentage of total portfolio variance explained. */
  percentOfRisk: number;
}

/**
 * Risk decomposition (Brinson, Hood & Beebower style, adapted to Euler
 * contributions). Marginal risk = ∂σ/∂w_i; component risk = w_i × marginal.
 */
export function riskContributions(
  weights: number[],
  covariance: number[][]
): RiskContribution[] {
  const n = weights.length;
  const out: RiskContribution[] = [];
  let totalVar = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) totalVar += weights[i] * weights[j] * covariance[i][j];
  }
  const totalVol = Math.sqrt(Math.max(totalVar, 0));
  const totalAbsRisk = out.length === 0 ? 0 : 0; // placeholder, computed below

  for (let i = 0; i < n; i++) {
    let covWithPortfolio = 0;
    for (let j = 0; j < n; j++) covWithPortfolio += covariance[i][j] * weights[j];
    const marginal = totalVol > 0 ? covWithPortfolio / totalVol : 0;
    const component = weights[i] * marginal;
    out.push({
      name: "",
      weight: weights[i],
      marginalRisk: marginal,
      componentRisk: component,
      percentOfRisk: 0,
    });
  }

  const sumComponent = out.reduce((a, c) => a + c.componentRisk, 0) || 1;
  void totalAbsRisk;
  return out.map((c) => ({ ...c, percentOfRisk: (c.componentRisk / sumComponent) * 100 }));
}

/** Correlation matrix between named return series. */
export function correlationMatrix(
  names: string[],
  series: number[][]
): { names: string[]; matrix: (number | null)[][] } {
  const matrix: (number | null)[][] = [];
  for (let i = 0; i < names.length; i++) {
    const row: (number | null)[] = [];
    for (let j = 0; j < names.length; j++) {
      row.push(i === j ? 1 : correlation(series[i] ?? [], series[j] ?? []));
    }
    matrix.push(row);
  }
  return { names, matrix };
}

/** Covariance matrix using the Ledoit–Wolf shrinkage estimator. */
export function shrinkageCovariance(series: number[][]): number[][] {
  if (series.length < 3) return covarianceMatrix(series);
  return ledoitWolfCovariance(series);
}

/**
 * Historical portfolio NAV series given per-asset return series and weights.
 */
export function portfolioNavSeries(weights: number[], series: number[][]): number[] {
  const length = Math.min(...series.map((s) => s.length));
  const out: number[] = [];
  let nav = 1;
  for (let t = 0; t < length; t++) {
    let r = 0;
    for (let i = 0; i < weights.length; i++) r += weights[i] * (series[i][t] ?? 0);
    nav *= 1 + r;
    out.push(nav);
  }
  return out;
}

/** Period returns of a weighted portfolio. */
export function portfolioReturnSeries(weights: number[], series: number[][]): number[] {
  const length = Math.min(...series.map((s) => s.length));
  const out: number[] = [];
  for (let t = 0; t < length; t++) {
    let r = 0;
    for (let i = 0; i < weights.length; i++) r += weights[i] * (series[i][t] ?? 0);
    out.push(r);
  }
  return out;
}

/**
 * Geometric (Kelly) optimal fraction for a stream of returns.
 * f* = μ / σ² — the fraction of capital to bet. Half-Kelly is the common
 * conservative implementation.
 */
export function kellyFraction(returns: number[]): number | null {
  const mu = mean(returns);
  const varc = returns.length > 1
    ? returns.reduce((a, r) => a + (r - mu!) ** 2, 0) / (returns.length - 1)
    : null;
  if (mu === null || varc === null || varc === 0) return null;
  return mu / varc;
}

/** Cumulative wealth index from a return series (base 100). */
export function cumulativeIndex(returns: number[]): number[] {
  let v = 100;
  const out = [100];
  for (const r of returns) { v *= 1 + r; out.push(v); }
  return out;
}

/** Geometric mean of a return stream expressed as a CAGR-like figure. */
export function annualizedGeometric(returns: number[], ppy = TRADING_DAYS): number | null {
  const g = geometricMean(returns.map((r) => 1 + r));
  if (g === null) return null;
  return Math.pow(1 + g, ppy) - 1;
}
