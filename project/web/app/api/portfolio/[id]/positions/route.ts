import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

const positionSchema = z.object({
  ticker: z.string().min(1).max(12),
  shares: z.number().min(0),
  targetWeight: z.number().min(0).max(1).nullable().optional(),
  note: z.string().max(500).optional(),
});

/** POST /api/portfolio/[id]/positions — add or update a position. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limited = rateLimit(`portfolio-position:${session.user.id}`, { limit: 60, windowMs: 60_000 });
  if (!limited.success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const body = await req.json().catch(() => null);
  const parsed = positionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const portfolio = await prisma.portfolio.findFirst({
    where: { id: params.id, userId: session.user.id },
  });
  if (!portfolio) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });

  const ticker = parsed.data.ticker.toUpperCase();
  const company = await prisma.company.findUnique({ where: { ticker } });
  if (!company) {
    return NextResponse.json({ error: `Company ${ticker} is not tracked yet — add it first.` }, { status: 404 });
  }

  const position = await prisma.portfolioPosition.upsert({
    where: { portfolioId_ticker: { portfolioId: params.id, ticker } },
    create: {
      portfolioId: params.id,
      companyId: company.id,
      ticker,
      shares: parsed.data.shares,
      targetWeight: parsed.data.targetWeight ?? null,
      note: parsed.data.note,
    },
    update: {
      shares: parsed.data.shares,
      ...(parsed.data.targetWeight !== undefined ? { targetWeight: parsed.data.targetWeight } : {}),
      ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
    },
  });

  await logAudit({
    userId: session.user.id,
    action: "portfolio.position.upsert",
    metadata: { portfolioId: params.id, ticker },
  });

  return NextResponse.json({ position });
}

/** DELETE /api/portfolio/[id]/positions?ticker=AAPL */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ticker = (req.nextUrl.searchParams.get("ticker") ?? "").toUpperCase();
  if (!ticker) return NextResponse.json({ error: "ticker required" }, { status: 400 });

  const portfolio = await prisma.portfolio.findFirst({
    where: { id: params.id, userId: session.user.id },
  });
  if (!portfolio) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });

  await prisma.portfolioPosition.deleteMany({ where: { portfolioId: params.id, ticker } });
  await logAudit({
    userId: session.user.id,
    action: "portfolio.position.delete",
    metadata: { portfolioId: params.id, ticker },
  });

  return NextResponse.json({ success: true });
}
