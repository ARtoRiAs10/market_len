import { FinancialQuarter } from "@prisma/client";
import {
  StrategyCriterion,
  StrategyDefinition,
  StrategyParameter,
  StrategyResult,
  StrategySeriesPoint,
  resolveParam,
  toNum,
} from "./types";

/**
 * Piotroski F-Score + DuPont Quality Screen
 * ==========================================
 * A fundamental quality screen combining two methodologies widely used by
 * equity research and audit/advisory analysts (in the spirit of Big-4 /
 * institutional fundamental review):
 *
 *  1. Piotroski F-Score (Joseph Piotroski, 2000) - 9 binary tests across
 *     profitability, leverage/liquidity, and operating efficiency, scored
 *     0-9. Originally annual; here adapted to trailing-quarter comparisons
 *     (current quarter vs. same quarter prior year) so it works on
 *     quarterly fundamentals.
 *
 *  2. DuPont 3-step ROE decomposition - Net Margin x Asset Turnover x
 *     Equity Multiplier - surfaced as supporting context/criteria so users
 *     can see *why* profitability is improving or deteriorating (margin
 *     expansion vs. leverage vs. efficiency), which is exactly the kind of
 *     driver analysis a Big 4 due-diligence or credit-quality memo would
 *     include.
 *
 * All thresholds are exposed as configurable parameters.
 */

const PARAMETERS: StrategyParameter[] = [
  {
    key: "lookbackQuarters",
    label: "Lookback window",
    description: "Number of trailing quarters to include in the trend chart and score.",
    type: "slider",
    defaultValue: 8,
    min: 4,
    max: 20,
    step: 1,
    unit: "quarters",
  },
  {
    key: "yoyCompareOffset",
    label: "Year-over-year comparison offset",
    description: "Quarters back to use as the prior-period baseline (4 = same quarter last year).",
    type: "select",
    defaultValue: "4",
    options: [
      { label: "Prior quarter (QoQ)", value: "1" },
      { label: "Same quarter last year (YoY)", value: "4" },
    ],
  },
  {
    key: "minCurrentRatio",
    label: "Minimum acceptable current ratio",
    description: "Used as a floor check alongside the YoY liquidity-improvement test.",
    type: "number",
    defaultValue: 1.0,
    min: 0,
    max: 5,
    step: 0.1,
    unit: "x",
  },
  {
    key: "marginWeight",
    label: "Profitability weight",
    description: "Relative weight given to the 4 profitability F-Score tests.",
    type: "slider",
    defaultValue: 40,
    min: 0,
    max: 100,
    step: 5,
    unit: "%",
  },
  {
    key: "leverageWeight",
    label: "Leverage / liquidity weight",
    description: "Relative weight given to the 3 leverage & liquidity F-Score tests.",
    type: "slider",
    defaultValue: 30,
    min: 0,
    max: 100,
    step: 5,
    unit: "%",
  },
  {
    key: "efficiencyWeight",
    label: "Operating efficiency weight",
    description: "Relative weight given to the 2 efficiency F-Score tests.",
    type: "slider",
    defaultValue: 30,
    min: 0,
    max: 100,
    step: 5,
    unit: "%",
  },
  {
    key: "strongThreshold",
    label: "Strong verdict threshold",
    description: "Minimum normalized score (0-100) required for a Strong verdict.",
    type: "slider",
    defaultValue: 70,
    min: 50,
    max: 95,
    step: 5,
    unit: "/100",
  },
  {
    key: "moderateThreshold",
    label: "Moderate verdict threshold",
    description: "Minimum normalized score (0-100) required for a Moderate verdict.",
    type: "slider",
    defaultValue: 45,
    min: 20,
    max: 69,
    step: 5,
    unit: "/100",
  },
];

export const piotroskiDupontStrategy: StrategyDefinition = {
  slug: "piotroski-fscore-dupont",
  name: "Piotroski F-Score + DuPont Quality Screen",
  shortDescription:
    "9-point fundamental quality screen (profitability, leverage, efficiency) layered with DuPont ROE decomposition.",
  category: "Fundamental Quality",
  icon: "ClipboardCheck",
  parameters: PARAMETERS,
  minQuartersRequired: 5,

  evaluate(quarters: FinancialQuarter[], rawParams): StrategyResult {
    const lookback = Number(resolveParam(rawParams, PARAMETERS[0]));
    const offset = Number(resolveParam(rawParams, PARAMETERS[1]));
    const minCurrentRatio = Number(resolveParam(rawParams, PARAMETERS[2]));
    const wMargin = Number(resolveParam(rawParams, PARAMETERS[3]));
    const wLeverage = Number(resolveParam(rawParams, PARAMETERS[4]));
    const wEfficiency = Number(resolveParam(rawParams, PARAMETERS[5]));
    const strongThreshold = Number(resolveParam(rawParams, PARAMETERS[6]));
    const moderateThreshold = Number(resolveParam(rawParams, PARAMETERS[7]));

    const sorted = [...quarters].sort(
      (a, b) => a.fiscalYear - b.fiscalYear || a.fiscalQuarter - b.fiscalQuarter
    );

    const windowed = sorted.slice(-lookback);
    const latest = windowed[windowed.length - 1];
    const baseline = windowed[windowed.length - 1 - offset];

    if (!latest || !baseline) {
      return {
        score: 0,
        maxScore: 100,
        rawScore: 0,
        verdict: "Insufficient Data",
        verdictColor: "amber",
        summary:
          "Not enough quarterly history is available to run a year-over-year comparison. Add more quarters via the ETL pipeline or choose a smaller comparison offset.",
        criteria: [],
        series: buildSeries(windowed),
        generatedAt: new Date().toISOString(),
      };
    }

    const n = (v: unknown) => toNum(v);

    const m = (q: FinancialQuarter) => {
      const revenue = n(q.revenue);
      const netIncome = n(q.netIncome);
      const totalAssets = n(q.totalAssets);
      const totalLiabilities = n(q.totalLiabilities);
      const totalEquity = n(q.totalEquity);
      const currentAssets = n(q.currentAssets);
      const currentLiabilities = n(q.currentLiabilities);
      const operatingCashFlow = n(q.operatingCashFlow);
      const longTermDebt = n(q.longTermDebt);
      const grossProfit = n(q.grossProfit);
      const sharesOutstanding = n(q.sharesOutstanding);

      const netMargin = revenue && netIncome !== null ? netIncome / revenue : null;
      const roa = totalAssets && netIncome !== null ? netIncome / totalAssets : null;
      const roe = totalEquity && netIncome !== null ? netIncome / totalEquity : null;
      const currentRatio =
        currentLiabilities && currentAssets !== null ? currentAssets / currentLiabilities : null;
      const leverage = totalAssets && longTermDebt !== null ? longTermDebt / totalAssets : null;
      const grossMargin = revenue && grossProfit !== null ? grossProfit / revenue : null;
      const assetTurnover = totalAssets && revenue !== null ? revenue / totalAssets : null;
      const equityMultiplier = totalEquity && totalAssets !== null ? totalAssets / totalEquity : null;

      return {
        revenue, netIncome, totalAssets, totalLiabilities, totalEquity,
        currentAssets, currentLiabilities, operatingCashFlow, longTermDebt,
        grossProfit, sharesOutstanding, netMargin, roa, roe, currentRatio,
        leverage, grossMargin, assetTurnover, equityMultiplier,
      };
    };

    const L = m(latest);
    const B = m(baseline);

    const criteria: StrategyCriterion[] = [];

    criteria.push({
      key: "positive_roa",
      label: "Positive Return on Assets",
      category: "Profitability",
      pass: L.roa !== null ? L.roa > 0 : null,
      value: L.roa,
      threshold: "ROA > 0",
      weight: 1,
      explanation: "Net income divided by total assets is positive for the latest period.",
    });

    criteria.push({
      key: "positive_ocf",
      label: "Positive Operating Cash Flow",
      category: "Profitability",
      pass: L.operatingCashFlow !== null ? L.operatingCashFlow > 0 : null,
      value: L.operatingCashFlow,
      threshold: "OCF > 0",
      weight: 1,
      explanation: "Cash generated from core operations is positive, indicating earnings are cash-backed.",
    });

    const roaDelta = L.roa !== null && B.roa !== null ? L.roa - B.roa : null;
    criteria.push({
      key: "improving_roa",
      label: "Improving Return on Assets",
      category: "Profitability",
      pass: roaDelta !== null ? roaDelta > 0 : null,
      value: roaDelta,
      threshold: "Delta ROA > 0 vs. comparison period",
      weight: 1,
      explanation: "ROA in the latest period exceeds the comparison period, signaling improving asset profitability.",
    });

    const accrual =
      L.operatingCashFlow !== null && L.roa !== null && L.totalAssets
        ? L.operatingCashFlow / L.totalAssets - L.roa
        : null;
    criteria.push({
      key: "quality_of_earnings",
      label: "Quality of Earnings (Cash Flow > Net Income)",
      category: "Profitability",
      pass: accrual !== null ? accrual > 0 : null,
      value: accrual,
      threshold: "OCF/Assets > ROA",
      weight: 1,
      explanation:
        "Operating cash flow exceeds net income relative to assets - earnings are not being inflated by accruals.",
    });

    const leverageDelta = L.leverage !== null && B.leverage !== null ? L.leverage - B.leverage : null;
    criteria.push({
      key: "decreasing_leverage",
      label: "Decreasing Long-Term Leverage",
      category: "Leverage & Liquidity",
      pass: leverageDelta !== null ? leverageDelta < 0 : null,
      value: leverageDelta,
      threshold: "Delta (LT Debt / Assets) < 0",
      weight: 1,
      explanation: "Long-term debt as a share of total assets has decreased, reducing financial risk.",
    });

    const currentRatioDelta =
      L.currentRatio !== null && B.currentRatio !== null ? L.currentRatio - B.currentRatio : null;
    criteria.push({
      key: "improving_liquidity",
      label: "Improving Liquidity",
      category: "Leverage & Liquidity",
      pass:
        currentRatioDelta !== null && L.currentRatio !== null
          ? currentRatioDelta > 0 && L.currentRatio >= minCurrentRatio
          : null,
      value: L.currentRatio,
      threshold: "Delta Current Ratio > 0 and >= " + minCurrentRatio.toFixed(1) + "x",
      weight: 1,
      explanation: "The current ratio has improved and clears the minimum acceptable liquidity floor.",
    });

    const sharesDelta =
      L.sharesOutstanding !== null && B.sharesOutstanding !== null
        ? L.sharesOutstanding - B.sharesOutstanding
        : null;
    criteria.push({
      key: "no_dilution",
      label: "No Share Dilution",
      category: "Leverage & Liquidity",
      pass: sharesDelta !== null ? sharesDelta <= 0 : null,
      value: sharesDelta,
      threshold: "Delta Shares Outstanding <= 0",
      weight: 1,
      explanation: "Shares outstanding have not increased, meaning existing holders were not diluted.",
    });

    const grossMarginDelta =
      L.grossMargin !== null && B.grossMargin !== null ? L.grossMargin - B.grossMargin : null;
    criteria.push({
      key: "improving_gross_margin",
      label: "Improving Gross Margin",
      category: "Operating Efficiency",
      pass: grossMarginDelta !== null ? grossMarginDelta > 0 : null,
      value: grossMarginDelta,
      threshold: "Delta Gross Margin > 0",
      weight: 1,
      explanation: "Gross margin expanded versus the comparison period - pricing power or cost control improved.",
    });

    const assetTurnoverDelta =
      L.assetTurnover !== null && B.assetTurnover !== null ? L.assetTurnover - B.assetTurnover : null;
    criteria.push({
      key: "improving_asset_turnover",
      label: "Improving Asset Turnover",
      category: "Operating Efficiency",
      pass: assetTurnoverDelta !== null ? assetTurnoverDelta > 0 : null,
      value: assetTurnoverDelta,
      threshold: "Delta Asset Turnover > 0",
      weight: 1,
      explanation: "Revenue generated per dollar of assets increased, indicating more efficient asset use.",
    });

    const dupontRoe =
      L.netMargin !== null && L.assetTurnover !== null && L.equityMultiplier !== null
        ? L.netMargin * L.assetTurnover * L.equityMultiplier
        : null;

    criteria.push({
      key: "dupont_net_margin",
      label: "DuPont - Net Profit Margin",
      category: "DuPont Decomposition",
      pass: L.netMargin !== null ? L.netMargin > 0 : null,
      value: L.netMargin,
      threshold: "Component of ROE",
      weight: 0,
      explanation: "Net income / revenue - the profitability component of ROE.",
    });
    criteria.push({
      key: "dupont_asset_turnover",
      label: "DuPont - Asset Turnover",
      category: "DuPont Decomposition",
      pass: L.assetTurnover !== null ? L.assetTurnover > 0 : null,
      value: L.assetTurnover,
      threshold: "Component of ROE",
      weight: 0,
      explanation: "Revenue / total assets - the efficiency component of ROE.",
    });
    criteria.push({
      key: "dupont_equity_multiplier",
      label: "DuPont - Equity Multiplier (Leverage)",
      category: "DuPont Decomposition",
      pass: L.equityMultiplier !== null ? L.equityMultiplier > 0 : null,
      value: L.equityMultiplier,
      threshold: "Component of ROE",
      weight: 0,
      explanation: "Total assets / total equity - the financial leverage component of ROE.",
    });
    criteria.push({
      key: "dupont_roe_reconstructed",
      label: "DuPont - Reconstructed ROE",
      category: "DuPont Decomposition",
      pass: dupontRoe !== null ? dupontRoe > 0 : null,
      value: dupontRoe,
      threshold: "Margin x Turnover x Leverage",
      weight: 0,
      explanation: "Net Margin x Asset Turnover x Equity Multiplier - should approximate reported ROE.",
    });

    const categoryWeight: Record<string, number> = {
      Profitability: wMargin,
      "Leverage & Liquidity": wLeverage,
      "Operating Efficiency": wEfficiency,
    };

    const scored = criteria.filter((c) => c.weight > 0);
    let earned = 0;
    let possible = 0;
    let rawPassed = 0;
    let rawTotal = 0;

    for (const c of scored) {
      rawTotal += 1;
      const catWeight = categoryWeight[c.category] ?? 0;
      const testsInCategory = scored.filter((x) => x.category === c.category).length;
      const perTestWeight = testsInCategory > 0 ? catWeight / testsInCategory : 0;
      possible += perTestWeight;
      if (c.pass === true) {
        earned += perTestWeight;
        rawPassed += 1;
      }
    }

    const score = possible > 0 ? Math.round((earned / possible) * 100) : 0;
    const hasUnknowns = scored.some((c) => c.pass === null);

    let verdict: StrategyResult["verdict"] = "Weak";
    let verdictColor: StrategyResult["verdictColor"] = "negative";
    if (hasUnknowns && scored.every((c) => c.pass === null)) {
      verdict = "Insufficient Data";
      verdictColor = "amber";
    } else if (score >= strongThreshold) {
      verdict = "Strong";
      verdictColor = "positive";
    } else if (score >= moderateThreshold) {
      verdict = "Moderate";
      verdictColor = "amber";
    } else {
      verdict = "Weak";
      verdictColor = "negative";
    }

    const summary =
      "Scored " + rawPassed + "/" + rawTotal + " F-Score criteria (weighted: " + score + "/100). " +
      (dupontRoe !== null
        ? "DuPont decomposition reconstructs ROE at " + ((dupontRoe ?? 0) * 100).toFixed(1) +
          "%, driven by a " + ((L.netMargin ?? 0) * 100).toFixed(1) + "% net margin, " +
          (L.assetTurnover ?? 0).toFixed(2) + "x asset turnover, and " +
          (L.equityMultiplier ?? 0).toFixed(2) + "x equity multiplier."
        : "DuPont decomposition could not be fully computed due to missing balance sheet fields.");

    return {
      score,
      maxScore: 100,
      rawScore: rawPassed,
      verdict,
      verdictColor,
      summary,
      criteria,
      series: buildSeries(windowed),
      generatedAt: new Date().toISOString(),
    };
  },
};

function buildSeries(quarters: FinancialQuarter[]): StrategySeriesPoint[] {
  return quarters.map((q) => {
    const revenue = toNum(q.revenue);
    const netIncome = toNum(q.netIncome);
    const totalAssets = toNum(q.totalAssets);
    const totalEquity = toNum(q.totalEquity);
    const grossProfit = toNum(q.grossProfit);

    return {
      label: "Q" + q.fiscalQuarter + " FY" + q.fiscalYear,
      revenue,
      netIncome,
      roa: totalAssets && netIncome !== null ? Number((netIncome / totalAssets).toFixed(4)) : null,
      roe: totalEquity && netIncome !== null ? Number((netIncome / totalEquity).toFixed(4)) : null,
      grossMargin: revenue && grossProfit !== null ? Number((grossProfit / revenue).toFixed(4)) : null,
    };
  });
}
