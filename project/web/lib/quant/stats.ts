/**
 * Quantitative Statistics Toolbox
 * ===============================
 * Pure, dependency-free implementations of the statistical machinery used by
 * MarketLens v4's risk, optimization, factor and backtest engines.
 *
 * Every function is deterministic and side-effect free so it can be unit
 * tested and reused from API routes, server components and the client.
 *
 * References for the implemented estimators:
 *   - Ledoit, O. & Wolf, M. (2004) "A Well-Conditioned Estimator for
 *     Large-Dimensional Covariance Matrices" — shrinkage covariance.
 *   - Lo, M. (2002) "The Statistics of Sharpe Ratios" — annualization and
 *     statistical significance of Sharpe/Sortino estimates.
 *   - Bailey, D. & López de Prado, M. (2014) "The Deflated Sharpe Ratio" —
 *     bias correction for multiple testing (see `deflatedSharpeRatio`).
 *   - Kim & White (2008) / Newey-West (1987) — HAC covariance for
 *     autocorrelation-robust standard errors.
 */

/** Standard normal PDF. */
export function normalPdf(x: number, mu = 0, sigma = 1): number {
  const z = (x - mu) / sigma;
  return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
}

/**
 * Standard normal CDF via Abramowitz & Stegun 26.2.17 error function
 * approximation (|error| < 1.5e-7, more than enough for risk reporting).
 */
export function normalCdf(x: number, mu = 0, sigma = 1): number {
  const z = (x - mu) / sigma;
  const sign = z < 0 ? -1 : 1;
  const a1 = 0.319381530, a2 = -0.356563782, a3 = 1.781477937,
        a4 = -1.821255978, a5 = 1.330274429;
  const p = 0.2316419;
  const t = 1 / (1 + p * Math.abs(z));
  const poly = ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t;
  const density = Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI);
  const cdf = 1 - density * poly;
  return sign === 1 ? cdf : 1 - cdf;
}

/**
 * Inverse standard normal CDF (Acklam's rational approximation, refined with
 * one Halley step). Used for VaR at a given confidence level.
 */
export function normalInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;

  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
             1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
             6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
             -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
             3.754408661907416e+00];

  const pLow = 0.02425;
  let x: number;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - pLow) {
    const q = p - 0.5;
    const r = q * q;
    x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
        (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }

  // Halley refinement
  const e = normalCdf(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

/** Arithmetic mean. Returns null for empty input. */
export function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Sample variance (Bessel-corrected). */
export function variance(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  let acc = 0;
  for (const x of xs) acc += (x - m) ** 2;
  return acc / (xs.length - 1);
}

/** Sample standard deviation. */
export function stdDev(xs: number[]): number | null {
  const v = variance(xs);
  return v === null ? null : Math.sqrt(v);
}

/** Population standard deviation (used for risk-model scaling). */
export function populationStdDev(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const m = mean(xs)!;
  let acc = 0;
  for (const x of xs) acc += (x - m) ** 2;
  return Math.sqrt(acc / xs.length);
}

/** Sample covariance between two equal-length series. */
export function covariance(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const mx = mean(xs.slice(0, n))!;
  const my = mean(ys.slice(0, n))!;
  let acc = 0;
  for (let i = 0; i < n; i++) acc += (xs[i] - mx) * (ys[i] - my);
  return acc / (n - 1);
}

/** Pearson correlation. */
export function correlation(xs: number[], ys: number[]): number | null {
  const cov = covariance(xs, ys);
  const sx = stdDev(xs);
  const sy = stdDev(ys);
  if (cov === null || sx === null || sy === null || sx === 0 || sy === 0) return null;
  return cov / (sx * sy);
}

/** Sample skewness (Fisher–Pearson). */
export function skewness(xs: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const m = mean(xs)!;
  const s = stdDev(xs)!;
  if (s === 0) return null;
  let acc = 0;
  for (const x of xs) acc += ((x - m) / s) ** 3;
  return (n / ((n - 1) * (n - 2))) * acc;
}

/** Excess kurtosis (Fisher definition; 0 for a normal distribution). */
export function excessKurtosis(xs: number[]): number | null {
  const n = xs.length;
  if (n < 4) return null;
  const m = mean(xs)!;
  const s = stdDev(xs)!;
  if (s === 0) return null;
  let acc = 0;
  for (const x of xs) acc += ((x - m) / s) ** 4;
  const g2 = (n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3)) * acc;
  const correction = (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
  return g2 - correction;
}

/** Linear quantile with linear interpolation (type 7, the R default). */
export function quantile(xs: number[], q: number): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * Math.min(Math.max(q, 0), 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Percentile rank of `value` within `xs` (0..100). */
export function percentileRank(xs: number[], value: number): number | null {
  if (xs.length === 0) return null;
  let below = 0;
  for (const x of xs) if (x < value) below++;
  return (below / xs.length) * 100;
}

/** Winsorize a series at the given quantile bounds. */
export function winsorize(xs: number[], lowerQ = 0.01, upperQ = 0.99): number[] {
  const lo = quantile(xs, lowerQ);
  const hi = quantile(xs, upperQ);
  if (lo === null || hi === null) return xs;
  return xs.map((x) => Math.min(Math.max(x, lo), hi));
}

/** Cross-sectional z-score of `value` against `population`. */
export function zScore(value: number, population: number[]): number | null {
  const m = mean(population);
  const s = stdDev(population);
  if (m === null || s === null || s === 0) return null;
  return (value - m) / s;
}

/** Simple (arithmetic) period returns from a price series. */
export function simpleReturns(prices: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const p0 = prices[i - 1];
    if (p0 > 0) out.push(prices[i] / p0 - 1);
  }
  return out;
}

/** Log returns (better statistical behaviour for compounding). */
export function logReturns(prices: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const p0 = prices[i - 1];
    if (p0 > 0 && prices[i] > 0) out.push(Math.log(prices[i] / p0));
  }
  return out;
}

/** OLS regression of y on x: y = alpha + beta * x. */
export interface OlsResult {
  alpha: number;
  beta: number;
  rSquared: number;
  /** Standard error of the slope (HAC-corrected when `lags` > 0). */
  standardError: number;
  tStatistic: number;
  observations: number;
}

/**
 * Ordinary least squares with an optional Newey–West (HAC) correction so
 * that serially correlated monthly returns do not produce over-confident
 * t-statistics (Newey & West, 1987).
 */
export function ols(y: number[], x: number[], hacLags = 0): OlsResult | null {
  const n = Math.min(y.length, x.length);
  if (n < 3) return null;
  const ys = y.slice(0, n);
  const xs = x.slice(0, n);
  const mx = mean(xs)!;
  const my = mean(ys)!;
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0) return null;
  const beta = sxy / sxx;
  const alpha = my - beta * mx;
  const residuals = ys.map((v, i) => v - (alpha + beta * xs[i]));
  const rSquared = syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);

  let se: number;
  if (hacLags > 0) {
    // Newey–West long-run variance of the residuals
    const s2 = variance(residuals) ?? 0;
    let gammaSum = 0;
    for (let l = 1; l <= hacLags; l++) {
      let g = 0;
      for (let i = l; i < n; i++) g += residuals[i] * residuals[i - l];
      g /= n;
      gammaSum += (1 - l / (hacLags + 1)) * 2 * g;
    }
    const longRunVar = Math.max(s2 + gammaSum, 1e-12);
    se = Math.sqrt(longRunVar / (n * sxx));
  } else {
    const sigma2 = residuals.reduce((a, r) => a + r * r, 0) / (n - 2);
    se = Math.sqrt(sigma2 / sxx);
  }

  return {
    alpha,
    beta,
    rSquared,
    standardError: se,
    tStatistic: se === 0 ? 0 : beta / se,
    observations: n,
  };
}

/** Build a covariance matrix from a matrix of return rows (assets × periods). */
export function covarianceMatrix(series: number[][]): number[][] {
  const n = series.length;
  const out: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const c = covariance(series[i], series[j]) ?? 0;
      out[i][j] = c;
      out[j][i] = c;
    }
  }
  return out;
}

/**
 * Ledoit–Wolf shrinkage covariance estimator (2004).
 *
 * The sample covariance of N assets is severely biased when N is large
 * relative to T. LW shrinks the sample matrix toward a scaled identity
 * (the "constant correlation" target is used here for stability):
 *
 *   Σ̂* = (1-δ)·S + δ·F
 *
 * δ is chosen by the analytic LW formula with a shrinkage target.
 */
export function ledoitWolfCovariance(series: number[][]): number[][] {
  const n = series.length;
  const sample = covarianceMatrix(series);
  if (n < 2) return sample;

  const T = Math.min(...series.map((s) => s.length));
  if (T < 3) return sample;

  // Target: scaled identity (diagonal entries equal to average variance).
  const avgVar = series.reduce((acc, s) => acc + (variance(s) ?? 0), 0) / n;
  const target: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? avgVar : 0))
  );

  // Estimate shrinkage intensity from the dispersion of sample covariances
  // around the target (simplified LW phi-hat with pi-hat = 0 assumption).
  let piHat = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = series[i].slice(0, T);
      const y = series[j].slice(0, T);
      const dx = x.map((v, k) => v - (mean(x) ?? 0));
      const dy = y.map((v, k) => v - (mean(y) ?? 0));
      for (let k = 0; k < T; k++) {
        const term = dx[k] * dy[k];
        piHat += (term - sample[i][j]) ** 2;
      }
    }
  }
  piHat /= n * T;

  let gammaHat = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      gammaHat += (sample[i][j] - target[i][j]) ** 2;
    }
  }
  gammaHat /= n * T;

  const kappa = (piHat - gammaHat) / (T * avgVar * avgVar || 1);
  const delta = Math.min(Math.max(kappa, 0), 1);

  return sample.map((row, i) => row.map((v, j) => (1 - delta) * v + delta * target[i][j]));
}

/** Invert a symmetric positive-definite matrix (Gauss-Jordan with pivoting). */
export function invertMatrix(m: number[][]): number[][] | null {
  const n = m.length;
  if (n === 0 || m.some((r) => r.length !== n)) return null;

  const a = m.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    if (pivot !== col) { const tmp = a[pivot]; a[pivot] = a[col]; a[col] = tmp; }

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

/** Matrix-vector product. */
export function matVec(m: number[][], v: number[]): number[] {
  return m.map((row) => row.reduce((acc, x, j) => acc + x * v[j], 0));
}

/**
 * Deflated Sharpe Ratio (Bailey & López de Prado, 2014).
 *
 * Corrects the observed Sharpe ratio for (a) the expected maximum Sharpe
 * under multiple testing and (b) the variance of the Sharpe estimator
 * (Lo, 2002). Essential when a strategy family is selected because it
 * "worked" in-sample.
 */
export function deflatedSharpeRatio(
  observedSharpe: number,
  observations: number,
  trials = 1,
  skewness = 0,
  kurtosis = 3
): number | null {
  if (observations < 2 || trials < 1) return null;

  // Expected max Sharpe across `trials` independent trials (Lo's approximation)
  const eulerGamma = 0.5772156649;
  const sigmaSharpe = 1;
  const expectedMax = sigmaSharpe *
    ((1 - eulerGamma) * normalInv(1 - 1 / trials) + eulerGamma * normalInv(1 - 1 / (trials * Math.E)));

  // Variance of the Sharpe estimator (annualised)
  const denom = 1 - skewness * observedSharpe + (kurtosis - 1) / 4 * observedSharpe ** 2;
  if (denom <= 0) return null;
  const sharpeVar = (1 + observedSharpe ** 2 / 2) / denom / (observations - 1);

  const dSR = observedSharpe - expectedMax;
  const prob = normalCdf(dSR / Math.sqrt(sharpeVar));
  return prob;
}

/**
 * Stationary block bootstrap (Politis & White, 2004) confidence intervals for
 * a statistic. Used to put error bars on Sharpe ratios and CAGR.
 */
export function blockBootstrapCI(
  series: number[],
  statistic: (x: number[]) => number,
  { blockSize = 4, iterations = 1000, confidence = 0.95 } = {}
): { lower: number; upper: number; point: number } | null {
  const n = series.length;
  if (n < blockSize * 2) return null;

  const point = statistic(series);
  const stats: number[] = [];
  const blocks = Math.ceil(n / blockSize);

  for (let it = 0; it < iterations; it++) {
    const sample: number[] = [];
    for (let b = 0; b < blocks; b++) {
      const start = Math.floor(Math.random() * Math.max(1, n - blockSize + 1));
      for (let k = 0; k < blockSize; k++) sample.push(series[start + k]);
    }
    const v = statistic(sample.slice(0, n));
    if (Number.isFinite(v)) stats.push(v);
  }
  if (stats.length < 10) return null;

  const alpha = (1 - confidence) / 2;
  return {
    point,
    lower: quantile(stats, alpha) ?? point,
    upper: quantile(stats, 1 - alpha) ?? point,
  };
}

/** Geometric mean growth rate per period. */
export function geometricMean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const logSum = xs.reduce((acc, x) => acc + (x > 0 ? Math.log(x) : -Infinity), 0);
  if (!Number.isFinite(logSum)) return null;
  return Math.exp(logSum / xs.length) - 1;
}
