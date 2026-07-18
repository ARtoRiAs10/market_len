import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkWatchlistLimit } from "@/lib/plan-limits";
import { getMarketDataProvider } from "@/lib/providers";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

const addCompanySchema = z.object({
  ticker: z.string().min(1).max(10).transform((s) => s.toUpperCase().trim()),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = req.nextUrl.searchParams.get("q");

  const companies = await prisma.company.findMany({
    where: q
      ? { OR: [{ ticker: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] }
      : undefined,
    orderBy: { ticker: "asc" },
    take: 50,
  });

  const watchlist = await prisma.watchlistItem.findMany({
    where: { userId: session.user.id },
    select: { companyId: true },
  });
  const watchedIds = new Set(watchlist.map((w) => w.companyId));

  return NextResponse.json({
    companies: companies.map((c) => ({ ...c, isWatched: watchedIds.has(c.id) })),
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limited = rateLimit(`add-company:${session.user.id}`, { limit: 20, windowMs: 60_000 });
  if (!limited.success) {
    return NextResponse.json({ error: "Too many requests, slow down." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = addCompanySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "A valid ticker is required" }, { status: 400 });
  }
  const { ticker } = parsed.data;

  const { allowed, remaining } = await checkWatchlistLimit(session.user.id);
  if (!allowed) {
    return NextResponse.json(
      { error: `Watchlist limit reached for your plan (${remaining} remaining). Upgrade to add more.` },
      { status: 403 }
    );
  }

  let company = await prisma.company.findUnique({ where: { ticker } });

  if (!company) {
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

  await prisma.watchlistItem.upsert({
    where: { userId_companyId: { userId: session.user.id, companyId: company.id } },
    create: { userId: session.user.id, companyId: company.id },
    update: {},
  });

  await logAudit({ userId: session.user.id, action: "watchlist.add", metadata: { ticker } });

  return NextResponse.json({ company });
}
