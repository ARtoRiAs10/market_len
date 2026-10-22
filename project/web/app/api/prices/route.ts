import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getMarketDataProvider } from "@/lib/providers";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

const querySchema = z.object({
  ticker: z.string().min(1).max(12),
  days: z.coerce.number().min(5).max(4000).default(400),
});

const syncSchema = z.object({
  ticker: z.string().min(1).max(12),
  days: z.number().min(30).max(4000).default(500),
  sourceType: z.enum(["MOCK", "ALPHA_VANTAGE", "FMP"]).optional(),
});

/**
 * GET /api/prices?ticker=AAPL&days=400
 * Returns the stored daily OHLCV bars for a ticker.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = querySchema.safeParse({
    ticker: req.nextUrl.searchParams.get("ticker") ?? "",
    days: req.nextUrl.searchParams.get("days") ?? 400,
  });
  if (!parsed.success) return NextResponse.json({ error: "ticker and days are required" }, { status: 400 });

  const ticker = parsed.data.ticker.toUpperCase();
  const bars = await prisma.priceBar.findMany({
    where: { ticker },
    orderBy: { date: "asc" },
    take: parsed.data.days,
  });

  return NextResponse.json({
    ticker,
    count: bars.length,
    bars: bars.map((b) => ({
      date: b.date.toISOString(),
      open: b.open ? Number(b.open) : null,
      high: b.high ? Number(b.high) : null,
      low: b.low ? Number(b.low) : null,
      close: b.close ? Number(b.close) : null,
      adjClose: b.adjClose ? Number(b.adjClose) : null,
      volume: b.volume ? Number(b.volume) : null,
    })),
  });
}

/**
 * POST /api/prices — sync daily bars for a ticker from the configured
 * market-data provider into the PriceBar table.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limited = rateLimit(`price-sync:${session.user.id}`, { limit: 10, windowMs: 60_000 });
  if (!limited.success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const body = await req.json().catch(() => null);
  const parsed = syncSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const ticker = parsed.data.ticker.toUpperCase();
  const provider = getMarketDataProvider(parsed.data.sourceType);

  let bars: Awaited<ReturnType<typeof provider.fetchDailyBars>>;
  try {
    bars = await provider.fetchDailyBars(ticker, parsed.data.days);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Price sync failed" }, { status: 502 });
  }

  if (bars.length === 0) {
    return NextResponse.json({ error: `No price data returned for ${ticker}` }, { status: 422 });
  }

  const operations = bars.map((b) =>
    prisma.priceBar.upsert({
      where: { ticker_date: { ticker, date: b.date } },
      create: {
        ticker,
        date: b.date,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        adjClose: b.adjClose,
        volume: b.volume,
        source: provider.name as any,
      },
      update: {
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        adjClose: b.adjClose,
        volume: b.volume,
      },
    })
  );

  // Chunked to stay under the parameter limit of the driver.
  const CHUNK = 200;
  for (let i = 0; i < operations.length; i += CHUNK) {
    await prisma.$transaction(operations.slice(i, i + CHUNK));
  }

  await logAudit({
    userId: session.user.id,
    action: "prices.sync",
    metadata: { ticker, bars: bars.length, provider: provider.name },
  });

  return NextResponse.json({ ticker, synced: bars.length, provider: provider.name });
}
