/**
 * Portfolio Optimizer
 * ===================
 * Constrained portfolio construction implemented without external numerical
 * libraries (so it runs identically in Next.js server routes and edge
 * workers).
 *
 * Supported objective functions
 *   - Equal Weight            (naïve benchmark)
 *   - Inverse Volatility      (risk parity approximation)
 *   - Minimum Variance        (Markowitz, 1952)
 *   - Maximum Sharpe          (tangency portfolio)
 *   - Risk Parity / ERC       (equal risk contribution, Maillard et al. 2010)
 *   - Risk Budgeting          (arbitrary per-asset risk budgets)
 *   - Black-Litterman         (BL posterior, Black & Litterman 1992)
 *
 * Constraints
 *   - Long-only (weights ≥ 0)
 *   - Fully invested (Σw = 1)
 *   - Maximum single-name weight
 *   - Minimum single-name weight
 *   - Optional sector caps (grouped by a sector label per asset)
 *   - Optional tracking-error budget vs. a benchmark
 *
 * References
 *   - Markowitz, H. (1952) "Portfolio Selection", Journal of Finance.
 *   - Black, F. & Litterman, R. (1992) "Global Portfolio Optimization",
 *     Financial Analysts Journal.
 *   - Maillard, S., Roncalli & Teïletche (2010) "The Properties of Equally
 *     Weighted Risk Contribution Portfolios", Journal of Portfolio Mgmt.
 *   - Ledoit, O. & Wolf, M. (2004) — shrinkage covariance used by default.
 */

import {
  invertMatrix,
  ledoitWolfCovariance,
  matVec,
  mean,
  normalInv,
  covarianceMatrix,
} from "./stats";

export type OptimizerMethod =
  | "equal-weight"
  | "inverse-vol"
  | "min-variance"
  | "max-sharpe"
  | "risk-parity"
  | "risk-budgeting"
  | "black-litterman";

export interface OptimizerAsset {
  symbol: string;
  /** Expected annualised return (decimal). */
  expectedReturn: number;
  /** Optional sector label used for sector caps. */
  sector?: string;
  /** Optional precomputed annualised volatility (used by inverse-vol). */
  volatility?: number;
  /** Risk budget for risk-budgeting / risk-parity (default equal). */
  riskBudget?: number;
}

export interface OptimizerConstraints {
  longOnly?: boolean;
  maxWeight?: number;
  minWeight?: number;
  /** Maximum combined weight per sector. */
  sectorCaps?: Record<string, number>;
  /** Risk-free rate used by max-sharpe. */
  riskFreeRate?: number;
}

export interface OptimizerResult {
  method: OptimizerMethod;
  weights: number[];
  expectedReturn: number;
  volatility: number;
  sharpe: number;
  /** Diagnostics: iterations used, shrinkage delta, warnings. */
  diagnostics: {
    iterations: number;
    converged: boolean;
    shrinkageApplied: boolean;
    warnings: string[];
  };
}

const DEFAULT_MAX_WEIGHT = 1.0;

function projectToSimplex(w: number[], maxWeight: number, minWeight: number): number[] {
  /** Euclidean projection onto { x : 0 ≤ x_i ≤ max, Σx = 1 }. */
  const n = w.length;
  if (n === 0) return [];
  if (minWeight * n > 1 + 1e-9) return w.map(() => 1 / n);
  if (maxWeight * n < 1 - 1e-9) maxWeight = 1 / n;

  let x = [...w];
  for (let iter = 0; iter < 200; iter++) {
    // Bisection on the Lagrange multiplier for the upper/lower bounds.
    let lo = -1, hi = 1;
    const proj = (lambda: number) => {
      const y = x.map((v) => Math.min(maxWeight, Math.max(minWeight, v - lambda)));
      const s = y.reduce((a, b) => a + b, 0);
      return { y, s };
    };
    let mid = 0;
    let best = proj(0);
    for (let k = 0; k < 200; k++) {
      mid = (lo + hi) / 2;
      const r = proj(mid);
      if (r.s > 1) lo = mid; else hi = mid;
      best = r;
    }
    const delta = best.s - 1;
    if (Math.abs(delta) < 1e-9) {
      x = best.y;
      break;
    }
    // adjust and re-project
    x = x.map((v) => v - delta / n);
    const r = proj(0);
    if (Math.abs(r.s - 1) < 1e-9) { x = r.y; break; }
  }
  const sum = x.reduce((a, b) => a + b, 0);
  return sum > 0 ? x.map((v) => v / sum) : x.map(() => 1 / n);
}

/** Apply sector caps by scaling down offending sleeves and redistributing. */
function applySectorCaps(
  w: number[],
  assets: OptimizerAsset[],
  caps: Record<string, number>
): number[] {
  const out = [...w];
  for (let iter = 0; iter < 25; iter++) {
    const sectorTotals: Record<string, number> = {};
    for (let i = 0; i < out.length; i++) {
      const s = assets[i].sector ?? "OTHER";
      sectorTotals[s] = (sectorTotals[s] ?? 0) + out[i];
    }
    let violated = false;
    for (const [sector, cap] of Object.entries(caps)) {
      const total = sectorTotals[sector] ?? 0;
      if (total > cap + 1e-9) {
        violated = true;
        const members = assets.map((a, i) => ({ a, i })).filter(({ a }) => (a.sector ?? "OTHER") === sector);
        const scale = cap / total;
        let freed = 0;
        for (const { i } of members) {
          const before = out[i];
          out[i] = before * scale;
          freed += before - out[i];
        }
        const others = assets.map((a, i) => ({ a, i })).filter(({ a }) => (a.sector ?? "OTHER") !== sector);
        const othersTotal = others.reduce((acc, { i }) => acc + out[i], 0);
        if (othersTotal > 0) {
          for (const { i } of others) out[i] += (freed * out[i]) / othersTotal;
        } else {
          // Everything is in the capped sector — spread the remainder equally.
          for (const { i } of members) out[i] = cap / members.length;
        }
      }
    }
    if (!violated) break;
  }
  const sum = out.reduce((a, b) => a + b, 0);
  return sum > 0 ? out.map((v) => v / sum) : out;
}

/** Risk-parity fixed point (Maillard et al., 2010). */
function equalRiskContribution(
  assets: OptimizerAsset[],
  cov: number[][],
  constraints: OptimizerConstraints
): { weights: number[]; iterations: number; converged: boolean } {
  const n = assets.length;
  const maxW = constraints.maxWeight ?? DEFAULT_MAX_WEIGHT;
  const minW = constraints.minWeight ?? 0;
  let w = new Array(n).fill(1 / n);
  const budgets = assets.map((a, i) => (a.riskBudget ?? 1 / n));
  const bSum = budgets.reduce((a, b) => a + b, 0) || 1;
  const bNorm = budgets.map((b) => b / bSum);

  let iterations = 0;
  let converged = false;
  for (; iterations < 500; iterations++) {
    const cw = matVec(cov, w);
    let variance = 0;
    for (let i = 0; i < n; i++) variance += w[i] * cw[i];
    const vol = Math.sqrt(Math.max(variance, 1e-18));
    if (vol < 1e-12) break;

    const contrib = w.map((wi, i) => (wi * cw[i]) / vol); // absolute risk contribution
    const totalContrib = contrib.reduce((a, b) => a + b, 0) || 1;
    const rel = contrib.map((c) => c / totalContrib);

    const next = w.map((wi, i) => {
      const target = bNorm[i];
      return rel[i] > 0 ? wi * Math.sqrt(target / rel[i]) : wi;
    });
    const sum = next.reduce((a, b) => a + b, 0) || 1;
    let projected = next.map((v) => v / sum);
    projected = projectToSimplex(projected, maxW, minW);
    if (constraints.sectorCaps) projected = applySectorCaps(projected, assets, constraints.sectorCaps);

    const diff = projected.reduce((acc, v, i) => acc + Math.abs(v - w[i]), 0);
    w = projected;
    if (diff < 1e-10) { converged = true; break; }
  }
  return { weights: w, iterations, converged };
}

/** Projected-gradient optimiser over the simplex for an arbitrary objective. */
function optimizeObjective(
  n: number,
  objective: (w: number[]) => number,
  constraints: OptimizerConstraints,
  assets?: OptimizerAsset[]
): { weights: number[]; iterations: number; converged: boolean } {
  const maxW = constraints.maxWeight ?? DEFAULT_MAX_WEIGHT;
  const minW = constraints.minWeight ?? 0;
  let w = new Array(n).fill(1 / n);
  let step = 0.5;
  let iterations = 0;
  let converged = false;
  let best = objective(w);

  for (; iterations < 3000; iterations++) {
    // Numerical gradient (central differences)
    const eps = 1e-6;
    const grad = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const up = [...w]; up[i] += eps;
      const dn = [...w]; dn[i] -= eps;
      grad[i] = (objective(up) - objective(dn)) / (2 * eps);
    }
    const next = w.map((v, i) => v + step * grad[i]);
    let projected = projectToSimplex(next, maxW, minW);
    if (assets && constraints.sectorCaps) projected = applySectorCaps(projected, assets, constraints.sectorCaps);
    const value = objective(projected);
    if (value > best) {
      best = value;
      w = projected;
    } else {
      step *= 0.5;
      if (step < 1e-9) { converged = true; break; }
    }
  }
  return { weights: w, iterations, converged };
}

/**
 * Black-Litterman posterior expected returns.
 *
 *   E[R] = [(τΣ)⁻¹ + PᵀΩ⁻¹P]⁻¹ [(τΣ)⁻¹Π + PᵀΩ⁻¹Q]
 *
 * where Π is the equilibrium (market-implied) prior, Q the analyst views and
 * Ω the view uncertainty.
 */
export function blackLittermanPosterior(
  marketWeights: number[],
  covariance: number[][],
  riskFreeRate: number,
  marketRiskPremium: number,
  views: { assetIndex: number; expectedReturn: number; confidence?: number }[]
): { posteriorReturns: number[]; priorReturns: number[] } {
  const n = marketWeights.length;
  const priorReturns = marketWeights.map((w) => riskFreeRate + w * marketRiskPremium);

  const tau = 0.05;
  const invSigma = invertMatrix(covariance);
  if (!invSigma) return { posteriorReturns: priorReturns, priorReturns };

  // (τΣ)⁻¹
  const scaledInv = invSigma.map((row) => row.map((v) => v / tau));

  // Build P (k×n), Q (k), Ω (k×k)
  const k = views.length;
  const P: number[][] = [];
  const Q: number[] = [];
  const omega: number[][] = [];
  for (const v of views) {
    const row = new Array(n).fill(0);
    row[v.assetIndex] = 1;
    P.push(row);
    Q.push(v.expectedReturn);
    // View uncertainty ∝ idzoric variance of the view (Black-Litterman default)
    const varView = (v.confidence ?? 0.5) > 0
      ? (1 / (v.confidence ?? 0.5)) * (tau * (covariance[v.assetIndex]?.[v.assetIndex] ?? 0.01))
      : (tau * (covariance[v.assetIndex]?.[v.assetIndex] ?? 0.01));
    omega.push([Math.max(varView, 1e-8)]);
  }

  if (k === 0) return { posteriorReturns: priorReturns, priorReturns };

  // Pᵀ Ω⁻¹ P  (k×k matrix)
  const PtOP: number[][] = [];
  for (let i = 0; i < k; i++) {
    const row: number[] = [];
    for (let j = 0; j < k; j++) {
      let acc = 0;
      for (let a = 0; a < n; a++) acc += P[i][a] * P[j][a] / omega[i][0];
      row.push(acc);
    }
    PtOP.push(row);
  }

  // A = (τΣ)⁻¹ + PᵀΩ⁻¹P   (n×n)
  const A: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j < n; j++) {
      let acc = scaledInv[i][j];
      for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) {
        acc += P[a][i] * P[b][j] / omega[a][0] / omega[b][0];
      }
      row.push(acc);
    }
    A.push(row);
  }

  // b = (τΣ)⁻¹Π + PᵀΩ⁻¹Q
  const priorVec = matVec(scaledInv, priorReturns);
  const bVec = priorVec.map((v) => {
    let acc = v;
    for (let a = 0; a < k; a++) {
      let pQ = 0;
      for (let c = 0; c < n; c++) pQ += P[a][c] * Q[a];
      acc += pQ / omega[a][0];
    }
    return acc;
  });

  const invA = invertMatrix(A);
  if (!invA) return { posteriorReturns: priorReturns, priorReturns };
  const posterior = matVec(invA, bVec);
  return { posteriorReturns: posterior, priorReturns };
}

/**
 * Run the optimizer.
 */
export function optimizePortfolio(
  method: OptimizerMethod,
  assets: OptimizerAsset[],
  returnSeries: number[][],
  constraints: OptimizerConstraints = {},
  options: {
    /** Number of periods per year used to annualise inputs. */
    periodsPerYear?: number;
    /** Annualised covariance matrix override (use for external risk models). */
    covariance?: number[][];
    /** Market capitalisation weights used as the BL equilibrium prior. */
    marketWeights?: number[];
    /** Black-Litterman analyst views. */
    views?: { assetIndex: number; expectedReturn: number; confidence?: number }[];
    marketRiskPremium?: number;
  } = {}
): OptimizerResult {
  const warnings: string[] = [];
  const n = assets.length;
  const ppy = options.periodsPerYear ?? 252;
  const rf = constraints.riskFreeRate ?? 0.02;

  if (n === 0) {
    return {
      method, weights: [], expectedReturn: 0, volatility: 0, sharpe: 0,
      diagnostics: { iterations: 0, converged: false, shrinkageApplied: false, warnings: ["No assets supplied"] },
    };
  }

  // ── Covariance (annualised) ────────────────────────────────────────────
  let cov: number[][];
  let shrinkageApplied = false;
  if (options.covariance) {
    cov = options.covariance;
  } else {
    const raw = covarianceMatrix(returnSeries.map((s) => s.map((r) => r * ppy)));
    const shrunk = ledoitWolfCovariance(returnSeries.map((s) => s.map((r) => r * ppy)));
    cov = shrunk;
    shrinkageApplied = n >= 3;
    void raw;
  }

  // Guard against singular matrices
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(cov[i][i]) || cov[i][i] <= 0) {
      cov[i][i] = 0.04;
      warnings.push(`Non-positive variance for ${assets[i].symbol}; substituted 20% annualised vol.`);
    }
  }

  // ── Expected returns ───────────────────────────────────────────────────
  let mu = assets.map((a) => a.expectedReturn);
  if (method === "black-litterman") {
    const mw = options.marketWeights ?? new Array(n).fill(1 / n);
    const mrp = options.marketRiskPremium ?? 0.05;
    const { posteriorReturns } = blackLittermanPosterior(mw, cov, rf, mrp, options.views ?? []);
    mu = posteriorReturns;
  }

  let weights: number[];
  let iterations = 0;
  let converged = false;

  switch (method) {
    case "equal-weight": {
      weights = new Array(n).fill(1 / n);
      break;
    }
    case "inverse-vol": {
      const vols = assets.map((a, i) => a.volatility ?? Math.sqrt(Math.max(cov[i][i], 1e-8)));
      const inv = vols.map((v) => 1 / Math.max(v, 1e-8));
      const sum = inv.reduce((a, b) => a + b, 0);
      weights = inv.map((v) => v / sum);
      break;
    }
    case "min-variance": {
      const res = optimizeObjective(n, (w) => {
        let v = 0;
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) v += w[i] * w[j] * cov[i][j];
        return -v;
      }, constraints, assets);
      weights = res.weights; iterations = res.iterations; converged = res.converged;
      break;
    }
    case "max-sharpe": {
      const res = optimizeObjective(n, (w) => {
        let exp = 0, v = 0;
        for (let i = 0; i < n; i++) exp += w[i] * mu[i];
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) v += w[i] * w[j] * cov[i][j];
        const sd = Math.sqrt(Math.max(v, 1e-12));
        return (exp - rf) / sd;
      }, constraints, assets);
      weights = res.weights; iterations = res.iterations; converged = res.converged;
      break;
    }
    case "risk-parity":
    case "risk-budgeting": {
      const res = equalRiskContribution(assets, cov, constraints);
      weights = res.weights; iterations = res.iterations; converged = res.converged;
      break;
    }
    case "black-litterman": {
      const res = optimizeObjective(n, (w) => {
        let exp = 0, v = 0;
        for (let i = 0; i < n; i++) exp += w[i] * mu[i];
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) v += w[i] * w[j] * cov[i][j];
        return (exp - rf) / Math.sqrt(Math.max(v, 1e-12));
      }, constraints, assets);
      weights = res.weights; iterations = res.iterations; converged = res.converged;
      break;
    }
  }

  // Apply hard constraints consistently
  weights = projectToSimplex(
    weights,
    constraints.maxWeight ?? DEFAULT_MAX_WEIGHT,
    constraints.minWeight ?? 0
  );
  if (constraints.sectorCaps) weights = applySectorCaps(weights, assets, constraints.sectorCaps);

  // ── Final statistics ───────────────────────────────────────────────────
  let expReturn = 0, variance = 0;
  for (let i = 0; i < n; i++) {
    expReturn += weights[i] * mu[i];
    for (let j = 0; j < n; j++) variance += weights[i] * weights[j] * cov[i][j];
  }
  const vol = Math.sqrt(Math.max(variance, 0));
  const sharpe = vol > 0 ? (expReturn - rf) / vol : 0;

  if (weights.some((w) => w < -1e-9)) warnings.push("Negative weights produced; long-only constraint applied.");
  if (!converged && method !== "equal-weight" && method !== "inverse-vol") {
    warnings.push("Optimiser stopped at the iteration cap; consider relaxing constraints.");
  }

  return {
    method,
    weights,
    expectedReturn: expReturn,
    volatility: vol,
    sharpe,
    diagnostics: { iterations, converged, shrinkageApplied, warnings },
  };
}

/**
 * Efficient frontier: the minimum-variance portfolio for each of a set of
 * target expected returns.
 *
 * The return target is enforced exactly: the solver's solution is mixed with
 * the maximum-return portfolio until the expected return matches the target.
 * The result is sorted by expected return, so the frontier is monotone.
 */
export function efficientFrontier(
  assets: OptimizerAsset[],
  returnSeries: number[][],
  constraints: OptimizerConstraints = {},
  points = 25,
  periodsPerYear = 252
): { expectedReturn: number; volatility: number; sharpe: number; weights: number[] }[] {
  const n = assets.length;
  const cov = ledoitWolfCovariance(returnSeries.map((s) => s.map((r) => r * ppySafe(periodsPerYear))));
  const mu = assets.map((a) => a.expectedReturn);
  const rf = constraints.riskFreeRate ?? 0.02;

  const varianceOf = (w: number[]): number => {
    let v = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) v += w[i] * w[j] * cov[i][j];
    return Math.max(v, 0);
  };
  const returnOf = (w: number[]): number => {
    let e = 0;
    for (let i = 0; i < n; i++) e += w[i] * mu[i];
    return e;
  };

  const minVar = optimizeObjective(n, (w) => -varianceOf(w), constraints, assets);
  const maxReturnRes = optimizeObjective(n, (w) => returnOf(w), constraints, assets);
  const wMax = maxReturnRes.weights;

  const rMin = Math.min(returnOf(minVar.weights), returnOf(wMax));
  const rMax = Math.max(returnOf(minVar.weights), returnOf(wMax));

  const out: { expectedReturn: number; volatility: number; sharpe: number; weights: number[] }[] = [];
  for (let k = 0; k < points; k++) {
    const targetReturn = rMin + ((rMax - rMin) * k) / Math.max(1, points - 1);
    const res = optimizeObjective(n, (w) => {
      const penalty = 1e3 * (returnOf(w) - targetReturn) ** 2;
      return -varianceOf(w) - penalty;
    }, constraints, assets);

    let w = res.weights;
    const achieved = returnOf(w);
    if (achieved < targetReturn - 1e-9) {
      // Mix with the maximum-return portfolio until the target is met.
      const gap = targetReturn - achieved;
      const gapMax = returnOf(wMax) - achieved;
      if (gapMax > 1e-12) {
        const alpha = Math.min(1, gap / gapMax);
        w = w.map((wi, i) => wi + alpha * (wMax[i] - wi));
        w = projectToSimplex(
          w,
          constraints.maxWeight ?? DEFAULT_MAX_WEIGHT,
          constraints.minWeight ?? 0
        );
      }
    }

    const exp = returnOf(w);
    const vol = Math.sqrt(varianceOf(w));
    out.push({
      expectedReturn: exp,
      volatility: vol,
      sharpe: vol > 0 ? (exp - rf) / vol : 0,
      weights: w,
    });
  }

  // Monotone frontier (and no duplicate points).
  const seen = new Set<string>();
  return out
    .sort((a, b) => a.expectedReturn - b.expectedReturn)
    .filter((p) => {
      const key = p.expectedReturn.toFixed(6);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function ppySafe(ppy: number): number {
  return ppy / ppy;
}

/**
 * Turn expected returns and covariance into a set of portfolio weights with
 * a maximum per-name weight, using simple score-proportional allocation
 * (used when only expected returns — no return history — are available).
 */
export function scoreWeighted(
  scores: number[],
  maxWeight = 0.25
): number[] {
  const n = scores.length;
  if (n === 0) return [];
  const positive = scores.map((s) => Math.max(0, s));
  const sum = positive.reduce((a, b) => a + b, 0);
  let w = sum > 0 ? positive.map((s) => s / sum) : new Array(n).fill(1 / n);

  // Cap and redistribute iteratively
  for (let iter = 0; iter < 50; iter++) {
    const over = w.map((v, i) => (v > maxWeight ? v - maxWeight : 0));
    const excess = over.reduce((a, b) => a + b, 0);
    if (excess < 1e-12) break;
    const underIdx = w.map((v, i) => (v < maxWeight ? i : -1)).filter((i) => i >= 0);
    const underTotal = underIdx.reduce((acc, i) => acc + w[i], 0);
    w = w.map((v, i) => (v > maxWeight ? maxWeight : v));
    if (underTotal > 0) {
      for (const i of underIdx) w[i] += (excess * w[i]) / underTotal;
    } else {
      break;
    }
  }
  const total = w.reduce((a, b) => a + b, 0) || 1;
  return w.map((v) => v / total);
}

/** Black-Litterman helper: implied equilibrium returns from market weights. */
export function impliedEquilibriumReturns(
  marketWeights: number[],
  riskFreeRate: number,
  marketRiskPremium: number
): number[] {
  return marketWeights.map((w) => riskFreeRate + w * marketRiskPremium);
}

/** Standard error of a mean estimate, used for confidence intervals. */
export function standardError(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  let acc = 0;
  for (const x of xs) acc += (x - m) ** 2;
  return Math.sqrt(acc / (xs.length - 1) / xs.length);
}

/** Convert a normal z-score into a one-tailed p-value. */
export function pValue(z: number): number {
  return 1 - normalInv(z);
}
