import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getStrategyBySlug } from "@/lib/strategies/registry";
import { runBacktest } from "@/lib/quant/backtest";
import { rateLimit } from "@/lib/rate-limit";
import { z } from "zod";

const backtestSchema = z.object({
  strategySlug: z.string(),
  ticker: z.string().min(1).max(10),
  parameters: z.record(z.union([z.number(), z.string(), z.boolean()])).default({}),
  strongBuyThreshold: z.number().default(70),
  weakSellThreshold: z.number().default(45),
  windowSize: z.number().min(4).max(12).default(8),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limited = rateLimit(`backtest:${session.user.id}`, { limit: 10, windowMs: 60_000 });
  if (!limited.success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const body = await req.json().catch(() => null);
  const parsed = backtestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const { strategySlug, ticker, parameters, strongBuyThreshold, weakSellThreshold, windowSize } = parsed.data;
  const strategy = getStrategyBySlug(strategySlug);
  if (!strategy) return NextResponse.json({ error: "Strategy not found" }, { status: 404 });

  const company = await prisma.company.findUnique({
    where: { ticker: ticker.toUpperCase() },
    include: { quarters: { orderBy: [{ fiscalYear: "asc" }, { fiscalQuarter: "asc" }] } },
  });
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  const quarters = company.quarters;
  if (quarters.length < windowSize + 2) {
    return NextResponse.json({ error: `Need at least ${windowSize + 2} quarters. Have ${quarters.length}.` }, { status: 422 });
  }

  // Institutional walk-forward backtest: the signal is computed only from
  // data available at the decision date, transaction costs are charged on
  // every rebalance, and a full risk decomposition is returned.
  const result = runBacktest(strategy, quarters, {
    ticker: company.ticker,
    strategySlug,
    parameters,
    windowSize,
    strongBuyThreshold: strongBuyThreshold,
    weakSellThreshold: weakSellThreshold,
    transactionCostBps: 10,
    slippageBps: 5,
    signalLagQuarters: 1,
    riskFreeRate: 0.04,
  });

  if (result.signals.length === 0) {
    return NextResponse.json(
      { error: "Not enough history to run the backtest.", warnings: result.summary.warnings },
      { status: 422 }
    );
  }

  const signals = result.signals.map((s) => ({
    label: s.label,
    score: s.score,
    verdict: s.verdict,
    signal: s.signal,
    priceEntry: s.priceEntry,
    priceExit: s.priceExit,
    quarterReturn: s.grossReturn,
    netReturn: s.netReturn,
    costs: s.costs,
  }));

  const portfolioSeries = result.equityCurve.map((p) => ({
    label: p.label,
    portfolio: Number((p.equity * 100).toFixed(2)),
    buyHold: p.benchmark !== null ? Number((p.benchmark * 100).toFixed(2)) : 100,
    signal: signals.find((s) => s.label === p.label)?.signal ?? "HOLD",
    score: signals.find((s) => s.label === p.label)?.score ?? 0,
  }));

  const finalPortfolioValue = (result.equityCurve.at(-1)?.equity ?? 1) * 100;
  const finalBuyHoldValue = (result.equityCurve.at(-1)?.benchmark ?? 1) * 100;

  return NextResponse.json({
    ticker: company.ticker, name: company.name, strategyName: strategy.name,
    signals, portfolioSeries,
    summary: {
      totalQuarters: result.summary.observations,
      buySignals: result.summary.buySignals,
      sellSignals: result.summary.sellSignals,
      holdSignals: result.summary.holdSignals,
      finalPortfolioValue: Number(finalPortfolioValue.toFixed(2)),
      finalBuyHoldValue: Number(finalBuyHoldValue.toFixed(2)),
      outperformance: Number((finalPortfolioValue - finalBuyHoldValue).toFixed(2)),
      avgBuyReturn: null,
      winRate: result.summary.winRate !== null ? Number((result.summary.winRate * 100).toFixed(1)) : null,
    },
    risk: {
      totalReturn: result.summary.totalReturn,
      annualisedReturn: result.summary.annualisedReturn,
      annualisedVol: result.summary.annualisedVol,
      sharpe: result.summary.sharpe,
      sortino: result.summary.sortino,
      calmar: result.summary.calmar,
      maxDrawdown: result.summary.maxDrawdown,
      cvar95: result.summary.cvar95,
      turnoverPerPeriod: result.summary.turnoverPerPeriod,
      totalCosts: result.summary.totalCosts,
      exposure: result.summary.exposure,
      deflatedSharpeProb: result.summary.deflatedSharpeProb,
      sharpeCI: result.summary.sharpeCI,
    },
    warnings: result.summary.warnings,
  });
}
