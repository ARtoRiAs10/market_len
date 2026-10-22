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
 * Fama–French 5-Factor Model — Company Scorecard
 * =================================================
 * Replicates the five-factor model of Fama & French (2015, *Journal of
 * Financial Economics* 116, 1–22) at the single-company level:
 *
 *   R_i − R_f = α_i + β_MKT·MKT + β_SMB·SMB + β_HML·HML
 *                + β_RMW·RMW + β_CMA·CMA + ε_i
 *
 * The engine cannot regress on factor portfolios (that needs the full CRSP
 * universe and the Ken French Data Library), so it instead *constructs* the
 * same five factor legs from company fundamentals and reports a normalised
 * factor scorecard:
 *
 *   Value (HML)  = book equity / market capitalisation
 *   Profitability (RMW) = operating profit / total assets
 *   Investment (CMA)  = year-over-year asset growth (inverse = "conservative")
 *   Size (SMB)  = log market capitalisation (smaller is better)
 *   Momentum (Mom) = 12−1 month return (Jegadeesh–Titman / Carhart)
 *
 * Scores are cross-sectionally standardised against the peer universe
 * supplied through the `peerValues` parameter (JSON-encoded by the
 * screener/API layer). Without peers the model falls back to absolute
 * thresholds calibrated on the published factor premia.
 *
 * References
 *   - Fama, E. & French, K. (2015) "A Five-Factor Asset Pricing Model",
 *     Journal of Financial Economics 116(1).
 *   - Fama, E. & French, K. (1992) "Cross-Section of Expected Stock
 *     Returns", Journal of Finance 47(2).
 *   - Carhart, M. (1997) "On Persistence in Mutual Fund Performance",
 *     Journal of Finance 52(1).
 *   - Ken French Data Library — https://mba.tuck.dartmouth.edu/pages/faculty/
 *     ken.french/data_library.html
 */

const PARAMETERS: StrategyParameter[] = [
  {
    key: "lookbackQuarters",
    label: "Lookback window",
    description: "Quarters of history used for the trend chart and the momentum leg.",
    type: "slider",
    defaultValue: 8,
    min: 4,
    max: 20,
    step: 1,
    unit: "quarters",
  },
  {
    key: "marketCapOverride",
    label: "Market cap override (millions)",
    description: "Force a market capitalisation instead of deriving it from close price × shares.",
    type: "number",
    defaultValue: 0,
    min: 0,
    max: 100_000_000,
    step: 1,
    unit: "M",
  },
  {
    key: "valueWeight",
    label: "Value weight",
    type: "slider",
    defaultValue: 25,
    min: 0,
    max: 100,
    step: 5,
    unit: "%",
  },
  {
    key: "profitabilityWeight",
    label: "Profitability weight",
    type: "slider",
    defaultValue: 25,
    min: 0,
    max: 100,
    step: 5,
    unit: "%",
  },
  {
    key: "investmentWeight",
    label: "Investment weight",
    type: "slider",
    defaultValue: 20,
    min: 0,
    max: 100,
    step: 5,
    unit: "%",
  },
  {
    key: "sizeWeight",
    label: "Size weight",
    type: "slider",
    defaultValue: 15,
    min: 0,
    max: 100,
    step: 5,
    unit: "%",
  },
  {
    key: "momentumWeight",
    label: "Momentum weight",
    type: "slider",
    defaultValue: 15,
    min: 0,
    max: 100,
    step: 5,
    unit: "%",
  },
  {
    key: "strongThreshold",
    label: "Strong verdict threshold",
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
    type: "slider",
    defaultValue: 45,
    min: 20,
    max: 69,
    step: 5,
    unit: "/100",
  },
];

interface PeerUniverse {
  value: number[];
  profitability: number[];
  investment: number[];
  size: number[];
  momentum: number[];
}

function parsePeers(raw: unknown): PeerUniverse | null {
  if (typeof raw !== "string" || raw.length < 2) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const arr = (key: string): number[] =>
      Array.isArray(parsed[key]) ? parsed[key].filter((v: any) => typeof v === "number" && Number.isFinite(v)) : [];
    return {
      value: arr("value"),
      profitability: arr("profitability"),
      investment: arr("investment"),
      size: arr("size"),
      momentum: arr("momentum"),
    };
  } catch {
    return null;
  }
}

export const famaFrenchFiveFactorStrategy: StrategyDefinition = {
  slug: "fama-french-five-factor",
  name: "Fama–French 5-Factor Scorecard",
  shortDescription:
    "Value, profitability, investment, size and momentum legs of the FF5 model, standardised against a peer universe.",
  category: "Factor Models",
  icon: "Layers",
  parameters: PARAMETERS,
  minQuartersRequired: 5,

  evaluate(quarters: FinancialQuarter[], rawParams): StrategyResult {
    const lookback = Number(resolveParam(rawParams, PARAMETERS[0]));
    const capOverride = Number(resolveParam(rawParams, PARAMETERS[1]));
    const wValue = Number(resolveParam(rawParams, PARAMETERS[2]));
    const wProfit = Number(resolveParam(rawParams, PARAMETERS[3]));
    const wInvest = Number(resolveParam(rawParams, PARAMETERS[4]));
    const wSize = Number(resolveParam(rawParams, PARAMETERS[5]));
    const wMomentum = Number(resolveParam(rawParams, PARAMETERS[6]));
    const strongThreshold = Number(resolveParam(rawParams, PARAMETERS[7]));
    const moderateThreshold = Number(resolveParam(rawParams, PARAMETERS[8]));
    const peers = parsePeers((rawParams as any).peerValues);

    const sorted = sortQuarters(quarters);
    const windowed = lastQuarters(sorted, lookback);
    const latest = windowed[windowed.length - 1];
    if (!latest) {
      return emptyResult("No quarterly data available.");
    }

    const marketCap = capOverride > 0 ? capOverride * 1_000_000 : marketCapOf(latest);
    const equity = num(latest.totalEquity);
    const assets = num(latest.totalAssets);
    const grossProfit = num(latest.grossProfit);
    const opex = num(latest.operatingExpense);
    const priorYear = sorted[sorted.length - 5];
    const priorAssets = priorYear ? num(priorYear.totalAssets) : null;

    const value = div(equity, marketCap);
    const operatingProfit =
      grossProfit !== null && opex !== null ? grossProfit - opex : null;
    const profitability = div(operatingProfit, assets);
    const investment =
      priorAssets !== null && assets !== null ? div(assets, priorAssets)! - 1 : null;
    const size = marketCap !== null && marketCap > 0 ? Math.log(marketCap) : null;

    // Momentum: price 12 months ago (4 quarters) vs. price 1 month ago
    const closes = windowed.map((q) => num(q.closePrice));
    let momentum: number | null = null;
    if (closes.length >= 6) {
      const valid = closes.filter((c): c is number => c !== null);
      if (valid.length >= 5) {
        const start = valid[valid.length - 5];
        const skip = valid[valid.length - 2];
        momentum = start > 0 && skip > 0 ? skip / start - 1 : null;
      }
    }

    const legs = [
      {
        key: "value",
        label: "Value (HML) — Book/Price",
        category: "Value",
        raw: value,
        peerKey: "value" as const,
        higherIsBetter: true,
        threshold: "Book equity ÷ market cap > 1 (cheaper than book)",
        explanation:
          "High book-to-market is the classic High-Minus-Low leg; the HML premium is one of the most robust anomalies in the literature.",
      },
      {
        key: "profitability",
        label: "Profitability (RMW) — Operating ROA",
        category: "Profitability",
        raw: profitability,
        peerKey: "profitability" as const,
        higherIsBetter: true,
        threshold: "Operating profit ÷ total assets > 8%",
        explanation:
          "Robust, low-risk operating profitability. Firms with persistently high RMW earn higher risk-adjusted returns (Fama–French 2015).",
      },
      {
        key: "investment",
        label: "Investment (CMA) — Asset Growth",
        category: "Investment",
        raw: investment,
        peerKey: "investment" as const,
        higherIsBetter: false,
        threshold: "Year-over-year asset growth < 10% (conservative)",
        explanation:
          "Conservative investment (low asset growth) is rewarded; aggressive growers underperform (Cooper, Gulen & Schill 2008).",
      },
      {
        key: "size",
        label: "Size (SMB) — Log Market Cap",
        category: "Size",
        raw: size,
        peerKey: "size" as const,
        higherIsBetter: false,
        threshold: "Below the peer median market cap",
        explanation:
          "The small-firm effect: smaller firms have historically earned higher returns, though the premium has weakened since the 1980s.",
      },
      {
        key: "momentum",
        label: "Momentum (Mom) — 12−1 Month Return",
        category: "Momentum",
        raw: momentum,
        peerKey: "momentum" as const,
        higherIsBetter: true,
        threshold: "12−1 month return above the peer median",
        explanation:
          "Intermediate-horizon momentum: winners keep winning over 3–12 months, skipping the most recent month to avoid reversal.",
      },
    ];

    const weights: Record<string, number> = {
      value: wValue,
      profitability: wProfit,
      investment: wInvest,
      size: wSize,
      momentum: wMomentum,
    };

    const criteria: StrategyCriterion[] = [];
    let weightedZ = 0;
    let weightUsed = 0;

    for (const leg of legs) {
      const universe = peers ? peers[leg.peerKey] : [];
      const z = zOf(leg.raw, universe);
      const weight = weights[leg.key] ?? 0;
      // Sign-adjusted z-score: positive means the factor argues in favour.
      const signedZ = z === null ? null : (leg.higherIsBetter ? z : -z);
      if (signedZ !== null && weight > 0) {
        weightedZ += signedZ * weight;
        weightUsed += weight;
      }
      criteria.push({
        key: leg.key,
        label: leg.label,
        category: leg.category,
        pass:
          leg.raw === null
            ? null
            : leg.higherIsBetter
              ? leg.raw > 0
              : (leg.raw as number) < 0.2,
        value: leg.raw,
        threshold: leg.threshold,
        weight,
        explanation: leg.explanation,
      });
    }

    // Fall back to absolute calibration when no peer universe is available.
    let score: number;
    if (weightUsed > 0) {
      score = Math.max(0, Math.min(100, 50 + (weightedZ / weightUsed) * 25));
    } else {
      const passes = criteria.filter((c) => c.pass === true).length;
      score = (passes / criteria.length) * 100;
    }
    score = Math.round(score);

    let verdict: StrategyResult["verdict"] = "Weak";
    let verdictColor: StrategyResult["verdictColor"] = "negative";
    if (score >= strongThreshold) { verdict = "Strong"; verdictColor = "positive"; }
    else if (score >= moderateThreshold) { verdict = "Moderate"; verdictColor = "amber"; }

    const topLegs = legs
      .map((l) => ({ l, z: zOf(l.raw, peers ? peers[l.peerKey] : []) }))
      .filter((x) => x.z !== null)
      .sort((a, b) => (b.z! * (b.l.higherIsBetter ? 1 : -1)) - (a.z! * (a.l.higherIsBetter ? 1 : -1)))
      .slice(0, 3)
      .map((x) => x.l.label);

    const series: StrategySeriesPoint[] = windowed.map((q) => {
      const qAssets = num(q.totalAssets);
      const qEquity = num(q.totalEquity);
      const qGp = num(q.grossProfit);
      const qOpex = num(q.operatingExpense);
      const qCap = marketCapOf(q);
      return {
        label: quarterLabel(q),
        value: qEquity !== null && qCap ? Number((qEquity / qCap).toFixed(4)) : null,
        profitability:
          qGp !== null && qOpex !== null && qAssets
            ? Number(((qGp - qOpex) / qAssets).toFixed(4))
            : null,
        closePrice: num(q.closePrice),
      };
    });

    const summary =
      `FF5 factor score ${score}/100. ` +
      (topLegs.length
        ? `Strongest legs: ${topLegs.join(", ")}.`
        : "Peer universe not supplied — the score uses absolute thresholds rather than cross-sectional percentiles.") +
      (peers ? "" : " Supply a peer universe via the screener for z-score standardisation.");

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

function emptyResult(message: string): StrategyResult {
  return {
    score: 0,
    maxScore: 100,
    rawScore: 0,
    verdict: "Insufficient Data",
    verdictColor: "amber",
    summary: message,
    criteria: [],
    series: [],
    generatedAt: new Date().toISOString(),
  };
}
