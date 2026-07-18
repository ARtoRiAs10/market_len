import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getStrategyBySlug } from "@/lib/strategies/registry";
import { checkStrategyRunLimit } from "@/lib/plan-limits";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

const screenerSchema = z.object({
  strategySlug: z.string(),
  parameters: z.record(z.union([z.number(), z.string(), z.boolean()])).default({}),
  tickers: z.array(z.string()).min(1).max(50).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limited = rateLimit(`screener:${session.user.id}`, { limit: 10, windowMs: 60_000 });
  if (!limited.success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const body = await req.json().catch(() => null);
  const parsed = screenerSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const { strategySlug, parameters, tickers } = parsed.data;
  const strategy = getStrategyBySlug(strategySlug);
  if (!strategy) return NextResponse.json({ error: "Unknown strategy" }, { status: 404 });

  const { allowed } = await checkStrategyRunLimit(session.user.id);
  if (!allowed) return NextResponse.json({ error: "Daily run limit reached. Upgrade your plan." }, { status: 403 });

  // Get companies from watchlist (or filtered by tickers)
  const watchlist = await prisma.watchlistItem.findMany({
    where: {
      userId: session.user.id,
      ...(tickers ? { company: { ticker: { in: tickers.map(t => t.toUpperCase()) } } } : {}),
    },
    include: {
      company: {
        include: { quarters: { orderBy: [{ fiscalYear: "asc" }, { fiscalQuarter: "asc" }] } },
      },
    },
  });

  const results = [];
  for (const item of watchlist) {
    const company = item.company;
    if (company.quarters.length < strategy.minQuartersRequired) {
      results.push({ ticker: company.ticker, name: company.name, sector: company.sector, status: "insufficient_data", score: null, verdict: null, verdictColor: null, rawScore: null });
      continue;
    }
    try {
      const result = strategy.evaluate(company.quarters, parameters);
      results.push({ ticker: company.ticker, name: company.name, sector: company.sector, industry: company.industry, status: "ok", score: result.score, verdict: result.verdict, verdictColor: result.verdictColor, rawScore: result.rawScore, summary: result.summary, criteria: result.criteria });
    } catch {
      results.push({ ticker: company.ticker, name: company.name, sector: company.sector, status: "error", score: null, verdict: null, verdictColor: null, rawScore: null });
    }
  }

  // Sector-relative scoring
  const byCategory = new Map<string, number[]>();
  for (const r of results) {
    if (r.score !== null && r.sector) {
      if (!byCategory.has(r.sector)) byCategory.set(r.sector, []);
      byCategory.get(r.sector)!.push(r.score);
    }
  }
  const sectorMedians = new Map<string, number>();
  for (const [sector, scores] of byCategory) {
    const sorted = [...scores].sort((a, b) => a - b);
    sectorMedians.set(sector, sorted[Math.floor(sorted.length / 2)]);
  }

  const enriched = results.map(r => ({
    ...r,
    sectorMedianScore: r.sector ? (sectorMedians.get(r.sector) ?? null) : null,
    relativeScore: r.score !== null && r.sector && sectorMedians.has(r.sector!)
      ? r.score - sectorMedians.get(r.sector!)! : null,
  }));

  await logAudit({ userId: session.user.id, action: "screener.run", metadata: { strategy: strategySlug, count: results.length } });

  return NextResponse.json({ results: enriched.sort((a, b) => (b.score ?? -1) - (a.score ?? -1)), strategy: { slug: strategy.slug, name: strategy.name } });
}
