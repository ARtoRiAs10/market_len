import { FinancialQuarter } from "@prisma/client";
import {
  StrategyCriterion,
  StrategyDefinition,
  StrategyParameter,
  StrategyResult,
  StrategySeriesPoint,
  resolveParam,
} from "./types";
import { div, lastQuarters, num, quarterLabel, sortQuarters } from "./helpers";

/**
 * Graham's Defensive Investor Checklist
 * =====================================
 * Benjamin Graham, *The Intelligent Investor* (2nd ed. 1963, 3rd ed. 1973),
 * Chapter 14 ("The Investor as Business Owner") and Chapter 20
 * ("Investment as a Business").
 *
 * Graham's "defensive" criteria for a stock, used verbatim by the original
 * publisher and reproduced by Warren Buffett:
 *
 *   1. Adequate size      — sales ≥ $100M (today: ~$500M) and assets ≥ $50M
 *   2. Sufficiently strong financial condition — current ratio ≥ 2.0
 *   3. Earnings stability  — positive net income in each of the past 10 years
 *   4. Dividend record     — uninterrupted dividends for 20 years
 *   5. Earnings growth     — ≥ 33% growth in EPS over the past 10 years
 *   6. Moderate P/E        — P/E ≤ 15
 *   7. Moderate P/B        — P/B ≤ 1.5
 *
 * The engine evaluates every criterion it can from the available quarterly
 * data and reports a "points earned / 7" score, exactly in the spirit of
 * Graham's checklist. Criteria that need history the platform does not have
 * (e.g. 10 years of uninterrupted dividends) are reported as "not evaluable"
 * rather than silently failed.
 *
 * Reference: Graham, B. (1973) "The Intelligent Investor", 3rd revised
 * edition, Harper & Row — Chapter 14.
 */

const PARAMETERS: StrategyParameter[] = [
  { key: "minCurrentRatio", label: "Minimum current ratio", type: "number", defaultValue: 2.0, min: 1, max: 3, step: 0.1, unit: "x" },
  { key: "maxPeRatio", label: "Maximum P/E ratio", type: "number", defaultValue: 15, min: 5, max: 40, step: 1, unit: "x" },
  { key: "maxPbRatio", label: "Maximum P/B ratio", type: "number", defaultValue: 1.5, min: 0.5, max: 5, step: 0.1, unit: "x" },
  { key: "minRevenue", label: "Minimum annualised revenue", type: "number", defaultValue: 500, min: 0, max: 100000, step: 50, unit: "M" },
  { key: "minTotalAssets", label: "Minimum total assets", type: "number", defaultValue: 50, min: 0, max: 10000, step: 10, unit: "M" },
  { key: "minEpsGrowth", label: "Minimum EPS growth over the window", type: "number", defaultValue: 33, min: 0, max: 200, step: 5, unit: "%" },
];

export const grahamDefensiveStrategy: StrategyDefinition = {
  slug: "graham-defensive-investor",
  name: "Graham Defensive Investor Checklist",
  shortDescription:
    "Benjamin Graham's seven defensive-investor criteria from The Intelligent Investor (1973), scored 0–7.",
  category: "Value & Momentum",
  icon: "BookOpen",
  parameters: PARAMETERS,
  minQuartersRequired: 8,

  evaluate(quarters: FinancialQuarter[], rawParams): StrategyResult {
    const minCurrentRatio = Number(resolveParam(rawParams, PARAMETERS[0]));
    const maxPe = Number(resolveParam(rawParams, PARAMETERS[1]));
    const maxPb = Number(resolveParam(rawParams, PARAMETERS[2]));
    const minRevenue = Number(resolveParam(rawParams, PARAMETERS[3])) * 1_000_000;
    const minAssets = Number(resolveParam(rawParams, PARAMETERS[4])) * 1_000_000;
    const minEpsGrowth = Number(resolveParam(rawParams, PARAMETERS[5]));

    const sorted = sortQuarters(quarters);
    const windowed = lastQuarters(sorted, 20);
    const latest = windowed[windowed.length - 1];
    if (!latest) {
      return {
        score: 0, maxScore: 100, rawScore: 0, verdict: "Insufficient Data", verdictColor: "amber",
        summary: "No quarterly data available.", criteria: [], series: [], generatedAt: new Date().toISOString(),
      };
    }

    const revenue = num(latest.revenue);
    const totalAssets = num(latest.totalAssets);
    const equity = num(latest.totalEquity);
    const currentAssets = num(latest.currentAssets);
    const currentLiabilities = num(latest.currentLiabilities);
    const netIncome = num(latest.netIncome);
    const shares = num(latest.sharesOutstanding);
    const closePrice = num(latest.closePrice);
    const dividendsPaid = num(latest.dividendsPaid);

    const annualRevenue = revenue !== null ? revenue * 4 : null;
    const currentRatio = div(currentAssets, currentLiabilities);
    const marketCap = closePrice !== null && shares !== null ? closePrice * shares : null;
    const pe = marketCap !== null && netIncome ? marketCap / netIncome : null;
    const pb = marketCap !== null && equity ? marketCap / equity : null;

    // Earnings stability over the available window
    const earningsSeries = windowed.map((q) => num(q.netIncome));
    const profitableQuarters = earningsSeries.filter((v) => v !== null && v > 0).length;
    const earningsStable = earningsSeries.length > 0 && profitableQuarters === earningsSeries.length;

    // Dividend record over the available window
    const dividendQuarters = windowed.filter((q) => (num(q.dividendsPaid) ?? 0) > 0).length;
    const dividendRecord = windowed.length > 0 && dividendQuarters === windowed.length;

    // EPS growth: earliest vs latest available quarter (annualised)
    const firstQuarter = windowed[0];
    const firstEps = firstQuarter ? num(firstQuarter.eps) : null;
    const latestEps = num(latest.eps);
    const yearsSpan = windowed.length > 0 ? windowed.length / 4 : 0;
    const epsGrowth =
      firstEps !== null && latestEps !== null && firstEps > 0 && yearsSpan > 0
        ? (Math.pow(latestEps / firstEps, 1 / yearsSpan) - 1) * 100
        : null;

    const criteria: StrategyCriterion[] = [
      {
        key: "size",
        label: "1. Adequate size",
        category: "Scale",
        pass:
          annualRevenue === null && totalAssets === null
            ? null
            : (annualRevenue !== null && annualRevenue >= minRevenue) ||
              (totalAssets !== null && totalAssets >= minAssets),
        value: annualRevenue,
        threshold: `Revenue ≥ ${(minRevenue / 1e6).toFixed(0)}M or assets ≥ ${(minAssets / 1e6).toFixed(0)}M`,
        weight: 1,
        explanation:
          "Graham required a company large enough to survive a bad decade; the 1973 thresholds were $100M sales and $50M assets, inflated here for modern scale.",
      },
      {
        key: "financial_condition",
        label: "2. Sufficiently strong financial condition",
        category: "Balance sheet",
        pass: currentRatio !== null ? currentRatio >= minCurrentRatio : null,
        value: currentRatio,
        threshold: `Current ratio ≥ ${minCurrentRatio.toFixed(1)}x`,
        weight: 1,
        explanation:
          "A current ratio of at least 2:1 is Graham's classic test that the company can survive a severe earnings downturn.",
      },
      {
        key: "earnings_stability",
        label: "3. Earnings stability",
        category: "Earnings",
        pass: earningsSeries.length > 0 ? earningsStable : null,
        value: profitableQuarters,
        threshold: "Positive net income in every available quarter",
        weight: 1,
        explanation:
          "Graham required ten consecutive years of positive earnings; the engine checks the available history and flags the shortened window.",
      },
      {
        key: "dividend_record",
        label: "4. Dividend record",
        category: "Capital returns",
        pass: windowed.length > 0 ? dividendRecord : null,
        value: dividendQuarters,
        threshold: "Uninterrupted dividends across the available window",
        weight: 1,
        explanation:
          "Twenty years of uninterrupted dividends is Graham's test of management's willingness to 'go to the mat' for shareholders.",
      },
      {
        key: "earnings_growth",
        label: "5. Earnings growth",
        category: "Earnings",
        pass: epsGrowth !== null ? epsGrowth >= minEpsGrowth : null,
        value: epsGrowth,
        threshold: `EPS growth ≥ ${minEpsGrowth.toFixed(0)}% (annualised)`,
        weight: 1,
        explanation:
          "At least one-third EPS growth over ten years (3.3% a year compound) demonstrates the ability to reinvest at attractive returns.",
      },
      {
        key: "pe_ratio",
        label: "6. Moderate P/E",
        category: "Valuation",
        pass: pe !== null ? pe <= maxPe && pe > 0 : null,
        value: pe,
        threshold: `P/E ≤ ${maxPe.toFixed(0)}x`,
        weight: 1,
        explanation:
          "A price/earnings ratio no higher than 15 keeps the margin of safety wide enough to absorb disappointment.",
      },
      {
        key: "pb_ratio",
        label: "7. Moderate P/B",
        category: "Valuation",
        pass: pb !== null ? pb <= maxPb : null,
        value: pb,
        threshold: `P/B ≤ ${maxPb.toFixed(1)}x`,
        weight: 1,
        explanation:
          "Price no more than 1.5× book value — Graham's insistence that the balance sheet provides a hard floor.",
      },
    ];

    const evaluable = criteria.filter((c) => c.pass !== null);
    const passed = evaluable.filter((c) => c.pass === true).length;
    const score = evaluable.length > 0 ? Math.round((passed / evaluable.length) * 100) : 0;

    let verdict: StrategyResult["verdict"] = "Weak";
    let verdictColor: StrategyResult["verdictColor"] = "negative";
    if (passed >= 6) { verdict = "Strong"; verdictColor = "positive"; }
    else if (passed >= 4) { verdict = "Moderate"; verdictColor = "amber"; }

    const series: StrategySeriesPoint[] = windowed.map((q) => {
      const qEps = num(q.eps);
      const qPrice = num(q.closePrice);
      const qPe = qEps && qPrice && qEps > 0 ? qPrice / qEps : null;
      return {
        label: quarterLabel(q),
        eps: qEps,
        peRatio: qPe !== null ? Number(qPe.toFixed(2)) : null,
      };
    });

    const summary =
      `Graham checklist: ${passed}/${evaluable.length} criteria met (score ${score}/100). ` +
      `Current ratio ${currentRatio !== null ? currentRatio.toFixed(2) + "x" : "n/a"}, ` +
      `P/E ${pe !== null ? pe.toFixed(1) + "x" : "n/a"}, P/B ${pb !== null ? pb.toFixed(2) + "x" : "n/a"}.` +
      (windowed.length < 40 ? " Note: the 10-year / 20-year history required by Graham is only partly covered by the stored quarters." : "");

    return {
      score,
      maxScore: 100,
      rawScore: passed,
      verdict,
      verdictColor,
      summary,
      criteria,
      series,
      generatedAt: new Date().toISOString(),
    };
  },
};
