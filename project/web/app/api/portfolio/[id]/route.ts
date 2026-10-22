import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { loadPortfolio, computePortfolioAnalytics } from "@/lib/portfolio/service";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(500).nullable().optional(),
  baseCurrency: z.string().length(3).optional(),
  benchmarkTicker: z.string().max(12).nullable().optional(),
  cashBalance: z.number().min(0).optional(),
});

/** GET /api/portfolio/[id] — portfolio, positions and full analytics. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const loaded = await loadPortfolio(session.user.id, params.id);
  if (!loaded) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });

  const analytics = await computePortfolioAnalytics(loaded);

  return NextResponse.json({ ...loaded, analytics });
}

/** PATCH /api/portfolio/[id] — update portfolio metadata. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const existing = await prisma.portfolio.findFirst({
    where: { id: params.id, userId: session.user.id },
  });
  if (!existing) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });

  const data = parsed.data;
  const portfolio = await prisma.portfolio.update({
    where: { id: params.id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.baseCurrency !== undefined ? { baseCurrency: data.baseCurrency } : {}),
      ...(data.benchmarkTicker !== undefined
        ? { benchmarkTicker: data.benchmarkTicker?.toUpperCase() ?? null }
        : {}),
      ...(data.cashBalance !== undefined ? { cashBalance: data.cashBalance } : {}),
    },
  });

  await logAudit({
    userId: session.user.id,
    action: "portfolio.update",
    metadata: { portfolioId: portfolio.id },
  });

  return NextResponse.json({ portfolio });
}

/** DELETE /api/portfolio/[id] */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await prisma.portfolio.findFirst({
    where: { id: params.id, userId: session.user.id },
  });
  if (!existing) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });

  await prisma.portfolio.delete({ where: { id: params.id } });
  await logAudit({
    userId: session.user.id,
    action: "portfolio.delete",
    metadata: { portfolioId: params.id },
  });

  return NextResponse.json({ success: true });
}
