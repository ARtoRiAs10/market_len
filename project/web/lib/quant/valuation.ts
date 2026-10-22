/**
 * Valuation Engine
 * =================
 * Discounted cash flow (DCF) and relative-multiples valuation.
 *
 * Primary model: unlevered free cash flow to the firm (FCFF) discounted at
 * the weighted average cost of capital, with a Gordon-growth terminal value
 * — the standard institutional framework described in Damodaran's
 * "Investment Valuation" (3rd ed.) and used by every sell-side research
 * platform.
 *
 *   FCFF = EBIT × (1 − t) + D&A − CapEx − ΔNWC
 *   WACC = E/V · Ke + D/V · Kd · (1 − t)
 *   Ke   = Rf + β · ERP + (country risk premium)
 *   EV   = Σ FCFF_t / (1+WACC)^t  +  TV / (1+WACC)^N
 *   Equity value = EV − net debt
 *
 * References
 *   - Damodaran, A. (2012) "Investment Valuation: Tools and Techniques for
 *     Determining the Value of Any Asset", 3rd edition.
 *   - Koller, Goedhart & Wessels (2020) "Valuation: Measuring and Managing
 *     the Value of Companies", 7th edition (McKinsey).
 *   - DePamphilis (2018) "Business Valuation", 5th edition.
 */

export interface DcfAssumptions {
  /** Current enterprise value or market capitalisation (for implied upside). */
  currentEnterpriseValue?: number | null;
  currentMarketCap?: number | null;
  netDebt?: number | null;
  /** Number of explicit forecast years. */
  forecastYears?: number;
  /** Revenue growth per year (decimal, e.g. 0.08). */
  revenueGrowth?: number;
  /** Target EBIT margin (decimal, e.g. 0.15). */
  ebitMargin?: number;
  /** Effective tax rate (decimal, e.g. 0.21). */
  taxRate?: number;
  /** Depreciation & amortisation as % of revenue. */
  depreciationPct?: number;
  /** Capital expenditure as % of revenue. */
  capexPct?: number;
  /** Change in net working capital as % of revenue growth. */
  nwcPctOfRevenueGrowth?: number;
  /** Terminal growth rate (decimal). */
  terminalGrowth?: number;
  /** Risk-free rate (decimal). */
  riskFreeRate?: number;
  /** Equity risk premium (decimal). */
  equityRiskPremium?: number;
  /** Beta. */
  beta?: number;
  /** Pre-tax cost of debt (decimal). */
  costOfDebt?: number;
  /** Debt / (Debt + Equity) target (decimal). */
  debtToValue?: number;
  /** Country risk premium (decimal). */
  countryRiskPremium?: number;
}

export interface DcfYear {
  year: number;
  revenue: number;
  ebit: number;
  nopat: number;
  depreciation: number;
  capex: number;
  changeNwc: number;
  fcff: number;
  discountFactor: number;
  presentValue: number;
}

export interface DcfResult {
  years: DcfYear[];
  wacc: number;
  costOfEquity: number;
  afterTaxCostOfDebt: number;
  enterpriseValue: number;
  terminalValue: number;
  pvTerminalValue: number;
  equityValue: number | null;
  valuePerShare: number | null;
  sharesOutstanding: number | null;
  impliedUpside: number | null;
  /** Implied exit EV/EBITDA of the terminal value. */
  impliedExitMultiple: number | null;
  /** Value of the terminal value as a % of enterprise value (warning if > 75%). */
  terminalValueShare: number | null;
  sensitivity: {
    waccs: number[];
    terminalGrowths: number[];
    /** grid[terminalGrowthIndex][waccIndex] = enterprise value */
    grid: number[][];
  };
  warnings: string[];
}

export const DEFAULT_DCF_ASSUMPTIONS: Required<DcfAssumptions> = {
  currentEnterpriseValue: null,
  currentMarketCap: null,
  netDebt: null,
  forecastYears: 5,
  revenueGrowth: 0.06,
  ebitMargin: 0.15,
  taxRate: 0.21,
  depreciationPct: 0.04,
  capexPct: 0.05,
  nwcPctOfRevenueGrowth: 0.1,
  terminalGrowth: 0.025,
  riskFreeRate: 0.04,
  equityRiskPremium: 0.05,
  beta: 1.0,
  costOfDebt: 0.06,
  debtToValue: 0.2,
  countryRiskPremium: 0,
};

/** Cost of equity (CAPM + country risk premium). */
export function costOfEquity(a: {
  riskFreeRate: number;
  equityRiskPremium: number;
  beta: number;
  countryRiskPremium?: number;
}): number {
  return (
    a.riskFreeRate +
    a.beta * a.equityRiskPremium +
    (a.countryRiskPremium ?? 0)
  );
}

/** Weighted average cost of capital. */
export function wacc(a: {
  costOfEquity: number;
  costOfDebt: number;
  taxRate: number;
  debtToValue: number;
}): number {
  const e = 1 - a.debtToValue;
  return e * a.costOfEquity + a.debtToValue * a.costOfDebt * (1 - a.taxRate);
}

/**
 * Run an FCFF DCF.
 *
 * @param baseRevenue  last-twelve-month revenue used as the forecast base
 * @param baseEbit     last-twelve-month EBIT used to sanity-check the margin
 */
export function runDcf(
  baseRevenue: number,
  baseEbit: number | null,
  sharesOutstanding: number | null,
  assumptions: Partial<DcfAssumptions> = {}
): DcfResult {
  const a = { ...DEFAULT_DCF_ASSUMPTIONS, ...assumptions };
  const warnings: string[] = [];

  const years = Math.max(1, Math.min(10, a.forecastYears));
  const ke = costOfEquity(a);
  const w = wacc({
    costOfEquity: ke,
    costOfDebt: a.costOfDebt,
    taxRate: a.taxRate,
    debtToValue: a.debtToValue,
  });

  if (w <= a.terminalGrowth) {
    warnings.push("WACC must exceed the terminal growth rate for the Gordon model to be valid — terminal value set to zero.");
  }
  if (baseEbit !== null && baseRevenue > 0) {
    const implied = baseEbit / baseRevenue;
    if (Math.abs(implied - a.ebitMargin) > 0.08) {
      warnings.push(
        `Assumed EBIT margin (${(a.ebitMargin * 100).toFixed(1)}%) is far from the current margin (${(implied * 100).toFixed(1)}%).`
      );
    }
  }

  const rows: DcfYear[] = [];
  let revenue = baseRevenue;
  let pvExplicit = 0;

  for (let t = 1; t <= years; t++) {
    revenue *= 1 + a.revenueGrowth;
    const ebit = revenue * a.ebitMargin;
    const nopat = ebit * (1 - a.taxRate);
    const depreciation = revenue * a.depreciationPct;
    const capex = revenue * a.capexPct;
    const changeNwc = revenue * a.revenueGrowth * a.nwcPctOfRevenueGrowth;
    const fcff = nopat + depreciation - capex - changeNwc;
    const df = 1 / Math.pow(1 + w, t);
    const pv = fcff * df;
    pvExplicit += pv;
    rows.push({
      year: t,
      revenue,
      ebit,
      nopat,
      depreciation,
      capex,
      changeNwc,
      fcff,
      discountFactor: df,
      presentValue: pv,
    });
  }

  const terminalFcff = rows.length ? rows[rows.length - 1].fcff * (1 + a.terminalGrowth) : 0;
  const terminalValue = w > a.terminalGrowth
    ? terminalFcff / (w - a.terminalGrowth)
    : 0;
  const pvTerminal = terminalValue / Math.pow(1 + w, years);
  const enterpriseValue = pvExplicit + pvTerminal;

  const netDebt = a.netDebt ?? 0;
  const equityValue = enterpriseValue - netDebt;
  const valuePerShare = sharesOutstanding && sharesOutstanding > 0
    ? equityValue / sharesOutstanding
    : null;

  const currentValue = a.currentEnterpriseValue ?? a.currentMarketCap ?? null;
  const impliedUpside = currentValue && currentValue > 0
    ? equityValue / (currentValue + netDebt) - 1
    : null;

  const terminalEbit = rows.length ? rows[rows.length - 1].ebit : 0;
  const impliedExitMultiple = terminalEbit > 0 ? terminalValue / terminalEbit : null;

  const terminalShare = enterpriseValue > 0 ? pvTerminal / enterpriseValue : null;
  if (terminalShare !== null && terminalShare > 0.75) {
    warnings.push(
      `${(terminalShare * 100).toFixed(0)}% of enterprise value comes from the terminal value — extend the explicit forecast horizon.`
    );
  }

  const waccs = [-0.01, -0.005, 0, 0.005, 0.01].map((d) => w + d);
  const terminalGrowths = [-0.01, -0.005, 0, 0.005, 0.01].map((d) => a.terminalGrowth + d);

  const grid = terminalGrowths.map((g) =>
    waccs.map((wc) => {
      if (wc <= g) return 0;
      let pv = 0;
      let rev = baseRevenue;
      for (let t = 1; t <= years; t++) {
        rev *= 1 + a.revenueGrowth;
        const ebit = rev * a.ebitMargin;
        const nopat = ebit * (1 - a.taxRate);
        const fcff =
          nopat + rev * a.depreciationPct - rev * a.capexPct - rev * a.revenueGrowth * a.nwcPctOfRevenueGrowth;
        pv += fcff / Math.pow(1 + wc, t);
      }
      const tv = (rows.length ? rows[rows.length - 1].fcff : 0) * (1 + g) / (wc - g);
      return pv + tv / Math.pow(1 + wc, years);
    })
  );

  return {
    years: rows,
    wacc: w,
    costOfEquity: ke,
    afterTaxCostOfDebt: a.costOfDebt * (1 - a.taxRate),
    enterpriseValue,
    terminalValue,
    pvTerminalValue: pvTerminal,
    equityValue,
    valuePerShare,
    sharesOutstanding,
    impliedUpside,
    impliedExitMultiple,
    terminalValueShare: terminalShare,
    sensitivity: { waccs, terminalGrowths, grid },
    warnings,
  };
}

export interface RelativeMultiples {
  label: string;
  metric: string;
  companyValue: number | null;
  peerMedian: number | null;
  premium: number | null;
  interpretation: string;
}

/**
 * Relative valuation: compare the company's trading multiples with the
 * peer-group median (value = cheap, negative premium).
 */
export function relativeValuation(
  company: {
    marketCap: number | null;
    netDebt: number | null;
    revenue: number | null;
    grossProfit: number | null;
    ebitda: number | null;
    netIncome: number | null;
    equity: number | null;
    freeCashFlow: number | null;
  },
  peers: Array<{
    marketCap: number | null;
    netDebt: number | null;
    revenue: number | null;
    grossProfit: number | null;
    ebitda: number | null;
    netIncome: number | null;
    equity: number | null;
    freeCashFlow: number | null;
  }>
): RelativeMultiples[] {
  const median = (xs: number[]) => {
    const s = xs.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    if (s.length === 0) return null;
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };

  const ev = (x: { marketCap: number | null; netDebt: number | null }) =>
    x.marketCap !== null ? x.marketCap + (x.netDebt ?? 0) : null;

  const ratios = [
    {
      label: "EV / Revenue",
      metric: "Value",
      value: ev(company) !== null && company.revenue ? ev(company)! / company.revenue : null,
      peer: median(peers.map((p) => (ev(p) !== null && p.revenue ? ev(p)! / p.revenue : NaN))),
      interpretation: "Sales multiple — useful for loss-making growth companies.",
    },
    {
      label: "EV / EBITDA",
      metric: "Value",
      value: ev(company) !== null && company.ebitda ? ev(company)! / company.ebitda : null,
      peer: median(peers.map((p) => (ev(p) !== null && p.ebitda ? ev(p)! / p.ebitda : NaN))),
      interpretation: "Capital-structure-neutral operating multiple.",
    },
    {
      label: "P / E",
      metric: "Value",
      value: company.marketCap && company.netIncome ? company.marketCap / company.netIncome : null,
      peer: median(peers.map((p) => (p.marketCap && p.netIncome ? p.marketCap / p.netIncome : NaN))),
      interpretation: "Equity multiple on trailing earnings.",
    },
    {
      label: "P / Gross Profit",
      metric: "Quality-adjusted value",
      value: company.marketCap && company.grossProfit ? company.marketCap / company.grossProfit : null,
      peer: median(peers.map((p) => (p.marketCap && p.grossProfit ? p.marketCap / p.grossProfit : NaN))),
      interpretation: "Novy-Marx gross-profit multiple — strips out capital intensity.",
    },
    {
      label: "P / Book",
      metric: "Value",
      value: company.marketCap && company.equity ? company.marketCap / company.equity : null,
      peer: median(peers.map((p) => (p.marketCap && p.equity ? p.marketCap / p.equity : NaN))),
      interpretation: "Book multiple — the raw HML input.",
    },
    {
      label: "FCF Yield",
      metric: "Value",
      value: company.marketCap && company.freeCashFlow ? company.freeCashFlow / company.marketCap : null,
      peer: median(peers.map((p) => (p.marketCap && p.freeCashFlow ? p.freeCashFlow / p.marketCap : NaN))),
      interpretation: "Free cash flow per unit of market value; higher is cheaper.",
    },
  ];

  return ratios.map((r) => ({
    label: r.label,
    metric: r.metric,
    companyValue: r.value,
    peerMedian: r.peer,
    premium: r.value !== null && r.peer !== null && r.peer !== 0
      ? r.value / r.peer - 1
      : null,
    interpretation: r.interpretation,
  }));
}
