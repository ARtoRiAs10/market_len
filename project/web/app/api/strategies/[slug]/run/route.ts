import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getStrategyBySlug } from "@/lib/strategies/registry";
import { checkStrategyRunLimit } from "@/lib/plan-limits";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

const runSchema = z.object({
  ticker: z.string().min(1).max(10),
  parameters: z.record(z.union([z.number(), z.string(), z.boolean()])).default({}),
});

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limited = rateLimit(`strategy-run:${session.user.id}`, { limit: 30, windowMs: 60_000 });
  if (!limited.success) {
    return NextResponse.json({ error: "Too many runs, slow down a moment." }, { status: 429 });
  }

  const strategy = getStrategyBySlug(params.slug);
  if (!strategy) return NextResponse.json({ error: "Unknown strategy" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = runSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { ticker, parameters } = parsed.data;

  const { allowed, remaining } = await checkStrategyRunLimit(session.user.id);
  if (!allowed) {
    return NextResponse.json(
      { error: `Daily strategy run limit reached for your plan (${remaining} remaining). Upgrade for more.` },
      { status: 403 }
    );
  }

  const company = await prisma.company.findUnique({
    where: { ticker: ticker.toUpperCase() },
    include: { quarters: { orderBy: [{ fiscalYear: "asc" }, { fiscalQuarter: "asc" }] } },
  });

  if (!company) {
    return NextResponse.json({ error: "Company not found. Add it from the Companies page first." }, { status: 404 });
  }

  if (company.quarters.length < strategy.minQuartersRequired) {
    return NextResponse.json(
      {
        error: `This strategy needs at least ${strategy.minQuartersRequired} quarters of data; ${company.ticker} has ${company.quarters.length}. Run the ETL pipeline to add more.`,
      },
      { status: 422 }
    );
  }

  // Ensure a Strategy row exists (registry-as-source-of-truth, DB row used for FK + metadata)
  const strategyRow = await prisma.strategy.upsert({
    where: { slug: strategy.slug },
    create: {
      slug: strategy.slug,
      name: strategy.name,
      category: strategy.category,
      summary: strategy.shortDescription,
      methodology: strategy.shortDescription,
      icon: strategy.icon,
    },
    update: {},
  });

  let result;
  try {
    result = strategy.evaluate(company.quarters, parameters);
  } catch (err: any) {
    const failedRun = await prisma.strategyRun.create({
      data: {
        userId: session.user.id,
        strategyId: strategyRow.id,
        companyId: company.id,
        parameters: parameters as any,
        status: "FAILED",
        errorMessage: err?.message ?? "Unknown error",
        completedAt: new Date(),
      },
    });
    return NextResponse.json({ error: "Strategy evaluation failed", runId: failedRun.id }, { status: 500 });
  }

  const run = await prisma.strategyRun.create({
    data: {
      userId: session.user.id,
      strategyId: strategyRow.id,
      companyId: company.id,
      parameters: parameters as any,
      status: "COMPLETED",
      result: result as any,
      completedAt: new Date(),
    },
  });

  await logAudit({
    userId: session.user.id,
    action: "strategy.run",
    metadata: { strategy: strategy.slug, ticker: company.ticker, score: result.score },
  });

  return NextResponse.json({ run, result });
}
