import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getStrategyBySlug } from "@/lib/strategies/registry";
import { rateLimit } from "@/lib/rate-limit";
import { z } from "zod";

const schema = z.object({ strategySlug: z.string(), parameters: z.record(z.union([z.number(), z.string(), z.boolean()])).default({}) });

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limited = rateLimit(`bench:${session.user.id}`, { limit: 10, windowMs: 60_000 });
  if (!limited.success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });

  const strategy = getStrategyBySlug(parsed.data.strategySlug);
  if (!strategy) return NextResponse.json({ error: "Strategy not found" }, { status: 404 });

  const watchlist = await prisma.watchlistItem.findMany({
    where: { userId: session.user.id },
    include: { company: { include: { quarters: { orderBy: [{ fiscalYear: "asc" }, { fiscalQuarter: "asc" }] } } } },
  });

  // Score every company
  const scored = watchlist.map(({ company }) => {
    if (company.quarters.length < strategy.minQuartersRequired) return null;
    try {
      const result = strategy.evaluate(company.quarters, parsed.data.parameters);
      const latest = company.quarters[company.quarters.length - 1];
      return {
        ticker: company.ticker, name: company.name, sector: company.sector ?? "Unknown", industry: company.industry ?? "Unknown",
        score: result.score, verdict: result.verdict, verdictColor: result.verdictColor,
        roa: latest.roa ? Number(latest.roa) : null,
        roe: latest.roe ? Number(latest.roe) : null,
        netMargin: latest.netMargin ? Number(latest.netMargin) : null,
        currentRatio: latest.currentRatio ? Number(latest.currentRatio) : null,
        grossMargin: latest.grossMargin ? Number(latest.grossMargin) : null,
      };
    } catch { return null; }
  }).filter(Boolean) as any[];

  // Group by sector + compute medians
  const sectors = new Map<string, any[]>();
  for (const c of scored) {
    if (!sectors.has(c.sector)) sectors.set(c.sector, []);
    sectors.get(c.sector)!.push(c);
  }

  const median = (arr: number[]) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const sectorBenchmarks = Array.from(sectors.entries()).map(([sector, companies]) => {
    const scores = companies.map(c => c.score).filter((s): s is number => s !== null);
    const roas = companies.map(c => c.roa).filter((v): v is number => v !== null);
    const roes = companies.map(c => c.roe).filter((v): v is number => v !== null);
    const margins = companies.map(c => c.netMargin).filter((v): v is number => v !== null);
    return { sector, count: companies.length, companies, medianScore: median(scores), medianRoa: median(roas), medianRoe: median(roes), medianNetMargin: median(margins) };
  }).sort((a, b) => (b.medianScore ?? 0) - (a.medianScore ?? 0));

  return NextResponse.json({ sectorBenchmarks, allCompanies: scored });
}
