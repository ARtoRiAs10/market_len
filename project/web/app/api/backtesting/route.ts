import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getStrategyBySlug } from "@/lib/strategies/registry";
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

  // Walk-forward backtest: at each quarter, evaluate strategy on the previous `windowSize` quarters,
  // record the signal, then measure price return over the NEXT quarter.
  const signals: { label: string; score: number; verdict: string; signal: string; priceEntry: number | null; priceExit: number | null; quarterReturn: number | null }[] = [];

  for (let i = windowSize; i < quarters.length - 1; i++) {
    const window = quarters.slice(i - windowSize, i);
    const nextQ = quarters[i + 1];
    let result;
    try { result = strategy.evaluate(window, parameters); } catch { continue; }

    const signal = result.score >= strongBuyThreshold ? "BUY" : result.score < weakSellThreshold ? "SELL" : "HOLD";
    const priceEntry = window[window.length - 1].closePrice ? Number(window[window.length - 1].closePrice) : null;
    const priceExit = nextQ.closePrice ? Number(nextQ.closePrice) : null;
    const quarterReturn = priceEntry && priceExit && priceEntry > 0 ? (priceExit - priceEntry) / priceEntry : null;

    signals.push({ label: `Q${quarters[i].fiscalQuarter} FY${quarters[i].fiscalYear}`, score: result.score, verdict: result.verdict, signal, priceEntry, priceExit, quarterReturn });
  }

  // Compute hypothetical portfolio vs buy-and-hold
  let portfolioValue = 100, buyHoldValue = 100;
  let inPosition = false;
  const portfolioSeries: { label: string; portfolio: number; buyHold: number; signal: string; score: number }[] = [];

  const firstPrice = signals[0]?.priceEntry ?? 1;

  for (const s of signals) {
    const bhReturn = s.quarterReturn ?? 0;
    buyHoldValue = buyHoldValue * (1 + bhReturn);

    if (s.signal === "BUY") { inPosition = true; }
    else if (s.signal === "SELL") { inPosition = false; }

    if (inPosition && s.quarterReturn !== null) {
      portfolioValue = portfolioValue * (1 + s.quarterReturn);
    }
    portfolioSeries.push({ label: s.label, portfolio: Number(portfolioValue.toFixed(2)), buyHold: Number(buyHoldValue.toFixed(2)), signal: s.signal, score: s.score });
  }

  const buySignals = signals.filter(s => s.signal === "BUY");
  const avgBuyReturn = buySignals.length > 0 ? buySignals.reduce((a, s) => a + (s.quarterReturn ?? 0), 0) / buySignals.length : null;
  const winRate = buySignals.length > 0 ? buySignals.filter(s => (s.quarterReturn ?? 0) > 0).length / buySignals.length : null;

  return NextResponse.json({
    ticker: company.ticker, name: company.name, strategyName: strategy.name,
    signals, portfolioSeries,
    summary: {
      totalQuarters: signals.length, buySignals: buySignals.length,
      sellSignals: signals.filter(s => s.signal === "SELL").length,
      holdSignals: signals.filter(s => s.signal === "HOLD").length,
      finalPortfolioValue: Number(portfolioValue.toFixed(2)),
      finalBuyHoldValue: Number(buyHoldValue.toFixed(2)),
      outperformance: Number((portfolioValue - buyHoldValue).toFixed(2)),
      avgBuyReturn: avgBuyReturn !== null ? Number((avgBuyReturn * 100).toFixed(2)) : null,
      winRate: winRate !== null ? Number((winRate * 100).toFixed(1)) : null,
    },
  });
}
