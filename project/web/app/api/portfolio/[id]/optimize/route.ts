import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { loadPortfolio, buildReturnData } from "@/lib/portfolio/service";
import { optimizePortfolio, efficientFrontier, OptimizerMethod } from "@/lib/quant/optimizer";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

const bodySchema = z.object({
  method: z
    .enum([
      "equal-weight",
      "inverse-vol",
      "min-variance",
      "max-sharpe",
      "risk-parity",
      "risk-budgeting",
      "black-litterman",
    ])
    .default("max-sharpe"),
  maxWeight: z.number().min(0.05).max(1).default(0.4),
  minWeight: z.number().min(0).max(1).default(0),
  longOnly: z.boolean().default(true),
  riskFreeRate: z.number().min(0).max(0.2).default(0.04),
  /** Black–Litterman views: { assetIndex, expectedReturn, confidence }. */
  views: z
    .array(
      z.object({
        assetIndex: z.number().int().min(0),
        expectedReturn: z.number(),
        confidence: z.number().min(0).max(1).optional(),
      })
    )
    .optional(),
  includeFrontier: z.boolean().default(true),
});

/**
 * POST /api/portfolio/[id]/optimize
 *
 * Runs the constrained portfolio optimiser over the portfolio's own return
 * series and returns the target weights (plus the efficient frontier).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limited = rateLimit(`portfolio-optimize:${session.user.id}`, { limit: 20, windowMs: 60_000 });
  if (!limited.success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const raw = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const loaded = await loadPortfolio(session.user.id, params.id);
  if (!loaded) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });

  if (loaded.positions.length < 2) {
    return NextResponse.json(
      { error: "Add at least two positions before optimising." },
      { status: 422 }
    );
  }

  const data = await buildReturnData(loaded);

  // Only keep the assets that have a usable return series.
  const usable = loaded.positions
    .map((p, i) => ({ position: p, index: i, series: data.series[i] ?? [] }))
    .filter((a) => a.series.length >= 10);

  if (usable.length < 2) {
    return NextResponse.json(
      { error: "Not enough price history to estimate a covariance matrix." },
      { status: 422 }
    );
  }

  const assets = usable.map((a) => {
    const series = a.series;
    const meanReturn = series.reduce((acc, r) => acc + r, 0) / series.length;
    const variance =
      series.reduce((acc, r) => acc + (r - meanReturn) ** 2, 0) / Math.max(1, series.length - 1);
    const periodsPerYear = data.frequency === "daily" ? 252 : 4;
    return {
      symbol: a.position.ticker,
      expectedReturn: meanReturn * periodsPerYear,
      sector: a.position.sector ?? "Unclassified",
      volatility: Math.sqrt(variance) * Math.sqrt(periodsPerYear),
    };
  });

  const returnSeries = usable.map((a) => a.series);
  const periodsPerYear = data.frequency === "daily" ? 252 : 4;

  const result = optimizePortfolio(
    parsed.data.method as OptimizerMethod,
    assets,
    returnSeries,
    {
      longOnly: parsed.data.longOnly,
      maxWeight: parsed.data.maxWeight,
      minWeight: parsed.data.minWeight,
      riskFreeRate: parsed.data.riskFreeRate,
    },
    {
      periodsPerYear,
      marketWeights: usable.map((a) => a.position.weight),
      views: parsed.data.views,
    }
  );

  const frontier = parsed.data.includeFrontier
    ? efficientFrontier(assets, returnSeries, { longOnly: parsed.data.longOnly, maxWeight: parsed.data.maxWeight, riskFreeRate: parsed.data.riskFreeRate }, 20, periodsPerYear)
    : [];

  await logAudit({
    userId: session.user.id,
    action: "portfolio.optimize",
    metadata: { portfolioId: params.id, method: parsed.data.method },
  });

  return NextResponse.json({
    method: parsed.data.method,
    assets: assets.map((a, i) => ({
      symbol: a.symbol,
      sector: a.sector,
      currentWeight: usable[i].position.weight,
      currentValue: usable[i].position.marketValue,
      expectedReturn: a.expectedReturn,
      volatility: a.volatility,
      targetWeight: result.weights[i] ?? 0,
    })),
    expectedReturn: result.expectedReturn,
    volatility: result.volatility,
    sharpe: result.sharpe,
    diagnostics: result.diagnostics,
    frequency: data.frequency,
    observations: data.portfolioReturns.length,
    frontier,
  });
}

/** GET /api/portfolio/[id]/optimize — the price history the optimiser sees. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const loaded = await loadPortfolio(session.user.id, params.id);
  if (!loaded) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });

  const data = await buildReturnData(loaded);
  return NextResponse.json({
    frequency: data.frequency,
    observations: data.portfolioReturns.length,
    tickers: data.tickers,
    weights: data.weights,
    benchmarkTicker: data.benchmarkTicker,
  });
}
