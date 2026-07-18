/**
 * Public REST API — GET /api/v1/strategies
 * Requires X-API-Key header with a valid API key (Pro/Enterprise plan).
 * Returns available strategies and their parameter definitions.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { listStrategies } from "@/lib/strategies/registry";
import crypto from "crypto";

async function authenticateApiKey(req: NextRequest) {
  const key = req.headers.get("x-api-key") ?? req.nextUrl.searchParams.get("api_key");
  if (!key) return null;
  const prefix = key.slice(0, 12);
  const hash = crypto.createHash("sha256").update(key).digest("hex");
  const record = await prisma.apiKey.findFirst({
    where: { keyHash: hash, revokedAt: null },
    include: { user: { include: { subscription: true } } },
  });
  if (!record) return null;
  const plan = record.user.subscription?.plan ?? "FREE";
  if (plan === "FREE") return null;
  // Update last used
  await prisma.apiKey.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return { userId: record.userId, plan };
}

export async function GET(req: NextRequest) {
  const auth = await authenticateApiKey(req);
  if (!auth) return NextResponse.json({ error: "Invalid or missing API key. Include X-API-Key header. Available on Pro and Enterprise plans." }, { status: 401 });
  const strategies = listStrategies().map(s => ({
    slug: s.slug, name: s.name, category: s.category,
    shortDescription: s.shortDescription, minQuartersRequired: s.minQuartersRequired,
    parameters: s.parameters,
  }));
  return NextResponse.json({ strategies, count: strategies.length });
}
