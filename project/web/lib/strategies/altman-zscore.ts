import { FinancialQuarter } from "@prisma/client";
import { StrategyDefinition, StrategyParameter, StrategyResult, StrategySeriesPoint, resolveParam, toNum } from "./types";

/**
 * Altman Z-Score (1968) — Credit Risk / Bankruptcy Predictor
 * ===========================================================
 * The original Altman Z-Score uses 5 financial ratios weighted to produce
 * a single score predicting bankruptcy probability within 2 years.
 * Used by every Big 4 firm in credit-risk and going-concern assessments.
 *
 * Zones:
 *   Z > 2.99  → "Safe"    (green)
 *   1.81–2.99 → "Grey"    (amber) — uncertainty zone
 *   Z < 1.81  → "Distress" (red)
 *
 * Formula (original public companies):
 *   Z = 1.2*X1 + 1.4*X2 + 3.3*X3 + 0.6*X4 + 1.0*X5
 *   X1 = Working Capital / Total Assets
 *   X2 = Retained Earnings / Total Assets  (approx: Total Equity - Paid-in-Capital → use Equity)
 *   X3 = EBIT / Total Assets
 *   X4 = Market Cap / Total Liabilities   (approx: use Book Equity if no market price)
 *   X5 = Revenue / Total Assets
 */

const PARAMETERS: StrategyParameter[] = [
  { key: "useBookEquity", label: "Use book equity for X4 (no market price)", type: "boolean", defaultValue: true,
    description: "If true, uses total equity instead of market cap for X4 (safer for private/mock data)." },
  { key: "w1", label: "Weight W1 (Working Capital/Assets)", type: "slider", defaultValue: 1.2, min: 0, max: 3, step: 0.1 },
  { key: "w2", label: "Weight W2 (Retained Earnings/Assets)", type: "slider", defaultValue: 1.4, min: 0, max: 3, step: 0.1 },
  { key: "w3", label: "Weight W3 (EBIT/Assets)", type: "slider", defaultValue: 3.3, min: 0, max: 5, step: 0.1 },
  { key: "w4", label: "Weight W4 (Equity/Liabilities)", type: "slider", defaultValue: 0.6, min: 0, max: 2, step: 0.1 },
  { key: "w5", label: "Weight W5 (Revenue/Assets)", type: "slider", defaultValue: 1.0, min: 0, max: 2, step: 0.1 },
  { key: "safeZone", label: "Safe zone threshold", type: "number", defaultValue: 2.99, min: 1, max: 5, step: 0.01, unit: "" },
  { key: "distressZone", label: "Distress zone threshold", type: "number", defaultValue: 1.81, min: 0, max: 3, step: 0.01, unit: "" },
  { key: "lookbackQuarters", label: "Lookback window", type: "slider", defaultValue: 8, min: 2, max: 20, step: 1, unit: "quarters" },
];

export const altmanZScoreStrategy: StrategyDefinition = {
  slug: "altman-zscore",
  name: "Altman Z-Score",
  shortDescription: "5-variable credit risk model predicting bankruptcy probability. Used by Big 4 in going-concern assessments.",
  category: "Credit Risk",
  icon: "AlertTriangle",
  parameters: PARAMETERS,
  minQuartersRequired: 2,

  evaluate(quarters, rawParams): StrategyResult {
    const lookback = Number(resolveParam(rawParams, PARAMETERS[8] ?? { key: "lookbackQuarters", defaultValue: 8 } as any));
    const useBook = Boolean(resolveParam(rawParams, PARAMETERS[0]));
    const w1 = Number(resolveParam(rawParams, PARAMETERS[1]));
    const w2 = Number(resolveParam(rawParams, PARAMETERS[2]));
    const w3 = Number(resolveParam(rawParams, PARAMETERS[3]));
    const w4 = Number(resolveParam(rawParams, PARAMETERS[4]));
    const w5 = Number(resolveParam(rawParams, PARAMETERS[5]));
    const safeZone = Number(resolveParam(rawParams, PARAMETERS[6]));
    const distressZone = Number(resolveParam(rawParams, PARAMETERS[7]));

    const sorted = [...quarters].sort((a, b) => a.fiscalYear - b.fiscalYear || a.fiscalQuarter - b.fiscalQuarter);
    const windowed = sorted.slice(-Math.max(lookback, 2));
    const q = windowed[windowed.length - 1];

    const revenue = toNum(q.revenue);
    const totalAssets = toNum(q.totalAssets);
    const totalLiabilities = toNum(q.totalLiabilities);
    const totalEquity = toNum(q.totalEquity);
    const currentAssets = toNum(q.currentAssets);
    const currentLiabilities = toNum(q.currentLiabilities);
    const operatingIncome = toNum(q.operatingIncome);
    const closePrice = toNum(q.closePrice);
    const sharesOutstanding = toNum(q.sharesOutstanding);

    const workingCapital = currentAssets !== null && currentLiabilities !== null ? currentAssets - currentLiabilities : null;
    const ebit = operatingIncome;
    const marketCap = closePrice !== null && sharesOutstanding !== null ? closePrice * sharesOutstanding : null;
    const equityForX4 = useBook ? totalEquity : (marketCap ?? totalEquity);

    const x1 = workingCapital !== null && totalAssets ? workingCapital / totalAssets : null;
    const x2 = totalEquity !== null && totalAssets ? totalEquity / totalAssets : null;
    const x3 = ebit !== null && totalAssets ? ebit / totalAssets : null;
    const x4 = equityForX4 !== null && totalLiabilities && totalLiabilities > 0 ? equityForX4 / totalLiabilities : null;
    const x5 = revenue !== null && totalAssets ? revenue / totalAssets : null;

    const hasData = [x1, x2, x3, x4, x5].some(v => v !== null);

    let zScore: number | null = null;
    if (x1 !== null && x2 !== null && x3 !== null && x4 !== null && x5 !== null) {
      zScore = w1 * x1 + w2 * x2 + w3 * x3 + w4 * x4 + w5 * x5;
    }

    const normalizedScore = zScore !== null ? Math.min(100, Math.max(0, ((zScore - distressZone) / (safeZone - distressZone)) * 100)) : 0;

    let verdict: StrategyResult["verdict"] = "Insufficient Data";
    let verdictColor: StrategyResult["verdictColor"] = "amber";
    if (zScore !== null) {
      if (zScore >= safeZone) { verdict = "Strong"; verdictColor = "positive"; }
      else if (zScore >= distressZone) { verdict = "Moderate"; verdictColor = "amber"; }
      else { verdict = "Weak"; verdictColor = "negative"; }
    }

    const criteria = [
      { key: "x1", label: "Working Capital / Total Assets (X1)", category: "Liquidity", pass: x1 !== null ? x1 > 0 : null, value: x1, threshold: "X1 > 0", weight: w1, explanation: "Measures net liquid assets relative to total capitalization. Negative = short-term liquidity stress." },
      { key: "x2", label: "Retained Earnings / Total Assets (X2)", category: "Profitability", pass: x2 !== null ? x2 > 0 : null, value: x2, threshold: "X2 > 0", weight: w2, explanation: "Cumulative profitability relative to assets. Low X2 = company relies heavily on debt, not retained earnings." },
      { key: "x3", label: "EBIT / Total Assets (X3)", category: "Profitability", pass: x3 !== null ? x3 > 0 : null, value: x3, threshold: "X3 > 0", weight: w3, explanation: "Productivity of firm assets — the most important ratio in Altman's study. Strips out tax and financing effects." },
      { key: "x4", label: "Equity / Total Liabilities (X4)", category: "Leverage", pass: x4 !== null ? x4 > 1 : null, value: x4, threshold: "X4 > 1x", weight: w4, explanation: "How much assets can decline before liabilities exceed equity. Below 1x = technically insolvent on book." },
      { key: "x5", label: "Revenue / Total Assets (X5)", category: "Efficiency", pass: x5 !== null ? x5 > 0.5 : null, value: x5, threshold: "X5 > 0.5x", weight: w5, explanation: "Asset turnover — efficiency of assets in generating revenue. Low ratio signals operational inefficiency." },
      { key: "zscore_raw", label: "Z-Score (raw)", category: "Composite", pass: zScore !== null ? zScore >= safeZone : null, value: zScore, threshold: `≥ ${safeZone} (Safe), ≥ ${distressZone} (Grey)`, weight: 0, explanation: `Z = ${w1}·X1 + ${w2}·X2 + ${w3}·X3 + ${w4}·X4 + ${w5}·X5` },
    ];

    const series: StrategySeriesPoint[] = windowed.map(wq => {
      const ta = toNum(wq.totalAssets);
      const ni = toNum(wq.netIncome);
      const r = toNum(wq.revenue);
      const ca = toNum(wq.currentAssets);
      const cl = toNum(wq.currentLiabilities);
      const oi = toNum(wq.operatingIncome);
      const tl = toNum(wq.totalLiabilities);
      const te = toNum(wq.totalEquity);
      const wc = ca !== null && cl !== null ? ca - cl : null;
      const qx1 = wc !== null && ta ? wc / ta : null;
      const qx2 = te !== null && ta ? te / ta : null;
      const qx3 = oi !== null && ta ? oi / ta : null;
      const qx4 = te !== null && tl && tl > 0 ? te / tl : null;
      const qx5 = r !== null && ta ? r / ta : null;
      const qZ = qx1 !== null && qx2 !== null && qx3 !== null && qx4 !== null && qx5 !== null
        ? w1 * qx1 + w2 * qx2 + w3 * qx3 + w4 * qx4 + w5 * qx5 : null;
      return { label: `Q${wq.fiscalQuarter} FY${wq.fiscalYear}`, zScore: qZ, safeThreshold: safeZone, distressThreshold: distressZone };
    });

    return {
      score: Math.round(normalizedScore),
      maxScore: 100,
      rawScore: zScore ?? 0,
      verdict,
      verdictColor,
      summary: zScore !== null
        ? `Z-Score: ${zScore.toFixed(2)} — ${verdict === "Strong" ? "Safe zone. Low bankruptcy risk." : verdict === "Moderate" ? "Grey zone. Monitor leverage and cash." : "Distress zone. Elevated bankruptcy risk within 2 years."}`
        : "Insufficient data to compute Z-Score. Ensure EBIT, total assets, liabilities, equity, and revenue are all populated.",
      criteria,
      series,
      generatedAt: new Date().toISOString(),
    };
  },
};
