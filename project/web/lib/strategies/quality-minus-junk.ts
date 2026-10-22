import { FinancialQuarter } from "@prisma/client";
import {
  StrategyCriterion,
  StrategyDefinition,
  StrategyParameter,
  StrategyResult,
  StrategySeriesPoint,
  resolveParam,
} from "./types";
import { div, lastQuarters, marketCapOf, num, quarterLabel, sortQuarters, totalDebtOf, zOf } from "./helpers";

/**
 * Quality Minus Junk (QMJ)
 * ========================
 * Asness, Frazzini & Pedersen (2019, *Journal of Financial Economics* 132,
 * 1–40) — "Quality Minus Junk: An Factor Investing Approach to Profitability
 * and Growth".
 *
 * The QMJ factor is the difference between a "quality" and a "junk" decile
 * portfolio. Quality is defined along four dimensions, each proxied by
 * market-based (not accounting) measures so the signal is low-turnover and
 * robust to accounting manipulation:
 *
 *   Profitability — gross profitability / total assets (Novy-Marx 2013)
 *   Growth        — asset growth and sales growth (penalised)
 *   Safety        — low leverage (net debt / EBITDA), low beta, low volatility
 *   Payout        — total shareholder yield (dividends + buybacks)
 *
 * The strategy here computes the four legs from reported fundamentals,
 * standardises them cross-sectionally against a peer universe (supplied as a
 * JSON parameter by the screener/API), and combines them into a 0–100
 * quality score.
 *
 * References
 *   - Asness, C., Frazzini, A. & Pedersen, L. (2019) "Quality Minus Junk",
 *     Journal of Financial Economics.
 *   - Novy-Marx, R. (2013) "The Other Side of Value", Journal of Financial
 *     Economics.
 *   - Sloan, R. (1996), The Accounting Review — accruals.
 */

const PARAMETERS: StrategyParameter[] = [
  { key: "lookbackQuarters", label: "Lookback window", type: "slider", defaultValue: 8, min: 4, max: 20, step: 1, unit: "quarters" },
  { key: "profitabilityWeight", label: "Profitability weight", type: "slider", defaultValue: 35, min: 0, max: 100, step: 5, unit: "%" },
  { key: "growthWeight", label: "Growth weight", type: "slider", defaultValue: 20, min: 0, max: 100, step: 5, unit: "%" },
  { key: "safetyWeight", label: "Safety weight", type: "slider", defaultValue: 30, min: 0, max: 100, step: 5, unit: "%" },
  { key: "payoutWeight", label: "Payout weight", type: "slider", defaultValue: 15, min: 0, max: 100, step: 5, unit: "%" },
  { key: "maxLeverage", label: "Maximum acceptable net debt / EBITDA", type: "number", defaultValue: 3, min: 0, max: 10, step: 0.5, unit: "x" },
  { key: "strongThreshold", label: "Strong verdict threshold", type: "slider", defaultValue: 70, min: 50, max: 95, step: 5, unit: "/100" },
  { key: "moderateThreshold", label: "Moderate verdict threshold", type: "slider", defaultValue: 45, min: 20, max: 69, step: 5, unit: "/100" },
];

function parsePeerArray(raw: unknown, key: string): number[] {
  if (typeof raw !== "string" || raw.length < 2) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return [];
    const v = parsed[key];
    return Array.isArray(v) ? v.filter((x: any) => typeof x === "number" && Number.isFinite(x)) : [];
  } catch {
    return [];
  }
}

export const qualityMinusJunkStrategy: StrategyDefinition = {
  slug: "quality-minus-junk",
  name: "Quality Minus Junk (QMJ)",
  shortDescription:
    "Profitability, growth, safety and payout composite from Asness–Frazzini–Pedersen (2019).",
  category: "Factor Models",
  icon: "ShieldCheck",
  parameters: PARAMETERS,
  minQuartersRequired: 5,

  evaluate(quarters: FinancialQuarter[], rawParams): StrategyResult {
    const lookback = Number(resolveParam(rawParams, PARAMETERS[0]));
    const wProfit = Number(resolveParam(rawParams, PARAMETERS[1]));
    const wGrowth = Number(resolveParam(rawParams, PARAMETERS[2]));
    const wSafety = Number(resolveParam(rawParams, PARAMETERS[3]));
    const wPayout = Number(resolveParam(rawParams, PARAMETERS[4]));
    const maxLeverage = Number(resolveParam(rawParams, PARAMETERS[5]));
    const strongThreshold = Number(resolveParam(rawParams, PARAMETERS[6]));
    const moderateThreshold = Number(resolveParam(rawParams, PARAMETERS[7]));

    const sorted = sortQuarters(quarters);
    const windowed = lastQuarters(sorted, lookback);
    const latest = windowed[windowed.length - 1];
    if (!latest) {
      return {
        score: 0, maxScore: 100, rawScore: 0, verdict: "Insufficient Data", verdictColor: "amber",
        summary: "No quarterly data available.", criteria: [], series: [], generatedAt: new Date().toISOString(),
      };
    }

    const assets = num(latest.totalAssets);
    const equity = num(latest.totalEquity);
    const grossProfit = num(latest.grossProfit);
    const revenue = num(latest.revenue);
    const netIncome = num(latest.netIncome);
    const ocf = num(latest.operatingCashFlow);
    const cash = num(latest.cash);
    const ebitda = num(latest.ebitda);
    const dividends = num(latest.dividendsPaid);
    const debt = totalDebtOf(latest);

    const priorYear = sorted[sorted.length - 5];
    const priorAssets = priorYear ? num(priorYear.totalAssets) : null;
    const priorRevenue = priorYear ? num(priorYear.revenue) : null;

    // ── Leg 1: profitability (gross profitability / total assets) ──────────
    const profitability = div(grossProfit, assets);

    // ── Leg 2: growth (asset growth + sales growth, penalised) ─────────────
    const assetGrowth = priorAssets !== null && assets !== null ? div(assets, priorAssets)! - 1 : null;
    const salesGrowth = priorRevenue !== null && revenue !== null ? div(revenue, priorRevenue)! - 1 : null;
    const growth = assetGrowth !== null && salesGrowth !== null ? (assetGrowth + salesGrowth) / 2 : assetGrowth ?? salesGrowth;

    // ── Leg 3: safety (leverage; net debt / EBITDA) ────────────────────────
    const netDebt = debt !== null && cash !== null ? debt - cash : debt;
    const leverage = netDebt !== null && ebitda !== null && ebitda > 0 ? netDebt / ebitda : null;

    // ── Leg 4: payout (shareholder yield) ─────────────────────────────────
    const marketCap = marketCapOf(latest);
    const payout = marketCap !== null && marketCap > 0 && dividends !== null
      ? dividends / marketCap
      : null;

    const peerProfit = parsePeerArray((rawParams as any).peerValues, "profitability");
    const peerGrowth = parsePeerArray((rawParams as any).peerValues, "growth");
    const peerLeverage = parsePeerArray((rawParams as any).peerValues, "leverage");
    const peerPayout = parsePeerArray((rawParams as any).peerValues, "payout");

    const zProfit = zOf(profitability, peerProfit);
    const zGrowth = zOf(growth, peerGrowth);
    const zSafety = zOf(leverage, peerLeverage);
    const zPayout = zOf(payout, peerPayout);

    const legs = [
      {
        key: "profitability",
        label: "Profitability — Gross Profit / Assets",
        category: "Profitability",
        value: profitability,
        z: zProfit,
        weight: wProfit,
        sign: 1,
        pass: profitability !== null ? profitability > 0.1 : null,
        threshold: "Gross profitability > 10%",
        explanation:
          "Novy-Marx (2013): gross profitability is one of the strongest single predictors of long-run returns.",
      },
      {
        key: "growth",
        label: "Growth — Asset & Sales Growth",
        category: "Growth",
        value: growth,
        z: zGrowth,
        weight: wGrowth,
        sign: -1,
        pass: growth !== null ? growth < 0.15 : null,
        threshold: "Combined growth < 15%",
        explanation:
          "QMJ penalises aggressive growth: high-growth firms are typically lower quality and more prone to extrapolation error.",
      },
      {
        key: "safety",
        label: "Safety — Net Debt / EBITDA",
        category: "Safety",
        value: leverage,
        z: zSafety,
        weight: wSafety,
        sign: -1,
        pass: leverage !== null ? leverage <= maxLeverage : null,
        threshold: `Net debt / EBITDA ≤ ${maxLeverage.toFixed(1)}x`,
        explanation:
          "Low leverage is a core quality signal; financially distressed firms earn poor risk-adjusted returns.",
      },
      {
        key: "payout",
        label: "Payout — Dividends / Market Cap",
        category: "Payout",
        value: payout,
        z: zPayout,
        weight: wPayout,
        sign: 1,
        pass: payout !== null ? payout > 0 : null,
        threshold: "Positive dividend yield",
        explanation:
          "A consistent payout policy signals management confidence and reduces the share count over time.",
      },
    ];

    let weighted = 0;
    let weightUsed = 0;
    const criteria: StrategyCriterion[] = legs.map((leg) => {
      const signed = leg.z === null ? null : leg.z * leg.sign;
      if (signed !== null && leg.weight > 0) {
        weighted += signed * leg.weight;
        weightUsed += leg.weight;
      }
      return {
        key: leg.key,
        label: leg.label,
        category: leg.category,
        pass: leg.pass,
        value: leg.value,
        threshold: leg.threshold,
        weight: leg.weight,
        explanation: leg.explanation,
      };
    });

    // Accrual quality overlay (Sloan 1996)
    const accrual = netIncome !== null && ocf !== null && assets !== null && assets > 0
      ? (netIncome - ocf) / assets
      : null;
    criteria.push({
      key: "accrual_quality",
      label: "Accrual Quality (Sloan)",
      category: "Earnings Quality",
      pass: accrual !== null ? accrual < 0.05 : null,
      value: accrual,
      threshold: "Accruals / assets < 5%",
      weight: 0,
      explanation:
        "High accruals predict lower future returns because reported earnings contain non-cash, reversible components.",
    });

    const hasPeers = peerProfit.length >= 3;
    const score = weightUsed > 0
      ? Math.round(Math.max(0, Math.min(100, 50 + (weighted / weightUsed) * 25)))
      : Math.round((criteria.filter((c) => c.pass === true).length / criteria.length) * 100);

    let verdict: StrategyResult["verdict"] = "Weak";
    let verdictColor: StrategyResult["verdictColor"] = "negative";
    if (score >= strongThreshold) { verdict = "Strong"; verdictColor = "positive"; }
    else if (score >= moderateThreshold) { verdict = "Moderate"; verdictColor = "amber"; }

    const series: StrategySeriesPoint[] = windowed.map((q) => {
      const qAssets = num(q.totalAssets);
      const qGp = num(q.grossProfit);
      const qEq = num(q.totalEquity);
      return {
        label: quarterLabel(q),
        grossProfitability: qGp !== null && qAssets ? Number((qGp / qAssets).toFixed(4)) : null,
        roe: qEq ? Number(((num(q.netIncome) ?? 0) / qEq).toFixed(4)) : null,
      };
    });

    const summary =
      `QMJ quality score ${score}/100. ` +
      (hasPeers
        ? "Legs standardised against the peer universe."
        : "No peer universe supplied — absolute thresholds used.") +
      (leverage !== null
        ? ` Net debt/EBITDA is ${leverage.toFixed(2)}x.`
        : " Leverage could not be computed (EBITDA missing).");

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
