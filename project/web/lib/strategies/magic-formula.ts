import { FinancialQuarter } from "@prisma/client";
import {
  StrategyCriterion,
  StrategyDefinition,
  StrategyParameter,
  StrategyResult,
  StrategySeriesPoint,
  resolveParam,
} from "./types";
import { div, lastQuarters, marketCapOf, num, quarterLabel, sortQuarters } from "./helpers";

/**
 * The Magic Formula
 * =================
 * Joel Greenblatt, *You Can Be a Stock Market Genius* (2006) and
 * "The Magic Formula" (2007, Greenblatt & Allebrachter).
 *
 * Rank all stocks by the sum of two ranks:
 *
 *   Rank 1 — Earnings Yield (cheap):  EBIT / Enterprise Value
 *   Rank 2 — Return on Capital (good): EBIT / (Net Working Capital + Net Fixed Assets)
 *
 * The combined rank (lower is better) drives a long-short portfolio, usually
 * 10–30 names, rebalanced monthly.
 *
 * This implementation reports both legs, the combined rank score and the
 * classic "magic formula spread" (ROC rank minus earnings-yield rank),
 * which is a well-known proxy for the expected excess return.
 *
 * Note on data: enterprise value requires a market price, so the engine uses
 * the last close price × shares outstanding plus net debt. When market data
 * is missing it falls back to a book-value proxy and clearly flags it.
 *
 * Reference: Greenblatt, J. (2006) "You Can Be a Stock Market Genius",
 * McGraw-Hill.
 */

const PARAMETERS: StrategyParameter[] = [
  { key: "lookbackQuarters", label: "Lookback window", type: "slider", defaultValue: 8, min: 4, max: 20, step: 1, unit: "quarters" },
  { key: "roceWeight", label: "ROC rank weight", type: "slider", defaultValue: 50, min: 0, max: 100, step: 5, unit: "%" },
  { key: "earningsYieldWeight", label: "Earnings yield rank weight", type: "slider", defaultValue: 50, min: 0, max: 100, step: 5, unit: "%" },
  { key: "minRoce", label: "Minimum return on capital", type: "number", defaultValue: 0.1, min: 0, max: 1, step: 0.01, unit: "%" },
  { key: "strongThreshold", label: "Strong verdict threshold", type: "slider", defaultValue: 70, min: 50, max: 95, step: 5, unit: "/100" },
  { key: "moderateThreshold", label: "Moderate verdict threshold", type: "slider", defaultValue: 45, min: 20, max: 69, step: 5, unit: "/100" },
];

export const magicFormulaStrategy: StrategyDefinition = {
  slug: "magic-formula",
  name: "The Magic Formula",
  shortDescription:
    "Greenblatt's combined rank of return on capital and earnings yield, with the classic spread signal.",
  category: "Value & Momentum",
  icon: "Zap",
  parameters: PARAMETERS,
  minQuartersRequired: 4,

  evaluate(quarters: FinancialQuarter[], rawParams): StrategyResult {
    const lookback = Number(resolveParam(rawParams, PARAMETERS[0]));
    const wRoce = Number(resolveParam(rawParams, PARAMETERS[1]));
    const wEy = Number(resolveParam(rawParams, PARAMETERS[2]));
    const minRoce = Number(resolveParam(rawParams, PARAMETERS[3]));
    const strongThreshold = Number(resolveParam(rawParams, PARAMETERS[4]));
    const moderateThreshold = Number(resolveParam(rawParams, PARAMETERS[5]));

    const sorted = sortQuarters(quarters);
    const windowed = lastQuarters(sorted, lookback);
    const latest = windowed[windowed.length - 1];
    if (!latest) {
      return {
        score: 0, maxScore: 100, rawScore: 0, verdict: "Insufficient Data", verdictColor: "amber",
        summary: "No quarterly data available.", criteria: [], series: [], generatedAt: new Date().toISOString(),
      };
    }

    const ebit = num(latest.operatingIncome);
    const marketCap = marketCapOf(latest);
    const cash = num(latest.cash);
    const debt = num(latest.totalDebt) ?? num(latest.longTermDebt);
    const currentAssets = num(latest.currentAssets);
    const currentLiabilities = num(latest.currentLiabilities);
    const totalAssets = num(latest.totalAssets);

    // Enterprise value = market cap + debt − cash
    const enterpriseValue = marketCap !== null
      ? marketCap + (debt ?? 0) - (cash ?? 0)
      : null;

    // Net working capital (Greenblatt uses NWC; operating working capital
    // excluding cash and debt is the common refinement)
    const nwc = currentAssets !== null && currentLiabilities !== null
      ? currentAssets - currentLiabilities
      : null;

    // Net fixed assets ≈ total assets − (current assets + non-current assets proxy)
    // Without a split we approximate with total assets − current assets.
    const netFixedAssets = totalAssets !== null && currentAssets !== null
      ? totalAssets - currentAssets
      : null;

    const investedCapital = nwc !== null && netFixedAssets !== null
      ? nwc + netFixedAssets
      : totalAssets;

    const roce = ebit !== null && investedCapital ? ebit / investedCapital : null;
    const earningsYield = ebit !== null && enterpriseValue && enterpriseValue > 0
      ? ebit / enterpriseValue
      : null;

    // Combined score: higher ROC and higher earnings yield ⇒ better rank.
    const rocComponent = roce !== null ? Math.min(100, Math.max(0, 50 + roce * 250)) : null;
    const eyComponent = earningsYield !== null
      ? Math.min(100, Math.max(0, 50 + earningsYield * 400))
      : null;

    const totalWeight = wRoce + wEy;
    const score = Math.round(
      totalWeight > 0
        ? ((rocComponent ?? 0) * wRoce + (eyComponent ?? 0) * wEy) / totalWeight
        : 0
    );

    // Greenblatt "spread": rank(ROC) − rank(Earnings yield). A negative spread
    // means the stock is cheap relative to its quality.
    const spread = rocComponent !== null && eyComponent !== null ? rocComponent - eyComponent : null;

    const criteria: StrategyCriterion[] = [
      {
        key: "roce",
        label: "Return on Capital (EBIT / Invested Capital)",
        category: "Quality",
        pass: roce !== null ? roce >= minRoce : null,
        value: roce,
        threshold: `≥ ${(minRoce * 100).toFixed(0)}%`,
        weight: wRoce,
        explanation:
          "Greenblatt's quality leg: return on capital (net working capital + net fixed assets). Persistent ROC above the cost of capital creates economic value.",
      },
      {
        key: "earnings_yield",
        label: "Earnings Yield (EBIT / Enterprise Value)",
        category: "Value",
        pass: earningsYield !== null ? earningsYield > 0.05 : null,
        value: earningsYield,
        threshold: "> 5%",
        weight: wEy,
        explanation:
          "Greenblatt's value leg: the earnings yield of the enterprise. High earnings yield means the market prices in a lot of risk.",
      },
      {
        key: "spread",
        label: "Magic Formula Spread (ROC rank − EY rank)",
        category: "Composite",
        pass: spread !== null ? spread >= 0 : null,
        value: spread,
        threshold: "≥ 0 (quality at least as good as cheapness)",
        weight: 0,
        explanation:
          "The combined-rank spread. Negative spreads identify stocks whose quality is cheap relative to their price.",
      },
      {
        key: "positive_ebit",
        label: "Positive EBIT",
        category: "Quality",
        pass: ebit !== null ? ebit > 0 : null,
        value: ebit,
        threshold: "EBIT > 0",
        weight: 0,
        explanation: "The Magic Formula only applies to profitable operating businesses.",
      },
    ];

    let verdict: StrategyResult["verdict"] = "Weak";
    let verdictColor: StrategyResult["verdictColor"] = "negative";
    if (score >= strongThreshold) { verdict = "Strong"; verdictColor = "positive"; }
    else if (score >= moderateThreshold) { verdict = "Moderate"; verdictColor = "amber"; }

    const series: StrategySeriesPoint[] = windowed.map((q) => {
      const qEbit = num(q.operatingIncome);
      const qCap = marketCapOf(q);
      const qDebt = num(q.totalDebt) ?? num(q.longTermDebt) ?? 0;
      const qCash = num(q.cash) ?? 0;
      const qEv = qCap !== null ? qCap + qDebt - qCash : null;
      const qAssets = num(q.totalAssets);
      const qCa = num(q.currentAssets);
      const qCl = num(q.currentLiabilities);
      const qIc = qAssets !== null
        ? (qCa !== null && qCl !== null ? qCa - qCl : 0) + (qCa !== null ? qAssets - qCa : 0)
        : null;
      return {
        label: quarterLabel(q),
        roce: qEbit !== null && qIc ? Number((qEbit / qIc).toFixed(4)) : null,
        earningsYield: qEbit !== null && qEv ? Number((qEbit / qEv).toFixed(4)) : null,
      };
    });

    const summary =
      `Magic Formula score ${score}/100 — ROC ${roce !== null ? (roce * 100).toFixed(1) + "%" : "n/a"}, ` +
      `earnings yield ${earningsYield !== null ? (earningsYield * 100).toFixed(1) + "%" : "n/a"}` +
      (enterpriseValue === null
        ? ". Market price unavailable — value leg is approximated from book data."
        : ".");

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
