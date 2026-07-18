/**
 * Weekly digest email API
 * POST /api/digest - trigger a digest for the current user (for testing)
 * GET  /api/digest/preview - preview the digest HTML (no email sent)
 *
 * Production: call from a CRON job (e.g. Vercel Cron, GitHub Actions)
 *   curl -X POST https://yourapp.com/api/digest \
 *        -H "Authorization: Bearer $CRON_SECRET"
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { listStrategies } from "@/lib/strategies/registry";
import { buildDigestHtml } from "@/emails/weekly-digest";

export async function GET(req: NextRequest) {
  // Preview - no auth needed for GET (shows a template preview)
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const data = await buildDigestData(session.user.id);
  const html = buildDigestHtml(data);
  return new NextResponse(html, { headers: { "Content-Type": "text/html" } });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const data = await buildDigestData(session.user.id);
  const html = buildDigestHtml(data);

  const resendKey = process.env.RESEND_API_KEY;
  const emailFrom = process.env.EMAIL_FROM ?? "noreply@marketlens.dev";

  if (!resendKey) {
    return NextResponse.json({ error: "RESEND_API_KEY not set. Email not sent. Preview at GET /api/digest" }, { status: 501 });
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `MarketLens <${emailFrom}>`,
      to: [session.user.email ?? ""],
      subject: `MarketLens Weekly Digest — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
      html,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: "Resend error: " + err }, { status: 502 });
  }

  return NextResponse.json({ success: true, emailSentTo: session.user.email });
}

async function buildDigestData(userId: string) {
  const strategies = listStrategies();
  const [watchlist, recentRuns, etlJobs] = await Promise.all([
    prisma.watchlistItem.findMany({
      where: { userId },
      include: { company: { include: { quarters: { orderBy: [{ fiscalYear: "desc" }, { fiscalQuarter: "desc" }], take: 1 } } } },
    }),
    prisma.strategyRun.findMany({
      where: { userId, startedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      include: { company: true, strategy: true },
      orderBy: { startedAt: "desc" },
      take: 10,
    }),
    prisma.etlJob.findMany({
      where: { userId, createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      include: { company: true },
    }),
  ]);

  return {
    watchlistCount: watchlist.length,
    weeklyRuns: recentRuns.length,
    etlJobs: etlJobs.length,
    topCompanies: watchlist.slice(0, 5).map(w => ({
      ticker: w.company.ticker,
      name: w.company.name,
      latestRevenue: w.company.quarters[0]?.revenue ? Number(w.company.quarters[0].revenue) : null,
    })),
    recentRuns: recentRuns.slice(0, 5).map(r => ({
      ticker: r.company.ticker,
      strategy: r.strategy.name,
      score: (r.result as any)?.score ?? null,
      verdict: (r.result as any)?.verdict ?? null,
    })),
  };
}
