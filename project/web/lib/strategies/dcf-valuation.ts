import { FinancialQuarter } from "@prisma/client";
import {
  StrategyCriterion,
  StrategyDefinition,
  StrategyParameter,
  StrategyResult,
  StrategySeriesPoint,
  resolveParam,
} from "./types";
import { div, lastQuarters, marketCapOf, num, quarterLabel, sortQuarters, totalDebtOf } from "./helpers";
import { runDcf } from "@/lib/quant/valuation";

/**
 * Discounted Cash Flow Valuation
 * ==============================
 * FCFF DCF with an explicit forecast horizon, WACC built from CAPM, and a
 * Gordon-growth terminal value (Damodaran 2012; Koller, Goedhart & Wessels
 * 2020).
 *
 *   FCFF   = EBIT × (1 − t) + D&A − CapEx − ΔNWC
 *   WACC   = E/V·Ke + D/V·Kd·(1 − t)
 *   Ke     = Rf + β·ERP + CRP
 *   EV     = Σ FCFF_t/(1+WACC)^t + TV/(1+WACC)^N
 *
 * The score reflects the *implied upside* to the intrinsic value, adjusted
 * for the sensitivity of the result: a valuation with a terminal value
 * above 80% of enterprise value is penalised because the conclusion is
 * driven mostly by the perpetuity assumption.
 *
 * References
 *   - Damodaran, A. (2012) "Investment Valuation", 3rd ed., Wiley.
 *   - Koller, T., Goedhart, M. & Wessels, D. (2020) "Valuation", 7th ed.
 */

const PARAMETERS: StrategyParameter[] = [
  { key: "forecastYears", label: "Explicit forecast horizon", type: "slider", defaultValue: 5, min: 1, max: 10, step: 1, unit: "years" },
  { key: "revenueGrowth", label: "Revenue growth (p.a.)", type: "slider", defaultValue: 6, min: -10, max: 40, step: 1, unit: "%" },
  { key: "ebitMargin", label: "Target EBIT margin", type: "slider", defaultValue: 15, min: 0, max: 60, step: 1, unit: "%" },
  { key: "taxRate", label: "Effective tax rate", type: "slider", defaultValue: 21, min: 0, max: 50, step: 1, unit: "%" },
  { key: "capexPct", label: "CapEx % of revenue", type: "slider", defaultValue: 5, min: 0, max: 25, step: 0.5, unit: "%" },
  { key: "depreciationPct", label: "D&A % of revenue", type: "slider", defaultValue: 4, min: 0, max: 25, step: 0.5, unit: "%" },
  { key: "riskFreeRate", label: "Risk-free rate", type: "slider", defaultValue: 4, min: 0, max: 15, step: 0.25, unit: "%" },
  { key: "equityRiskPremium", label: "Equity risk premium", type: "slider", defaultValue: 5, min: 0, max: 15, step: 0.25, unit: "%" },
  { key: "beta", label: "Levered beta", type: "slider", defaultValue: 1, min: 0, max: 2.5, step: 0.05, unit: "" },
  { key: "costOfDebt", label: "Pre-tax cost of debt", type: "slider", defaultValue: 6, min: 0, max: 20, step: 0.25, unit: "%" },
  { key: "debtToValue", label: "Debt / (Debt + Equity)", type: "slider", defaultValue: 20, min: 0, max: 80, step: 5, unit: "%" },
  { key: "terminalGrowth", label: "Terminal growth rate", type: "slider", defaultValue: 2.5, min: 0, max: 5, step: 0.25, unit: "%" },
  { key: "strongThreshold", label: "Strong verdict threshold (upside)", type: "slider", defaultValue: 30, min: 5, max: 100, step: 5, unit: "%" },
  { key: "moderateThreshold", label: "Moderate verdict threshold (upside)", type: "slider", defaultValue: 10, min: 0, max: 50, step: 5, unit: "%" },
];

export const dcfValuationStrategy: StrategyDefinition = {
  slug: "dcf-valuation",
  name: "Discounted Cash Flow (FCFF) Valuation",
  shortDescription:
    "Five-year FCFF DCF with CAPM-based WACC, Gordon terminal value and an implied-upside score.",
  category: "Valuation",
  icon: "Calculator",
  parameters: PARAMETERS,
  minQuartersRequired: 4,

  evaluate(quarters: FinancialQuarter[], rawParams): StrategyResult {
    const p = (i: number) => Number(resolveParam(rawParams, PARAMETERS[i]));

    const sorted = sortQuarters(quarters);
    const windowed = lastQuarters(sorted, 8);
    const latest = windowed[windowed.length - 1];
    if (!latest) {
      return {
        score: 0, maxScore: 100, rawScore: 0, verdict: "Insufficient Data", verdictColor: "amber",
        summary: "No quarterly data available.", criteria: [], series: [], generatedAt: new Date().toISOString(),
      };
    }

    // Trailing four quarters for a clean TTM base
    const ttm = lastQuarters(sorted, 4);
    const sum = (fn: (q: FinancialQuarter) => number | null): number | null => {
      const vals = ttm.map(fn).filter((v): v is number => v !== null);
      if (vals.length < ttm.length) return null;
      return vals.reduce((a, b) => a + b, 0);
    };

    const revenue = sum((q) => num(q.revenue));
    const ebit = sum((q) => num(q.operatingIncome)) ?? num(latest.operatingIncome);
    const cash = num(latest.cash);
    const debt = totalDebtOf(latest);
    const shares = num(latest.sharesOutstanding);
    const marketCap = marketCapOf(latest);
    const netDebt = (debt ?? 0) - (cash ?? 0);

    const assumptions = {
      forecastYears: p(0),
      revenueGrowth: p(1) / 100,
      ebitMargin: p(2) / 100,
      taxRate: p(3) / 100,
      capexPct: p(4) / 100,
      depreciationPct: p(5) / 100,
      riskFreeRate: p(6) / 100,
      equityRiskPremium: p(7) / 100,
      beta: p(8),
      costOfDebt: p(9) / 100,
      debtToValue: p(10) / 100,
      terminalGrowth: p(11) / 100,
      currentMarketCap: marketCap,
      netDebt,
    };

    if (revenue === null) {
      return {
        score: 0, maxScore: 100, rawScore: 0, verdict: "Insufficient Data", verdictColor: "amber",
        summary: "At least four complete quarters of revenue are required to run a DCF.",
        criteria: [], series: [], generatedAt: new Date().toISOString(),
      };
    }

    const dcf = runDcf(revenue, ebit, shares, assumptions);

    const upside = dcf.impliedUpside;
    const strongThreshold = p(12) / 100;
    const moderateThreshold = p(13) / 100;

    const score = upside === null
      ? 50
      : Math.max(0, Math.min(100, Math.round(50 + upside * 100)));

    let verdict: StrategyResult["verdict"] = "Weak";
    let verdictColor: StrategyResult["verdictColor"] = "negative";
    if (upside !== null && upside >= strongThreshold) { verdict = "Strong"; verdictColor = "positive"; }
    else if (upside !== null && upside >= moderateThreshold) { verdict = "Moderate"; verdictColor = "amber"; }

    const criteria: StrategyCriterion[] = [
      {
        key: "enterprise_value",
        label: "Enterprise Value (DCF)",
        category: "Valuation",
        pass: null,
        value: dcf.enterpriseValue,
        threshold: `WACC ${(dcf.wacc * 100).toFixed(2)}%, g ${(assumptions.terminalGrowth * 100).toFixed(2)}%`,
        weight: 0,
        explanation: "Present value of the explicit forecast plus the discounted terminal value.",
      },
      {
        key: "equity_value",
        label: "Equity Value",
        category: "Valuation",
        pass: null,
        value: dcf.equityValue,
        threshold: "Enterprise value − net debt",
        weight: 0,
        explanation: "Intrinsic equity value after deducting net debt.",
      },
      {
        key: "value_per_share",
        label: "Intrinsic Value per Share",
        category: "Valuation",
        pass: null,
        value: dcf.valuePerShare,
        threshold: marketCap !== null && shares ? `Market price ${(marketCap / shares).toFixed(2)}` : "—",
        weight: 0,
        explanation: "Equity value divided by diluted shares outstanding.",
      },
      {
        key: "implied_upside",
        label: "Implied Upside / (Downside)",
        category: "Verdict",
        pass: upside !== null ? upside > 0 : null,
        value: upside,
        threshold: `≥ ${(moderateThreshold * 100).toFixed(0)}% for a Moderate verdict`,
        weight: 0,
        explanation:
          "Model-implied upside to the current market capitalisation. A wide margin of safety is required before buying.",
      },
      {
        key: "wacc",
        label: "WACC",
        category: "Discount rate",
        pass: null,
        value: dcf.wacc,
        threshold: `Ke ${(dcf.costOfEquity * 100).toFixed(2)}% (Rf ${(assumptions.riskFreeRate * 100).toFixed(2)}% + β ${assumptions.beta} × ERP ${(assumptions.equityRiskPremium * 100).toFixed(2)}%)`,
        weight: 0,
        explanation:
          "Weighted average cost of capital. Small changes in WACC move the DCF value more than any other assumption.",
      },
      {
        key: "terminal_value_share",
        label: "Terminal Value Share of EV",
        category: "Model risk",
        pass: dcf.terminalValueShare !== null ? dcf.terminalValueShare < 0.8 : null,
        value: dcf.terminalValueShare,
        threshold: "< 80% of enterprise value",
        weight: 0,
        explanation:
          "When most of the value sits in the perpetuity, the conclusion is an assumption rather than a forecast.",
      },
    ];

    const series: StrategySeriesPoint[] = dcf.years.map((y) => ({
      label: `FY+${y.year}`,
      revenue: y.revenue,
      fcff: y.fcff,
      presentValue: y.presentValue,
    }));

    const summary =
      `Intrinsic equity value ${dcf.equityValue !== null ? (dcf.equityValue / 1e6).toFixed(0) + "M" : "n/a"}` +
      (dcf.valuePerShare !== null ? ` (${dcf.valuePerShare.toFixed(2)}/share)` : "") +
      (upside !== null ? `, implied upside ${(upside * 100).toFixed(1)}%` : "") +
      `. WACC ${(dcf.wacc * 100).toFixed(2)}%, terminal growth ${(assumptions.terminalGrowth * 100).toFixed(2)}%.` +
      (dcf.warnings.length ? ` ${dcf.warnings.join(" ")}` : "");

    return {
      score,
      maxScore: 100,
      rawScore: criteria.filter((c) => c.pass === true).length,
      verdict,
      verdictColor,
      summary,
      criteria,
      series,
      generatedAt: new Date().toISOString(),
    };
  },
};
