import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { listStrategies } from "@/lib/strategies/registry";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
  if (!q) return NextResponse.json({ results: { companies: [], strategies: [], runs: [], pages: [] } });

  const [companies, runs] = await Promise.all([
    prisma.company.findMany({
      where: { OR: [{ ticker: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }, { sector: { contains: q, mode: "insensitive" } }] },
      take: 5,
    }),
    prisma.strategyRun.findMany({
      where: { userId: session.user.id },
      include: { company: true, strategy: true },
      orderBy: { startedAt: "desc" },
      take: 30,
    }),
  ]);

  const strategies = listStrategies().filter(s => s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q));
  const PAGES = [
    { label: "Dashboard", href: "/dashboard", kw: "overview home" },
    { label: "Screener", href: "/dashboard/screener", kw: "screener screen" },
    { label: "Backtesting", href: "/dashboard/backtesting", kw: "backtest historical" },
    { label: "Benchmarking", href: "/dashboard/benchmarking", kw: "benchmark sector" },
    { label: "ETL Pipeline", href: "/dashboard/etl", kw: "etl data pipeline" },
    { label: "Earnings Calendar", href: "/dashboard/earnings-calendar", kw: "earnings calendar" },
    { label: "Index Watchlists", href: "/dashboard/index-watchlists", kw: "sp500 nifty index" },
    { label: "Alerts", href: "/dashboard/alerts", kw: "alert notification" },
    { label: "Team", href: "/dashboard/team", kw: "team workspace" },
    { label: "Audit Log", href: "/dashboard/audit-log", kw: "audit log activity" },
    { label: "API Keys", href: "/dashboard/api-keys", kw: "api developer" },
    { label: "Billing", href: "/dashboard/billing", kw: "billing plan upgrade" },
    { label: "Settings", href: "/dashboard/settings", kw: "settings profile" },
  ].filter(p => p.label.toLowerCase().includes(q) || p.kw.includes(q));

  return NextResponse.json({
    results: {
      companies: companies.map(c => ({ type: "company", label: c.ticker + " — " + c.name, sub: c.sector ?? "", href: "/dashboard/companies/" + c.ticker })),
      strategies: strategies.map(s => ({ type: "strategy", label: s.name, sub: s.category, href: "/dashboard/strategies/" + s.slug })),
      runs: runs.filter(r => r.company.ticker.toLowerCase().includes(q) || r.strategy.name.toLowerCase().includes(q)).slice(0, 3)
        .map(r => ({ type: "run", label: r.company.ticker + " · " + r.strategy.name, sub: "Score: " + ((r.result as any)?.score ?? "—"), href: "/dashboard/strategies/" + r.strategy.slug + "?ticker=" + r.company.ticker })),
      pages: PAGES,
    },
  });
}
