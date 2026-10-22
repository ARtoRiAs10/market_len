import { FinancialQuarter } from "@prisma/client";
import {
  StrategyCriterion,
  StrategyDefinition,
  StrategyParameter,
  StrategyResult,
  StrategySeriesPoint,
  resolveParam,
} from "./types";
import { lastQuarters, num, quarterLabel, sortQuarters } from "./helpers";

/**
 * 12−1 Month Momentum (with short-term reversal filter)
 * =======================================================
 * Jegadeesh, N. & Titman, S. (1993), "Returns to Buying Winners and Selling
 * Losers: Implications for Stock Market Efficiency", *Journal of Finance*
 * 48(1) — and Carhart, M. (1997), "On Persistence in Mutual Fund Performance",
 * *Journal of Finance* 52(1).
 *
 * The classic finding: stocks that outperformed over the past 12 months
 * (skipping the most recent month) continue to outperform over the next
 * 3–12 months. The most recent month is skipped because short-term
 * (1-month) reversal contaminates the signal.
 *
 * The engine works from the quarterly close-price series stored on each
 * financial quarter (a documented approximation of the monthly series used
 * in the papers — a daily/monthly `PriceBar` series gives the exact
 * computation) and reports:
 *
 *   - 12−1 momentum, 6−1 momentum and 3-month reversal
 *   - realised volatility and the momentum/volatility ratio (a risk-scaled
 *     momentum measure, e.g. Moskowitz, Ooi & Pedersen 2012)
 *   - a momentum quality check: momentum accompanied by positive earnings
 *     revisions proxy (gross margin expansion) — "frog-in-the-pan"
 *     momentum is weaker than "smooth" momentum (Da, Gurun & Warachka 2014)
 *
 * References
 *   - Jegadeesh, N. & Titman, S. (1993) Journal of Finance 48(1).
 *   - Carhart, M. (1997) Journal of Finance 52(1).
 *   - Moskowitz, T., Ooi, Y. & Pedersen, L. (2012) "Time Series Momentum",
 *     Journal of Financial Economics 104(2).
 *   - Da, Z., Gurun, U. & Warachka, B. (2014) "Frog in the Pan: Continuous
 *     Information and Momentum", Review of Financial Studies 27(9).
 */

const PARAMETERS: StrategyParameter[] = [
  { key: "lookbackQuarters", label: "Lookback window", type: "slider", defaultValue: 8, min: 4, max: 20, step: 1, unit: "quarters" },
  { key: "momentumWindow", label: "Momentum formation window", type: "slider", defaultValue: 4, min: 2, max: 12, step: 1, unit: "quarters" },
  { key: "skipPeriods", label: "Skip (short-term reversal)", type: "slider", defaultValue: 1, min: 0, max: 3, step: 1, unit: "quarters" },
  { key: "minMomentum", label: "Minimum qualifying momentum", type: "slider", defaultValue: 10, min: -50, max: 100, step: 5, unit: "%" },
  { key: "maxVolatility", label: "Maximum annualised volatility", type: "slider", defaultValue: 60, min: 5, max: 200, step: 5, unit: "%" },
  { key: "strongThreshold", label: "Strong verdict threshold", type: "slider", defaultValue: 70, min: 50, max: 95, step: 5, unit: "/100" },
  { key: "moderateThreshold", label: "Moderate verdict threshold", type: "slider", defaultValue: 45, min: 20, max: 69, step: 5, unit: "/100" },
];

export const momentumStrategy: StrategyDefinition = {
  slug: "momentum-12-1",
  name: "12−1 Month Momentum",
  shortDescription:
    "Intermediate-horizon price momentum (Jegadeesh–Titman, Carhart) with a volatility and earnings-quality overlay.",
  category: "Value & Momentum",
  icon: "TrendingUp",
  parameters: PARAMETERS,
  minQuartersRequired: 6,

  evaluate(quarters: FinancialQuarter[], rawParams): StrategyResult {
    const lookback = Number(resolveParam(rawParams, PARAMETERS[0]));
    const formation = Number(resolveParam(rawParams, PARAMETERS[1]));
    const skip = Number(resolveParam(rawParams, PARAMETERS[2]));
    const minMomentum = Number(resolveParam(rawParams, PARAMETERS[3])) / 100;
    const maxVol = Number(resolveParam(rawParams, PARAMETERS[4])) / 100;
    const strongThreshold = Number(resolveParam(rawParams, PARAMETERS[5]));
    const moderateThreshold = Number(resolveParam(rawParams, PARAMETERS[6]));

    const sorted = sortQuarters(quarters);
    const windowed = lastQuarters(sorted, lookback);
    const closes = windowed.map((q) => num(q.closePrice));
    const prices = closes.filter((p): p is number => p !== null);

    if (prices.length < formation + skip + 2) {
      return {
        score: 0, maxScore: 100, rawScore: 0, verdict: "Insufficient Data", verdictColor: "amber",
        summary: `Need at least ${formation + skip + 2} quarters of price history (have ${prices.length}).`,
        criteria: [], series: [], generatedAt: new Date().toISOString(),
      };
    }

    const latestPrice = prices[prices.length - 1];
    const skippedPrice = prices[prices.length - 1 - skip];
    const startPrice = prices[Math.max(0, prices.length - 1 - skip - formation)];

    const momentum = startPrice > 0 && skippedPrice > 0 ? skippedPrice / startPrice - 1 : null;
    const shortTerm = skippedPrice > 0 && latestPrice > 0 ? latestPrice / skippedPrice - 1 : null;

    // Realised volatility of quarterly returns (annualised with 4 periods)
    const rets: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      if (prices[i - 1] > 0) rets.push(prices[i] / prices[i - 1] - 1);
    }
    const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
    const variance = rets.length > 1
      ? rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1)
      : 0;
    const volatility = Math.sqrt(variance * 4);

    // Earnings-quality overlay: gross margin expansion ("smooth" momentum)
    const latest = windowed[windowed.length - 1];
    const prior = windowed[windowed.length - 5];
    const gm = (q: FinancialQuarter | undefined) => {
      if (!q) return null;
      const r = num(q.revenue);
      const g = num(q.grossProfit);
      return r && g !== null ? g / r : null;
    };
    const gmLatest = gm(latest);
    const gmPrior = gm(prior);
    const marginExpansion = gmLatest !== null && gmPrior !== null ? gmLatest - gmPrior : null;

    const momentumScore = momentum === null
      ? 50
      : Math.max(0, Math.min(100, 50 + momentum * 100));
    const volPenalty = volatility > maxVol ? (volatility - maxVol) * 50 : 0;
    const qualityBonus = marginExpansion !== null && marginExpansion > 0 ? 5 : 0;
    const score = Math.round(Math.max(0, Math.min(100, momentumScore - volPenalty + qualityBonus)));

    let verdict: StrategyResult["verdict"] = "Weak";
    let verdictColor: StrategyResult["verdictColor"] = "negative";
    if (score >= strongThreshold) { verdict = "Strong"; verdictColor = "positive"; }
    else if (score >= moderateThreshold) { verdict = "Moderate"; verdictColor = "amber"; }

    const criteria: StrategyCriterion[] = [
      {
        key: "momentum",
        label: `${formation}−${skip} Period Momentum`,
        category: "Momentum",
        pass: momentum !== null ? momentum >= minMomentum : null,
        value: momentum,
        threshold: `≥ ${(minMomentum * 100).toFixed(0)}%`,
        weight: 3,
        explanation:
          "Intermediate-horizon winners keep winning: buying the top decile of 12-month returns earned abnormal profits for a decade after publication.",
      },
      {
        key: "short_term_reversal",
        label: "Most Recent Period Return (reversal check)",
        category: "Momentum",
        pass: shortTerm !== null ? shortTerm >= 0 : null,
        value: shortTerm,
        threshold: "≥ 0 (no sharp reversal)",
        weight: 1,
        explanation:
          "A sharp one-month reversal often signals a momentum crash setup; the classic signal skips the most recent month for this reason.",
      },
      {
        key: "volatility",
        label: "Realised Volatility (annualised)",
        category: "Risk",
        pass: volatility <= maxVol,
        value: volatility,
        threshold: `≤ ${(maxVol * 100).toFixed(0)}%`,
        weight: 1,
        explanation:
          "High-volatility momentum underperforms (Daniel & Moskowitz 2016); volatility scaling improves the risk-adjusted momentum signal.",
      },
      {
        key: "margin_expansion",
        label: "Earnings Quality — Gross Margin Expansion",
        category: "Quality",
        pass: marginExpansion !== null ? marginExpansion > 0 : null,
        value: marginExpansion,
        threshold: "> 0",
        weight: 1,
        explanation:
          "'Frog in the pan' momentum (driven by news) decays faster than 'smooth' momentum backed by improving fundamentals (Da, Gurun & Warachka 2014).",
      },
    ];

    const series: StrategySeriesPoint[] = windowed.map((q, i) => {
      const price = closes[i];
      const base = i >= formation ? closes[i - formation] : null;
      return {
        label: quarterLabel(q),
        closePrice: price,
        momentum: price !== null && base !== null && base > 0 ? Number((price / base - 1).toFixed(4)) : null,
      };
    });

    const summary =
      `Momentum ${momentum !== null ? (momentum * 100).toFixed(1) + "%" : "n/a"} over ${formation} quarters ` +
      `(skipping ${skip}), realised volatility ${(volatility * 100).toFixed(1)}%. ` +
      "Price history is quarterly; ingest daily bars for the exact 12−1 monthly computation.";

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
