/**
 * Performance Attribution
 * =======================
 * Brinson-Fachler (1990) relative-to-benchmark attribution, plus
 * Carino-style smoothing that reconciles the arithmetic attribution with the
 * geometric total active return.
 *
 * References
 *   - Brinson, G., Hood, L. & Beebower, G. (1990) "Determinants of Portfolio
 *     Performance", Financial Analysts Journal.
 *   - Brinson, G. & Fachler, J. (1990) "Attribution Performance".
 *   - Carino, M. (1999) "On the Determinacy of the Carino Interpolation
 *     Formula", Journal of Portfolio Management.
 */

export interface AttributionInput {
  /** Asset / sleeve identifiers. */
  names: string[];
  /** Portfolio weights per period (periods × assets). */
  portfolioWeights: number[][];
  /** Benchmark weights per period (periods × assets). */
  benchmarkWeights: number[][];
  /** Portfolio returns per period (periods × assets). */
  portfolioReturns: number[][];
  /** Benchmark returns per period (periods × assets). */
  benchmarkReturns: number[][];
  /** Optional period labels for reporting. */
  labels?: string[];
}

export interface AttributionRow {
  name: string;
  /** Average portfolio weight. */
  portfolioWeight: number;
  /** Average benchmark weight. */
  benchmarkWeight: number;
  /** Allocation effect (Brinson-Fachler). */
  allocation: number;
  /** Selection effect. */
  selection: number;
  /** Interaction effect. */
  interaction: number;
  /** Total contribution to active return. */
  total: number;
}

export interface AttributionResult {
  rows: AttributionRow[];
  totals: {
    allocation: number;
    selection: number;
    interaction: number;
    activeReturn: number;
    /** Benchmark total return (geometric). */
    benchmarkReturn: number;
    /** Portfolio total return (geometric). */
    portfolioReturn: number;
  };
  /** Carino linking coefficient between arithmetic and geometric active return. */
  linkingCoefficient: number;
}

/**
 * Compute multi-period Brinson-Fachler attribution.
 *
 * Single-period effects for asset i:
 *   Allocation   = (w_p,i − w_b,i) × (R_b,i − R_b,total)
 *   Selection    = w_b,i × (R_p,i − R_b,i)
 *   Interaction = (w_p,i − w_b,i) × (R_p,i − R_b,i)
 *
 * Multi-period results are linked with the Carino smoothing coefficient so
 * that the sum of the effects equals the geometric active return.
 */
export function brinsonAttribution(input: AttributionInput): AttributionResult {
  const { names, portfolioWeights, benchmarkWeights, portfolioReturns, benchmarkReturns } = input;
  const periods = Math.min(
    portfolioWeights.length,
    benchmarkWeights.length,
    portfolioReturns.length,
    benchmarkReturns.length
  );
  const n = names.length;

  const rows: AttributionRow[] = names.map((name) => ({
    name,
    portfolioWeight: 0,
    benchmarkWeight: 0,
    allocation: 0,
    selection: 0,
    interaction: 0,
    total: 0,
  }));

  let totalActive = 0;
  let portfolioGrowth = 1;
  let benchmarkGrowth = 1;
  const periodActive: number[] = [];

  for (let t = 0; t < periods; t++) {
    const wp = portfolioWeights[t] ?? [];
    const wb = benchmarkWeights[t] ?? [];
    const rp = portfolioReturns[t] ?? [];
    const rb = benchmarkReturns[t] ?? [];

    let pTotal = 0, bTotal = 0;
    for (let i = 0; i < n; i++) {
      pTotal += (wp[i] ?? 0) * (rp[i] ?? 0);
      bTotal += (wb[i] ?? 0) * (rb[i] ?? 0);
    }

    for (let i = 0; i < n; i++) {
      const allocation = ((wp[i] ?? 0) - (wb[i] ?? 0)) * ((rb[i] ?? 0) - bTotal);
      const selection = (wb[i] ?? 0) * ((rp[i] ?? 0) - (rb[i] ?? 0));
      const interaction = ((wp[i] ?? 0) - (wb[i] ?? 0)) * ((rp[i] ?? 0) - (rb[i] ?? 0));
      rows[i].allocation += allocation;
      rows[i].selection += selection;
      rows[i].interaction += interaction;
      rows[i].portfolioWeight += (wp[i] ?? 0) / periods;
      rows[i].benchmarkWeight += (wb[i] ?? 0) / periods;
    }

    const active = pTotal - bTotal;
    periodActive.push(active);
    totalActive += active;
    portfolioGrowth *= 1 + pTotal;
    benchmarkGrowth *= 1 + bTotal;
  }

  const arithmeticActive = periodActive.reduce((a, b) => a + b, 0);
  const geometricActive = portfolioGrowth - benchmarkGrowth;

  // Carino linking coefficient
  let num = 0, den = 0;
  for (let t = 0; t < periods; t++) {
    const pct = portfolioGrowth > 0
      ? (Math.log(1 + (portfolioReturns[t] ?? []).reduce((a, _r, i) => a + (portfolioWeights[t][i] ?? 0) * (portfolioReturns[t][i] ?? 0), 0)) -
          Math.log(1 + (benchmarkReturns[t] ?? []).reduce((a, _r, i) => a + (benchmarkWeights[t][i] ?? 0) * (benchmarkReturns[t][i] ?? 0), 0)))
      : 0;
    num += periodActive[t] * pct;
    den += pct;
  }
  const k = Math.abs(den) > 1e-12 ? num / den : 1;
  const scale = Math.abs(arithmeticActive) > 1e-12 ? geometricActive / arithmeticActive : 1;
  const link = Math.abs(k) > 1e-12 ? scale / k : scale;

  for (const row of rows) {
    row.allocation *= link;
    row.selection *= link;
    row.interaction *= link;
    row.total = row.allocation + row.selection + row.interaction;
  }

  return {
    rows,
    totals: {
      allocation: rows.reduce((a, r) => a + r.allocation, 0),
      selection: rows.reduce((a, r) => a + r.selection, 0),
      interaction: rows.reduce((a, r) => a + r.interaction, 0),
      activeReturn: geometricActive,
      benchmarkReturn: benchmarkGrowth - 1,
      portfolioReturn: portfolioGrowth - 1,
    },
    linkingCoefficient: link,
  };
}
