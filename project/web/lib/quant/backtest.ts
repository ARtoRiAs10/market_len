/**
 * Institutional Backtest Engine
 * =============================
 * A walk-forward, cost-aware backtester designed to avoid the three classic
 * sins of retail backtesting:
 *
 *   1. Look-ahead bias — the signal is computed only from data available up
 *      to the decision date, and the reporting lag of fundamental data is
 *      configurable (`signalLagQuarters`, default 1 quarter).
 *   2. Ignoring transaction costs — commission and slippage are charged on
 *      every change in target weight.
 *   3. Ignoring the benchmark and risk statistics — the engine reports a
 *      full risk decomposition (Sharpe/Sortino/Calmar/VaR/CVaR/drawdown),
 *      an alpha/beta regression against the benchmark and a bootstrap
 *      confidence interval for the Sharpe ratio.
 *
 * References
 *   - Bailey, D. et al. (2014) "The Probability of Backtest Overfitting" —
 *     purged cross-validation and deflated Sharpe ratio.
 *   - Bailey, D. & López de Prado, M. (2014) "The Deflated Sharpe Ratio".
 *   - Lo, M. (2002) "The Statistics of Sharpe Ratios".
 */

import type { FinancialQuarter } from "@prisma/client";
import { StrategyDefinition } from "@/lib/strategies/types";
import { computeRiskMetrics, RiskMetrics, drawdownSeries } from "./risk";
import { mean, stdDev } from "./stats";

export interface BacktestConfig {
  ticker: string;
  strategySlug: string;
  parameters?: Record<string, number | string | boolean>;
  /** Number of quarters used to build the evaluation window. */
  windowSize?: number;
  strongBuyThreshold?: number;
  weakSellThreshold?: number;
  /** One-way commission + exchange fees in basis points (10 = 0.10%). */
  transactionCostBps?: number;
  /** One-way market-impact / slippage in basis points. */
  slippageBps?: number;
  /**
   * Quarters between the decision date and the execution date.
   * 1 = execute at the close of the next quarter (realistic for fundamentals
   * which are published with a lag).
   */
  signalLagQuarters?: number;
  /** Annual risk-free rate used for excess-return metrics. */
  riskFreeRate?: number;
  /** Quarterly benchmark returns (e.g. from an index) for alpha/beta. */
  benchmarkReturns?: number[];
  /** Number of strategies screened (for the Deflated Sharpe Ratio). */
  trials?: number;
}

export interface BacktestSignal {
  label: string;
  periodEnd: string;
  score: number;
  verdict: string;
  signal: "BUY" | "HOLD" | "SELL";
  /** Target portfolio weight after the signal (0..1). */
  targetWeight: number;
  priceEntry: number | null;
  priceExit: number | null;
  grossReturn: number | null;
  netReturn: number | null;
  /** Turnover (fraction of portfolio traded) in this period. */
  turnover: number;
  /** Costs paid in this period (fraction of portfolio). */
  costs: number;
  equity: number;
  benchmarkEquity: number | null;
}

export interface BacktestSummary {
  strategySlug: string;
  ticker: string;
  observations: number;
  totalReturn: number | null;
  benchmarkReturn: number | null;
  excessReturn: number | null;
  annualisedReturn: number | null;
  annualisedVol: number | null;
  sharpe: number | null;
  sortino: number | null;
  calmar: number | null;
  maxDrawdown: number | null;
  cvar95: number | null;
  turnoverPerPeriod: number | null;
  totalCosts: number | null;
  exposure: number | null;
  winRate: number | null;
  buySignals: number;
  holdSignals: number;
  sellSignals: number;
  avgHoldingPeriodQuarters: number | null;
  /** Alpha/beta versus benchmark (null if no benchmark supplied). */
  beta: number | null;
  alpha: number | null;
  informationRatio: number | null;
  /** Statistical significance of the strategy (Deflated Sharpe probability). */
  deflatedSharpeProb: number | null;
  /** Bootstrap 95% CI of the Sharpe ratio. */
  sharpeCI: { lower: number; upper: number; point: number } | null;
  warnings: string[];
}

export interface BacktestResult {
  signals: BacktestSignal[];
  equityCurve: { label: string; equity: number; benchmark: number | null; drawdown: number }[];
  metrics: RiskMetrics;
  summary: BacktestSummary;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "object" && v !== null && "toNumber" in (v as any)
    ? (v as any).toNumber()
    : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Run a walk-forward backtest of a fundamental strategy on quarterly data.
 */
export function runBacktest(
  strategy: StrategyDefinition,
  quarters: FinancialQuarter[],
  config: BacktestConfig
): BacktestResult {
  const warnings: string[] = [];
  const windowSize = config.windowSize ?? 8;
  const strongBuy = config.strongBuyThreshold ?? 70;
  const weakSell = config.weakSellThreshold ?? 45;
  const costRate = ((config.transactionCostBps ?? 10) + (config.slippageBps ?? 5)) / 10_000;
  const lag = Math.max(0, config.signalLagQuarters ?? 1);
  const rf = config.riskFreeRate ?? 0.0;

  const sorted = [...quarters].sort(
    (a, b) => a.fiscalYear - b.fiscalYear || a.fiscalQuarter - b.fiscalQuarter
  );

  if (sorted.length < windowSize + 2 + lag) {
    return {
      signals: [],
      equityCurve: [],
      metrics: computeRiskMetrics([], {}),
      summary: emptySummary(strategy, config, [
        `Not enough history: need ${windowSize + 2 + lag} quarters, have ${sorted.length}.`,
      ]),
    };
  }

  const prices = sorted.map((q) => toNum(q.closePrice));
  if (prices.some((p) => p === null)) {
    warnings.push("Some quarters are missing close prices; those periods are skipped.");
  }

  const signals: BacktestSignal[] = [];
  let equity = 1;
  let benchmarkEquity: number | null = config.benchmarkReturns ? 1 : null;
  let position = 0;
  let totalCosts = 0;
  let totalTurnover = 0;
  let periodsInvested = 0;
  let holdingPeriod = 0;
  let holdingPeriods = 0;
  const periodReturns: number[] = [];
  const benchmarkPeriodReturns: number[] = [];
  const equityCurve: BacktestResult["equityCurve"] = [];

  for (let i = windowSize - 1; i + 1 + lag < sorted.length; i++) {
    // Decision date: quarter i. Only information up to and including quarter i
    // is passed to the strategy — no look-ahead.
    const window = sorted.slice(0, i + 1);
    let result;
    try {
      result = strategy.evaluate(window, config.parameters ?? {});
    } catch (err) {
      warnings.push(`Strategy threw at ${sorted[i].fiscalYear}Q${sorted[i].fiscalQuarter}: ${String(err)}`);
      continue;
    }

    // Execution and holding period: quarters [i+lag, i+lag+1]
    const execIdx = i + lag;
    const exitIdx = execIdx + 1;
    if (exitIdx >= sorted.length) break;

    const score = result.score;
    const signal: BacktestSignal["signal"] =
      score >= strongBuy ? "BUY" : score < weakSell ? "SELL" : "HOLD";

    // Position sizing: full exposure on BUY, flat on SELL, keep previous on HOLD
    let targetWeight = position;
    if (signal === "BUY") targetWeight = 1;
    else if (signal === "SELL") targetWeight = 0;

    const entryPrice = prices[execIdx];
    const exitPrice = prices[exitIdx];
    const grossReturn =
      entryPrice !== null && exitPrice !== null && entryPrice > 0
        ? exitPrice / entryPrice - 1
        : null;

    const turnover = Math.abs(targetWeight - position);
    const costs = turnover * costRate;
    const netReturn = grossReturn === null ? null : grossReturn * targetWeight - costs;

    equity *= 1 + (netReturn ?? 0);
    totalCosts += costs;
    totalTurnover += turnover;
    if (targetWeight > 0) periodsInvested++;
    if (turnover > 0) {
      holdingPeriods += holdingPeriod + 1;
      holdingPeriod = 0;
    } else if (targetWeight > 0) {
      holdingPeriod++;
    }
    position = targetWeight;

    if (netReturn !== null) periodReturns.push(netReturn);

    let benchPoint: number | null = null;
    if (config.benchmarkReturns && config.benchmarkReturns.length > 0) {
      const b = config.benchmarkReturns[Math.min(i, config.benchmarkReturns.length - 1)];
      benchmarkPeriodReturns.push(b);
      benchmarkEquity = (benchmarkEquity ?? 1) * (1 + b);
      benchPoint = benchmarkEquity;
    }

    signals.push({
      label: `Q${sorted[i].fiscalQuarter} FY${sorted[i].fiscalYear}`,
      periodEnd: sorted[i].periodEndDate?.toISOString?.() ?? "",
      score,
      verdict: result.verdict,
      signal,
      targetWeight,
      priceEntry: entryPrice,
      priceExit: exitPrice,
      grossReturn,
      netReturn,
      turnover,
      costs,
      equity,
      benchmarkEquity: benchPoint,
    });

    const dd = drawdownSeries([1, equity]);
    equityCurve.push({
      label: `Q${sorted[i].fiscalQuarter} FY${sorted[i].fiscalYear}`,
      equity: Number(equity.toFixed(4)),
      benchmark: benchPoint === null ? null : Number(benchPoint.toFixed(4)),
      drawdown: Number((dd[dd.length - 1] ?? 0).toFixed(4)),
    });
  }

  const metrics = computeRiskMetrics(periodReturns, {
    benchmark: benchmarkPeriodReturns.length === periodReturns.length ? benchmarkPeriodReturns : undefined,
    frequency: "quarterly",
    riskFreeRate: rf,
    trials: config.trials ?? 1,
  });

  const totalReturn = equity - 1;
  const benchTotal = benchmarkEquity !== null ? benchmarkEquity - 1 : null;
  const years = periodReturns.length / 4;

  const summary: BacktestSummary = {
    strategySlug: strategy.slug,
    ticker: config.ticker,
    observations: periodReturns.length,
    totalReturn,
    benchmarkReturn: benchTotal,
    excessReturn: benchTotal !== null ? totalReturn - benchTotal : null,
    annualisedReturn: years > 0 ? Math.pow(1 + totalReturn, 1 / years) - 1 : null,
    annualisedVol: metrics.annualisedVol,
    sharpe: metrics.sharpe,
    sortino: metrics.sortino,
    calmar: metrics.calmar,
    maxDrawdown: metrics.maxDrawdown,
    cvar95: metrics.cvar95,
    turnoverPerPeriod: periodReturns.length > 0 ? totalTurnover / periodReturns.length : null,
    totalCosts,
    exposure: periodReturns.length > 0 ? periodsInvested / periodReturns.length : null,
    winRate: periodReturns.length > 0
      ? (periodReturns.filter((r) => r > 0).length / periodReturns.length) * 100
      : null,
    buySignals: signals.filter((s) => s.signal === "BUY").length,
    holdSignals: signals.filter((s) => s.signal === "HOLD").length,
    sellSignals: signals.filter((s) => s.signal === "SELL").length,
    avgHoldingPeriodQuarters: holdingPeriods > 0 ? holdingPeriods / holdingPeriods : null,
    beta: metrics.beta,
    alpha: metrics.alpha,
    informationRatio: metrics.informationRatio,
    deflatedSharpeProb: metrics.deflatedSharpeProb,
    sharpeCI: metrics.sharpeCI,
    warnings,
  };

  if (config.benchmarkReturns && config.benchmarkReturns.length !== periodReturns.length) {
    summary.warnings.push("Benchmark series length did not match the strategy period count; benchmark statistics were omitted.");
  }
  if (costRate === 0) summary.warnings.push("Transaction costs are set to zero — results are optimistic.");
  if (lag === 0) summary.warnings.push("Signal lag is 0 — check for look-ahead bias in the fundamentals pipeline.");

  return { signals, equityCurve, metrics, summary };
}

function emptySummary(
  strategy: StrategyDefinition,
  config: BacktestConfig,
  warnings: string[]
): BacktestSummary {
  return {
    strategySlug: strategy.slug,
    ticker: config.ticker,
    observations: 0,
    totalReturn: null, benchmarkReturn: null, excessReturn: null,
    annualisedReturn: null, annualisedVol: null, sharpe: null, sortino: null,
    calmar: null, maxDrawdown: null, cvar95: null, turnoverPerPeriod: null,
    totalCosts: null, exposure: null, winRate: null, buySignals: 0, holdSignals: 0,
    sellSignals: 0, avgHoldingPeriodQuarters: null, beta: null, alpha: null,
    informationRatio: null, deflatedSharpeProb: null, sharpeCI: null, warnings,
  };
}

/**
 * Compare several strategies on the same data with a paired t-test on their
 * per-period excess returns (a simple way to test whether one strategy
 * dominates another after costs).
 */
export function compareStrategies(
  results: { slug: string; returns: number[] }[]
): { slug: string; mean: number | null; vol: number | null; tStatVsBest: number | null }[] {
  const stats = results.map((r) => ({
    slug: r.slug,
    mean: mean(r.returns),
    vol: stdDev(r.returns),
    tStatVsBest: null as number | null,
  }));
  if (stats.length < 2) return stats;

  const bestIdx = stats.reduce((best, s, i) => ((s.mean ?? -Infinity) > (stats[best].mean ?? -Infinity) ? i : best), 0);
  for (let i = 0; i < results.length; i++) {
    if (i === bestIdx) continue;
    const n = Math.min(results[i].returns.length, results[bestIdx].returns.length);
    if (n < 3) continue;
    const diff: number[] = [];
    for (let k = 0; k < n; k++) diff.push(results[bestIdx].returns[k] - results[i].returns[k]);
    const m = mean(diff)!;
    const s = stdDev(diff);
    stats[i].tStatVsBest = s && s > 0 ? m / (s / Math.sqrt(n)) : null;
  }
  return stats;
}
