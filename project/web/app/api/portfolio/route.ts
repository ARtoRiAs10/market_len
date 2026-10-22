import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  baseCurrency: z.string().length(3).default("USD"),
  benchmarkTicker: z.string().max(12).optional(),
  cashBalance: z.number().min(0).default(0),
  tickers: z.array(z.string().min(1).max(12)).max(100).default([]),
});

/** GET /api/portfolio — list the signed-in user's portfolios. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const portfolios = await prisma.portfolio.findMany({
    where: { userId: session.user.id },
    include: { _count: { select: { positions: true } } },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    portfolios: portfolios.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      baseCurrency: p.baseCurrency,
      benchmarkTicker: p.benchmarkTicker,
      cashBalance: Number(p.cashBalance),
      positions: p._count.positions,
      createdAt: p.createdAt,
    })),
  });
}

/** POST /api/portfolio — create a portfolio (optionally seeded with tickers). */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limited = rateLimit(`portfolio-create:${session.user.id}`, { limit: 20, windowMs: 60_000 });
  if (!limited.success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const { name, description, baseCurrency, benchmarkTicker, cashBalance, tickers } = parsed.data;

  const companies = tickers.length
    ? await prisma.company.findMany({ where: { ticker: { in: tickers.map((t) => t.toUpperCase()) } } })
    : [];

  const portfolio = await prisma.portfolio.create({
    data: {
      userId: session.user.id,
      name,
      description,
      baseCurrency,
      benchmarkTicker: benchmarkTicker?.toUpperCase() ?? null,
      cashBalance,
      positions: {
        create: companies.map((c) => ({
          ticker: c.ticker,
          companyId: c.id,
          shares: 0,
        })),
      },
    },
    include: { positions: true },
  });

  await logAudit({
    userId: session.user.id,
    action: "portfolio.create",
    metadata: { portfolioId: portfolio.id, name },
  });

  return NextResponse.json({ portfolio });
}
