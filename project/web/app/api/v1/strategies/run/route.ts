import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getStrategyBySlug } from "@/lib/strategies/registry";
import { checkStrategyRunLimit } from "@/lib/plan-limits";
import { logAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { z } from "zod";
import crypto from "crypto";

async function authenticateApiKey(req: NextRequest) {
  const key = req.headers.get("x-api-key") ?? req.nextUrl.searchParams.get("api_key");
  if (!key) return null;
  const hash = crypto.createHash("sha256").update(key).digest("hex");
  const record = await prisma.apiKey.findFirst({
    where: { keyHash: hash, revokedAt: null },
    include: { user: { include: { subscription: true } } },
  });
  if (!record) return null;
  if ((record.user.subscription?.plan ?? "FREE") === "FREE") return null;
  await prisma.apiKey.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return { userId: record.userId, plan: record.user.subscription?.plan ?? "PRO" };
}

const schema = z.object({
  slug: z.string(),
  ticker: z.string().min(1).max(10),
  parameters: z.record(z.union([z.number(), z.string(), z.boolean()])).default({}),
});

export async function POST(req: NextRequest) {
  const auth = await authenticateApiKey(req);
  if (!auth) return NextResponse.json({ error: "Invalid or missing API key. Pass X-API-Key header. Requires Pro plan." }, { status: 401 });

  const limited = rateLimit(`v1-run:${auth.userId}`, { limit: 30, windowMs: 60_000 });
  if (!limited.success) return NextResponse.json({ error: "Rate limit exceeded (30/min)." }, { status: 429 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });

  const { slug, ticker, parameters } = parsed.data;
  const strategy = getStrategyBySlug(slug);
  if (!strategy) return NextResponse.json({ error: `Unknown strategy: ${slug}` }, { status: 404 });

  const { allowed, remaining } = await checkStrategyRunLimit(auth.userId);
  if (!allowed) return NextResponse.json({ error: `Daily run limit reached.` }, { status: 429 });

  const company = await prisma.company.findUnique({
    where: { ticker: ticker.toUpperCase() },
    include: { quarters: { orderBy: [{ fiscalYear: "asc" }, { fiscalQuarter: "asc" }] } },
  });
  if (!company) return NextResponse.json({ error: `Company ${ticker} not found.` }, { status: 404 });
  if (company.quarters.length < strategy.minQuartersRequired) {
    return NextResponse.json({ error: `Need ${strategy.minQuartersRequired} quarters, have ${company.quarters.length}.` }, { status: 422 });
  }

  let result;
  try { result = strategy.evaluate(company.quarters, parameters); }
  catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }

  await logAudit({ userId: auth.userId, action: "api.v1.run", metadata: { slug, ticker } });

  return NextResponse.json({
    ticker: company.ticker, company: company.name,
    strategy: { slug: strategy.slug, name: strategy.name },
    result: { score: result.score, maxScore: result.maxScore, verdict: result.verdict, summary: result.summary, criteria: result.criteria, generatedAt: result.generatedAt },
    meta: { remainingRunsToday: remaining },
  });
}
