import { FinancialQuarter } from "@prisma/client";
import { StrategyDefinition, StrategyParameter, StrategyResult, StrategySeriesPoint, resolveParam, toNum } from "./types";

/**
 * Beneish M-Score (1999) — Earnings Manipulation Detector
 * =========================================================
 * 8-variable model developed by Professor Messod Beneish to detect
 * companies that are likely manipulating earnings. Infamous for flagging
 * Enron before its collapse. Standard in forensic accounting reviews.
 *
 * M-Score < -2.22  → "Likely NOT manipulator" (safe)
 * M-Score > -2.22  → "Possible manipulator" (warning)
 * M-Score > -1.78  → "Strong manipulation signal" (red)
 *
 * Requires TWO consecutive quarters for delta calculations.
 * Uses YoY comparison (current quarter vs same quarter prior year).
 */

const PARAMETERS: StrategyParameter[] = [
  { key: "lookbackQuarters", label: "Lookback window", type: "slider", defaultValue: 8, min: 4, max: 20, step: 1, unit: "quarters" },
  { key: "manipulationThreshold", label: "Manipulation threshold", type: "number", defaultValue: -2.22, min: -4, max: 0, step: 0.01, description: "M-Score above this = possible manipulator" },
  { key: "strongSignalThreshold", label: "Strong signal threshold", type: "number", defaultValue: -1.78, min: -3, max: 0, step: 0.01, description: "M-Score above this = strong manipulation signal" },
];

function safe(n: number | null, d: number | null): number | null {
  if (n === null || d === null || d === 0) return null;
  return n / d;
}

export const beneishMScoreStrategy: StrategyDefinition = {
  slug: "beneish-mscore",
  name: "Beneish M-Score",
  shortDescription: "8-variable forensic accounting model that detects earnings manipulation. Flagged Enron before collapse.",
  category: "Forensic Accounting",
  icon: "Search",
  parameters: PARAMETERS,
  minQuartersRequired: 5,

  evaluate(quarters, rawParams): StrategyResult {
    const lookback = Number(resolveParam(rawParams, PARAMETERS[0]));
    const manipThresh = Number(resolveParam(rawParams, PARAMETERS[1]));
    const strongThresh = Number(resolveParam(rawParams, PARAMETERS[2]));

    const sorted = [...quarters].sort((a, b) => a.fiscalYear - b.fiscalYear || a.fiscalQuarter - b.fiscalQuarter);
    const windowed = sorted.slice(-lookback);
    const curr = windowed[windowed.length - 1];
    const prev = windowed[windowed.length - 5] ?? windowed[windowed.length - 2]; // YoY preferred

    if (!curr || !prev) {
      return { score: 0, maxScore: 100, rawScore: 0, verdict: "Insufficient Data", verdictColor: "amber",
        summary: "Need at least 2 periods for delta calculations.", criteria: [], series: [], generatedAt: new Date().toISOString() };
    }

    const n = (v: unknown) => toNum(v);

    // DSR – Days Sales Receivable Index
    const dsr_curr = safe(n(curr.receivables), n(curr.revenue));
    const dsr_prev = safe(n(prev.receivables), n(prev.revenue));
    const DSRI = safe(dsr_curr, dsr_prev);

    // GMI – Gross Margin Index (prev/curr — deterioration = higher index)
    const gm_curr = curr.revenue && curr.grossProfit ? n(curr.grossProfit)! / n(curr.revenue)! : null;
    const gm_prev = prev.revenue && prev.grossProfit ? n(prev.grossProfit)! / n(prev.revenue)! : null;
    const GMI = gm_prev !== null && gm_curr !== null && gm_curr !== 0 ? gm_prev / gm_curr : null;

    // AQI – Asset Quality Index
    const nonCurrAssets_curr = n(curr.totalAssets) !== null && n(curr.currentAssets) !== null && n(curr.totalAssets) !== null ? n(curr.totalAssets)! - n(curr.currentAssets)! : null;
    const nonCurrAssets_prev = n(prev.totalAssets) !== null && n(prev.currentAssets) !== null ? n(prev.totalAssets)! - n(prev.currentAssets)! : null;
    const aqi_curr = safe(nonCurrAssets_curr, n(curr.totalAssets));
    const aqi_prev = safe(nonCurrAssets_prev, n(prev.totalAssets));
    const AQI = safe(aqi_curr, aqi_prev);

    // SGI – Sales Growth Index
    const SGI = n(curr.revenue) !== null && n(prev.revenue) !== null && n(prev.revenue) !== 0 ? n(curr.revenue)! / n(prev.revenue)! : null;

    // DEPI – Depreciation Index (we approximate via capex)
    const dep_curr = n(curr.capex);
    const dep_prev = n(prev.capex);
    const depiRatio_curr = dep_curr !== null && n(curr.totalAssets) ? dep_curr / n(curr.totalAssets)! : null;
    const depiRatio_prev = dep_prev !== null && n(prev.totalAssets) ? dep_prev / n(prev.totalAssets)! : null;
    const DEPI = depiRatio_curr !== null && depiRatio_prev !== null && depiRatio_curr !== 0 ? depiRatio_prev / depiRatio_curr : null;

    // SGAI – SG&A Index
    const sgai_curr = safe(n(curr.operatingExpense), n(curr.revenue));
    const sgai_prev = safe(n(prev.operatingExpense), n(prev.revenue));
    const SGAI = safe(sgai_curr, sgai_prev);

    // LVGI – Leverage Index
    const lev_curr = safe(n(curr.totalDebt), n(curr.totalAssets));
    const lev_prev = safe(n(prev.totalDebt), n(prev.totalAssets));
    const LVGI = safe(lev_curr, lev_prev);

    // TATA – Total Accruals to Total Assets
    const accruals = n(curr.netIncome) !== null && n(curr.operatingCashFlow) !== null ? n(curr.netIncome)! - n(curr.operatingCashFlow)! : null;
    const TATA = safe(accruals, n(curr.totalAssets));

    // Beneish coefficients
    const mScore = [DSRI, GMI, AQI, SGI, DEPI, SGAI, LVGI, TATA].every(v => v !== null)
      ? -4.84 + 0.92 * DSRI! + 0.528 * GMI! + 0.404 * AQI! + 0.892 * SGI! + 0.115 * DEPI! - 0.172 * SGAI! + 4.679 * TATA! - 0.327 * LVGI!
      : null;

    const normalizedScore = mScore !== null ? Math.max(0, Math.min(100, ((-mScore - 1) / 4) * 100)) : 0;
    let verdict: StrategyResult["verdict"] = "Insufficient Data";
    let verdictColor: StrategyResult["verdictColor"] = "amber";
    if (mScore !== null) {
      if (mScore < manipThresh) { verdict = "Strong"; verdictColor = "positive"; }
      else if (mScore < strongThresh) { verdict = "Moderate"; verdictColor = "amber"; }
      else { verdict = "Weak"; verdictColor = "negative"; }
    }

    const criteria = [
      { key: "dsri", label: "DSRI — Days Sales Receivable Index", category: "Revenue Quality", pass: DSRI !== null ? DSRI < 1.1 : null, value: DSRI, threshold: "< 1.1 (receivables not growing faster than revenue)", weight: 1, explanation: "Rising DSRI suggests revenue inflation via premature recognition." },
      { key: "gmi", label: "GMI — Gross Margin Index", category: "Revenue Quality", pass: GMI !== null ? GMI < 1.0 : null, value: GMI, threshold: "< 1.0 (margin not deteriorating)", weight: 1, explanation: "Deteriorating gross margins signal pricing or cost pressure, incentivizing manipulation." },
      { key: "aqi", label: "AQI — Asset Quality Index", category: "Asset Inflation", pass: AQI !== null ? AQI < 1.1 : null, value: AQI, threshold: "< 1.1", weight: 1, explanation: "Rising non-current assets relative to prior period may indicate cost deferral." },
      { key: "sgi", label: "SGI — Sales Growth Index", category: "Revenue Quality", pass: SGI !== null ? SGI < 1.4 : null, value: SGI, threshold: "< 1.4 (not unusual growth)", weight: 1, explanation: "Unusually rapid growth is associated with increased manipulation risk." },
      { key: "depi", label: "DEPI — Depreciation Index", category: "Asset Inflation", pass: DEPI !== null ? DEPI < 1.0 : null, value: DEPI, threshold: "< 1.0 (depreciation rate not falling)", weight: 1, explanation: "Falling depreciation rates can inflate reported earnings." },
      { key: "sgai", label: "SGAI — SG&A Index", category: "Expense Management", pass: SGAI !== null ? SGAI < 1.1 : null, value: SGAI, threshold: "< 1.1 (not expanding expenses relative to sales)", weight: 1, explanation: "Disproportionate SGA growth signals operational leverage risk." },
      { key: "lvgi", label: "LVGI — Leverage Index", category: "Leverage", pass: LVGI !== null ? LVGI < 1.0 : null, value: LVGI, threshold: "< 1.0 (not increasing leverage)", weight: 1, explanation: "Increasing leverage heightens pressure to manipulate reported performance." },
      { key: "tata", label: "TATA — Total Accruals to Total Assets", category: "Earnings Quality", pass: TATA !== null ? TATA < 0.05 : null, value: TATA, threshold: "< 0.05 (earnings cash-backed)", weight: 1, explanation: "High accruals (net income > cash flow) is the most direct manipulation signal." },
      { key: "mscore_raw", label: "M-Score (composite)", category: "Composite", pass: mScore !== null ? mScore < manipThresh : null, value: mScore, threshold: `< ${manipThresh} = likely clean`, weight: 0, explanation: "Beneish's weighted combination of all 8 indices." },
    ];

    const series: StrategySeriesPoint[] = windowed.slice(1).map((wq, i) => {
      const pq = windowed[i];
      const r_c = toNum(wq.revenue), r_p = toNum(pq.revenue);
      const sgi_q = r_c !== null && r_p !== null && r_p !== 0 ? r_c / r_p : null;
      const acc_q = toNum(wq.netIncome) !== null && toNum(wq.operatingCashFlow) !== null ? toNum(wq.netIncome)! - toNum(wq.operatingCashFlow)! : null;
      const tata_q = acc_q !== null && toNum(wq.totalAssets) ? acc_q / toNum(wq.totalAssets)! : null;
      return { label: `Q${wq.fiscalQuarter} FY${wq.fiscalYear}`, salesGrowthIndex: sgi_q, accrualRatio: tata_q, manipulationThreshold: manipThresh };
    });

    return { score: Math.round(normalizedScore), maxScore: 100, rawScore: mScore ?? 0, verdict, verdictColor,
      summary: mScore !== null ? `M-Score: ${mScore.toFixed(3)}. ${verdict === "Strong" ? "No strong manipulation signals detected." : verdict === "Moderate" ? "Some manipulation indicators present — investigate receivables and accruals." : "Strong manipulation signals. Earnings likely inflated — verify independently."}` : "Insufficient data for full M-Score computation.",
      criteria, series, generatedAt: new Date().toISOString() };
  },
};
