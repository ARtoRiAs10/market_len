import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getUserPlan, PLAN_LIMITS } from "@/lib/plan-limits";
import { getMarketDataProvider } from "@/lib/providers";
import { findSnapshotCompany } from "@/lib/market-data/snapshot";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

const schema = z.object({
  tickers: z.array(z.string().min(1).max(12)).min(1).max(100),
  listName: z.string().max(120).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limited = rateLimit(`watchlist-import:${session.user.id}`, { limit: 10, windowMs: 60_000 });
  if (!limited.success) {
    return NextResponse.json({ error: "Too many imports. Please wait a minute." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "A list of tickers is required (max 100)." }, { status: 400 });
  }

  const plan = await getUserPlan(session.user.id);
  const limit = PLAN_LIMITS[plan].maxWatchlistItems;
  const currentCount = await prisma.watchlistItem.count({ where: { userId: session.user.id } });
  const available = Math.max(0, limit - currentCount);

  let added = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const rawTicker of parsed.data.tickers) {
    if (added >= available) break;
    const ticker = rawTicker.toUpperCase().trim();
    if (!ticker) continue;

    try {
      let company = await prisma.company.findUnique({ where: { ticker } });

      if (!company) {
        const snapshot = findSnapshotCompany(ticker);
        if (snapshot) {
          company = await prisma.company.create({
            data: {
              ticker,
              name: snapshot.name,
              sector: snapshot.sector,
              industry: snapshot.sector,
              exchange: snapshot.exchange,
              country: snapshot.country,
              description: `${snapshot.name} (${ticker}) — imported from the bundled market snapshot.`,
              source: "SNAPSHOT",
            },
          });
        } else {
          const provider = getMarketDataProvider();
          const profile = await provider.fetchProfile(ticker);
          company = await prisma.company.create({
            data: {
              ticker,
              name: profile.name,
              sector: profile.sector,
              industry: profile.industry,
              exchange: profile.exchange,
              country: profile.country,
              description: profile.description,
              employeeCount: profile.employeeCount,
              source: provider.name as any,
            },
          });
        }
      }

      const existing = await prisma.watchlistItem.findUnique({
        where: { userId_companyId: { userId: session.user.id, companyId: company.id } },
      });
      if (existing) {
        skipped++;
        continue;
      }

      await prisma.watchlistItem.create({
        data: { userId: session.user.id, companyId: company.id },
      });
      added++;
    } catch (err: any) {
      failed++;
      if (errors.length < 5) errors.push(`${ticker}: ${err?.message ?? "failed"}`);
    }
  }

  if (added > 0) {
    await logAudit({
      userId: session.user.id,
      action: "watchlist.import",
      metadata: { listName: parsed.data.listName, added, skipped, failed },
    });
  }

  return NextResponse.json({
    added,
    skipped,
    failed,
    remaining: Math.max(0, available - added),
    errors,
  });
}