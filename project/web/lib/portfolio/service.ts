import { prisma } from "@/lib/db";
import { simpleReturns } from "@/lib/quant/stats";
import {
  correlationMatrix,
  computeRiskMetrics,
  cumulativeIndex,
  portfolioReturnSeries,
  riskContributions,
  shrinkageCovariance,
  RiskMetrics,
} from "@/lib/quant/risk";
import { brinsonAttribution, AttributionResult } from "@/lib/quant/attribution";

/**
 * Portfolio Service
 * =================
 * Shared data-access + analytics layer for portfolios. Every API route and
 * the Portfolio Studio page read from here so the numbers are identical
 * everywhere (a common source of bugs in analytics products).
 */

export interface PortfolioLoadResult {
  portfolio: {
    id: string;
    name: string;
    description: string | null;
    baseCurrency: string;
    benchmarkTicker: string | null;
    cashBalance: number;
    createdAt: Date;
  };
  positions: {
    ticker: string;
    name: string;
    sector: string | null;
    shares: number;
    targetWeight: number | null;
    lastPrice: number | null;
    marketValue: number;
    weight: number;
    costBasis: number | null;
  }[];
  totalValue: number;
  cashValue: number;
}

export interface ReturnData {
  tickers: string[];
  weights: number[];
  /** Return series per asset (oldest → newest). */
  series: number[][];
  /** Dates of the observations (ISO strings) when price data is available. */
  dates: string[];
  frequency: "daily" | "quarterly";
  /** Portfolio return series. */
  portfolioReturns: number[];
  /** Benchmark return series (aligned). */
  benchmarkReturns: number[];
  /** Benchmark ticker used (null when none). */
  benchmarkTicker: string | null;
  /** True when the series was reconstructed from quarterly close prices. */
  approximated: boolean;
}

/** Load a portfolio with its positions priced at the latest available close. */
export async function loadPortfolio(userId: string, portfolioId: string): Promise<PortfolioLoadResult | null> {
  const portfolio = await prisma.portfolio.findFirst({
    where: { id: portfolioId, userId },
    include: {
      positions: {
        include: { company: true },
        orderBy: { ticker: "asc" },
      },
    },
  });
  if (!portfolio) return null;

  const tickers = portfolio.positions.map((p) => p.ticker.toUpperCase());

  const [latestBars, companies] = await Promise.all([
    tickers.length
      ? prisma.priceBar.findMany({
          where: { ticker: { in: tickers } },
          orderBy: [{ ticker: "asc" }, { date: "desc" }],
        })
      : Promise.resolve([]),
    tickers.length
      ? prisma.company.findMany({
          where: { ticker: { in: tickers } },
          include: {
            quarters: { orderBy: [{ fiscalYear: "asc" }, { fiscalQuarter: "asc" }] },
          },
        })
      : Promise.resolve([]),
  ]);

  const lastPriceByTicker = new Map<string, number>();
  const seen = new Set<string>();
  for (const bar of latestBars) {
    if (seen.has(bar.ticker)) continue;
    seen.add(bar.ticker);
    const close = Number(bar.adjClose ?? bar.close ?? 0);
    if (close > 0) lastPriceByTicker.set(bar.ticker, close);
  }

  const quarterPriceByTicker = new Map<string, number>();
  for (const company of companies) {
    const latest = company.quarters[company.quarters.length - 1];
    if (latest?.closePrice) quarterPriceByTicker.set(company.ticker, Number(latest.closePrice));
  }

  const positions = portfolio.positions.map((p) => {
    const ticker = p.ticker.toUpperCase();
    const price = lastPriceByTicker.get(ticker) ?? quarterPriceByTicker.get(ticker) ?? null;
    const shares = Number(p.shares);
    const marketValue = price !== null ? shares * price : 0;
    return {
      ticker,
      name: p.company?.name ?? ticker,
      sector: p.company?.sector ?? null,
      shares,
      targetWeight: p.targetWeight !== null ? Number(p.targetWeight) : null,
      lastPrice: price,
      marketValue,
      weight: 0,
      costBasis: null,
    };
  });

  const totalValue = positions.reduce((a, p) => a + p.marketValue, 0);
  const cashValue = Number(portfolio.cashBalance);
  const denominator = totalValue + cashValue;
  for (const p of positions) {
    p.weight = denominator > 0 ? p.marketValue / denominator : 0;
  }

  return {
    portfolio: {
      id: portfolio.id,
      name: portfolio.name,
      description: portfolio.description,
      baseCurrency: portfolio.baseCurrency,
      benchmarkTicker: portfolio.benchmarkTicker,
      cashBalance: cashValue,
      createdAt: portfolio.createdAt,
    },
    positions,
    totalValue,
    cashValue,
  };
}

/**
 * Build aligned return series for the portfolio.
 *
 * Daily bars are used when available; otherwise the series is reconstructed
 * from the quarterly close prices stored on the fact table and the caller is
 * told the data is approximated.
 */
export async function buildReturnData(
  loaded: PortfolioLoadResult,
  benchmarkTicker?: string | null
): Promise<ReturnData> {
  const tickers = loaded.positions.map((p) => p.ticker);
  const weights = loaded.positions.map((p) => p.weight);
  const benchmark = benchmarkTicker ?? loaded.portfolio.benchmarkTicker ?? null;

  if (tickers.length === 0) {
    return {
      tickers, weights, series: [], dates: [], frequency: "daily",
      portfolioReturns: [], benchmarkReturns: [], benchmarkTicker: benchmark, approximated: false,
    };
  }

  // ── Daily bars ──────────────────────────────────────────────────────────
  const bars = await prisma.priceBar.findMany({
    where: { ticker: { in: [...tickers, ...(benchmark ? [benchmark] : [])] } },
    orderBy: [{ ticker: "asc" }, { date: "asc" }],
  });

  const byTicker = new Map<string, { date: Date; close: number }[]>();
  for (const bar of bars) {
    const close = Number(bar.adjClose ?? bar.close ?? 0);
    if (!(close > 0)) continue;
    if (!byTicker.has(bar.ticker)) byTicker.set(bar.ticker, []);
    byTicker.get(bar.ticker)!.push({ date: bar.date, close });
  }

  const allDates = Array.from(
    new Set(bars.map((b) => b.date.getTime()))
  ).sort((a, b) => a - b);

  const hasDaily = allDates.length >= 20 && tickers.every((t) => (byTicker.get(t)?.length ?? 0) >= 20);

  if (hasDaily) {
    const dateIndex = new Map(allDates.map((d, i) => [d, i]));
    const series = tickers.map((t) => {
      const rows = byTicker.get(t) ?? [];
      const map = new Map(rows.map((r) => [r.date.getTime(), r.close]));
      const prices = allDates.map((d) => map.get(d) ?? null);
      return fillForward(prices);
    });

    let benchmarkReturns: number[] = [];
    if (benchmark) {
      const rows = byTicker.get(benchmark) ?? [];
      const map = new Map(rows.map((r) => [r.date.getTime(), r.close]));
      const prices = allDates.map((d) => map.get(d) ?? null);
      benchmarkReturns = simpleReturns(fillForward(prices));
    }

    return {
      tickers,
      weights,
      series: series.map((prices) => simpleReturns(prices)),
      dates: allDates.map((d) => new Date(d).toISOString()),
      frequency: "daily",
      portfolioReturns: portfolioReturnSeries(weights, series.map((p) => simpleReturns(p))),
      benchmarkReturns,
      benchmarkTicker: benchmark,
      approximated: false,
    };
  }

  // ── Fallback: quarterly closes from the fact table ──────────────────────
  const companies = await prisma.company.findMany({
    where: { ticker: { in: tickers } },
    include: { quarters: { orderBy: [{ fiscalYear: "asc" }, { fiscalQuarter: "asc" }] } },
  });
  const quarterSeries = companies.map((c) =>
    c.quarters.map((q) => Number(q.closePrice ?? 0)).filter((v) => v > 0)
  );
  const length = Math.min(...quarterSeries.map((s) => s.length));
  const trimmed = quarterSeries.map((s) => s.slice(-length));

  let benchmarkReturns: number[] = [];
  if (benchmark) {
    const benchCompany = await prisma.company.findUnique({
      where: { ticker: benchmark },
      include: { quarters: { orderBy: [{ fiscalYear: "asc" }, { fiscalQuarter: "asc" }] } },
    });
    const prices = (benchCompany?.quarters ?? [])
      .map((q) => Number(q.closePrice ?? 0))
      .filter((v) => v > 0)
      .slice(-length);
    benchmarkReturns = simpleReturns(prices);
  }

  return {
    tickers,
    weights,
    series: trimmed.map((p) => simpleReturns(p)),
    dates: [],
    frequency: "quarterly",
    portfolioReturns: portfolioReturnSeries(weights, trimmed.map((p) => simpleReturns(p))),
    benchmarkReturns,
    benchmarkTicker: benchmark,
    approximated: true,
  };
}

/** Forward-fill a price vector, dropping leading nulls. */
function fillForward(prices: (number | null)[]): number[] {
  const out: number[] = [];
  let last: number | null = null;
  for (const p of prices) {
    if (p !== null) last = p;
    if (last !== null) out.push(last);
  }
  return out;
}

/**
 * Build aligned return series for an arbitrary basket of tickers (used by
 * the optimizer and the risk workbench, which work on a universe rather than
 * a saved portfolio).
 */
export async function buildReturnDataForTickers(
  tickers: string[],
  benchmarkTicker?: string | null
): Promise<ReturnData> {
  const upper = tickers.map((t) => t.toUpperCase());
  const weights = upper.map(() => 1 / Math.max(upper.length, 1));

  if (upper.length === 0) {
    return {
      tickers: [], weights: [], series: [], dates: [], frequency: "daily",
      portfolioReturns: [], benchmarkReturns: [], benchmarkTicker: benchmarkTicker ?? null,
      approximated: false,
    };
  }

  const bars = await prisma.priceBar.findMany({
    where: { ticker: { in: [...upper, ...(benchmarkTicker ? [benchmarkTicker] : [])] } },
    orderBy: [{ ticker: "asc" }, { date: "asc" }],
  });

  const byTicker = new Map<string, { date: Date; close: number }[]>();
  for (const bar of bars) {
    const close = Number(bar.adjClose ?? bar.close ?? 0);
    if (!(close > 0)) continue;
    if (!byTicker.has(bar.ticker)) byTicker.set(bar.ticker, []);
    byTicker.get(bar.ticker)!.push({ date: bar.date, close });
  }

  const allDates = Array.from(new Set(bars.map((b) => b.date.getTime()))).sort((a, b) => a - b);
  const hasDaily = allDates.length >= 20 && upper.every((t) => (byTicker.get(t)?.length ?? 0) >= 20);

  if (hasDaily) {
    const series = upper.map((t) => {
      const rows = byTicker.get(t) ?? [];
      const map = new Map(rows.map((r) => [r.date.getTime(), r.close]));
      return fillForward(allDates.map((d) => map.get(d) ?? null));
    });

    let benchmarkReturns: number[] = [];
    if (benchmarkTicker) {
      const rows = byTicker.get(benchmarkTicker) ?? [];
      const map = new Map(rows.map((r) => [r.date.getTime(), r.close]));
      benchmarkReturns = simpleReturns(fillForward(allDates.map((d) => map.get(d) ?? null)));
    }

    return {
      tickers: upper,
      weights,
      series: series.map((p) => simpleReturns(p)),
      dates: allDates.map((d) => new Date(d).toISOString()),
      frequency: "daily",
      portfolioReturns: portfolioReturnSeries(weights, series.map((p) => simpleReturns(p))),
      benchmarkReturns,
      benchmarkTicker: benchmarkTicker ?? null,
      approximated: false,
    };
  }

  // Fallback to quarterly closes
  const companies = await prisma.company.findMany({
    where: { ticker: { in: upper } },
    include: { quarters: { orderBy: [{ fiscalYear: "asc" }, { fiscalQuarter: "asc" }] } },
  });
  const quarterSeries = companies.map((c) =>
    c.quarters.map((q) => Number(q.closePrice ?? 0)).filter((v) => v > 0)
  );
  const length = Math.min(...quarterSeries.map((s) => s.length));
  const trimmed = quarterSeries.map((s) => s.slice(-length));

  let benchmarkReturns: number[] = [];
  if (benchmarkTicker) {
    const benchCompany = await prisma.company.findUnique({
      where: { ticker: benchmarkTicker.toUpperCase() },
      include: { quarters: { orderBy: [{ fiscalYear: "asc" }, { fiscalQuarter: "asc" }] } },
    });
    const prices = (benchCompany?.quarters ?? [])
      .map((q) => Number(q.closePrice ?? 0))
      .filter((v) => v > 0)
      .slice(-length);
    benchmarkReturns = simpleReturns(prices);
  }

  return {
    tickers: upper,
    weights,
    series: trimmed.map((p) => simpleReturns(p)),
    dates: [],
    frequency: "quarterly",
    portfolioReturns: portfolioReturnSeries(weights, trimmed.map((p) => simpleReturns(p))),
    benchmarkReturns,
    benchmarkTicker: benchmarkTicker ?? null,
    approximated: true,
  };
}

export interface PortfolioAnalytics {
  metrics: RiskMetrics;
  equityCurve: { label: string; value: number; benchmark: number | null; drawdown: number }[];
  allocation: { ticker: string; name: string; sector: string | null; weight: number; marketValue: number }[];
  sectorAllocation: { sector: string; weight: number }[];
  riskContributions: { name: string; weight: number; percentOfRisk: number }[];
  correlation: { names: string[]; matrix: (number | null)[][] };
  attribution: AttributionResult | null;
  frequency: "daily" | "quarterly";
  approximated: boolean;
  observations: number;
}

/** Full analytics bundle for a portfolio. */
export async function computePortfolioAnalytics(
  loaded: PortfolioLoadResult,
  benchmarkTicker?: string | null
): Promise<PortfolioAnalytics> {
  const data = await buildReturnData(loaded, benchmarkTicker);

  const metrics = computeRiskMetrics(data.portfolioReturns, {
    benchmark: data.benchmarkReturns.length === data.portfolioReturns.length ? data.benchmarkReturns : undefined,
    frequency: data.frequency,
    riskFreeRate: 0.04,
  });

  const nav = cumulativeIndex(data.portfolioReturns);
  const benchNav = data.benchmarkReturns.length === data.portfolioReturns.length
    ? cumulativeIndex(data.benchmarkReturns)
    : [];

  let peak = nav[0] ?? 100;
  const equityCurve = nav.slice(1).map((value, i) => {
    peak = Math.max(peak, value);
    return {
      label: data.dates[i + 1]
        ? new Date(data.dates[i + 1]).toISOString().slice(0, 10)
        : `T${i + 1}`,
      value: Number(value.toFixed(2)),
      benchmark: benchNav[i + 1] !== undefined ? Number(benchNav[i + 1].toFixed(2)) : null,
      drawdown: Number((peak > 0 ? value / peak - 1 : 0).toFixed(4)),
    };
  });

  const allocation = loaded.positions.map((p) => ({
    ticker: p.ticker,
    name: p.name,
    sector: p.sector,
    weight: p.weight,
    marketValue: p.marketValue,
  }));

  const sectorMap = new Map<string, number>();
  for (const a of allocation) {
    const s = a.sector ?? "Unclassified";
    sectorMap.set(s, (sectorMap.get(s) ?? 0) + a.weight);
  }
  const sectorAllocation = Array.from(sectorMap.entries())
    .map(([sector, weight]) => ({ sector, weight }))
    .sort((a, b) => b.weight - a.weight);

  // Risk contributions need a covariance matrix aligned to the weights.
  const alignedWeights: number[] = [];
  const alignedSeries: number[][] = [];
  for (let i = 0; i < data.tickers.length; i++) {
    if ((data.series[i]?.length ?? 0) >= 3) {
      alignedWeights.push(data.weights[i]);
      alignedSeries.push(data.series[i]);
    }
  }
  let contributions: { name: string; weight: number; percentOfRisk: number }[] = [];
  let corr = { names: data.tickers, matrix: [] as (number | null)[][] };

  if (alignedSeries.length >= 2) {
    const cov = shrinkageCovariance(alignedSeries);
    const rc = riskContributions(alignedWeights, cov);
    contributions = rc.map((r, i) => ({
      name: data.tickers[alignedWeights.length === data.tickers.length ? i : i],
      weight: r.weight,
      percentOfRisk: r.percentOfRisk,
    }));
    corr = correlationMatrix(data.tickers, data.series);
  }

  // Brinson attribution requires a benchmark with the same assets; when the
  // benchmark is an index we attribute against an equal-weight proxy.
  let attribution: AttributionResult | null = null;
  if (data.benchmarkReturns.length === data.portfolioReturns.length && data.portfolioReturns.length > 1) {
    const periods = data.portfolioReturns.length;
    const n = data.tickers.length;
    const portfolioWeights = Array.from({ length: periods }, () => data.weights);
    const benchmarkWeights = Array.from({ length: periods }, () => new Array(n).fill(1 / n));
    const portfolioReturns = Array.from({ length: periods }, (_, t) =>
      data.series.map((s) => s[t] ?? 0)
    );
    const benchmarkReturns = Array.from({ length: periods }, (_, t) =>
      new Array(n).fill(data.benchmarkReturns[t] ?? 0)
    );
    attribution = brinsonAttribution({
      names: data.tickers,
      portfolioWeights,
      benchmarkWeights,
      portfolioReturns,
      benchmarkReturns,
    });
  }

  return {
    metrics,
    equityCurve,
    allocation,
    sectorAllocation,
    riskContributions: contributions,
    correlation: corr,
    attribution,
    frequency: data.frequency,
    approximated: data.approximated,
    observations: data.portfolioReturns.length,
  };
}
