import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getStrategyBySlug } from "@/lib/strategies/registry";
import { getUserPlan } from "@/lib/plan-limits";
import { z } from "zod";

const schema = z.object({
  ticker: z.string(),
  strategySlug: z.string().optional(),
  format: z.enum(["csv", "json", "excel"]).default("csv"),
  parameters: z.record(z.union([z.number(), z.string(), z.boolean()])).default({}),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const plan = await getUserPlan(session.user.id);
  if (plan === "FREE") return NextResponse.json({ error: "Export is available on Pro and Enterprise plans." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const { ticker, strategySlug, format, parameters } = parsed.data;

  const company = await prisma.company.findUnique({
    where: { ticker: ticker.toUpperCase() },
    include: { quarters: { orderBy: [{ fiscalYear: "asc" }, { fiscalQuarter: "asc" }] } },
  });
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  // Build export data
  const quarterRows = company.quarters.map(q => ({
    Ticker: company.ticker, Company: company.name, Sector: company.sector ?? "", Industry: company.industry ?? "",
    FiscalYear: q.fiscalYear, FiscalQuarter: q.fiscalQuarter, PeriodEndDate: q.periodEndDate?.toISOString().split("T")[0] ?? "",
    Revenue: q.revenue, GrossProfit: q.grossProfit, OperatingIncome: q.operatingIncome,
    NetIncome: q.netIncome, EBITDA: q.ebitda, EPS: q.eps,
    TotalAssets: q.totalAssets, TotalLiabilities: q.totalLiabilities, TotalEquity: q.totalEquity,
    CurrentAssets: q.currentAssets, CurrentLiabilities: q.currentLiabilities, Cash: q.cash,
    LongTermDebt: q.longTermDebt, OperatingCashFlow: q.operatingCashFlow, FreeCashFlow: q.freeCashFlow,
    GrossMargin: q.grossMargin, NetMargin: q.netMargin, ROA: q.roa, ROE: q.roe, CurrentRatio: q.currentRatio,
  }));

  // Optionally include strategy results
  let strategyRows: any[] = [];
  if (strategySlug) {
    const strategy = getStrategyBySlug(strategySlug);
    if (strategy && company.quarters.length >= strategy.minQuartersRequired) {
      try {
        const result = strategy.evaluate(company.quarters, parameters);
        strategyRows = result.criteria.map(c => ({
          Ticker: company.ticker, Strategy: strategy.name, CriterionKey: c.key, CriterionLabel: c.label,
          Category: c.category, Pass: c.pass, Value: c.value, Threshold: c.threshold,
          Weight: c.weight, Explanation: c.explanation,
          Score: result.score, Verdict: result.verdict,
        }));
      } catch {}
    }
  }

  if (format === "json") {
    const blob = JSON.stringify({ company: { ticker: company.ticker, name: company.name, sector: company.sector }, quarters: quarterRows, strategyResults: strategyRows }, null, 2);
    return new NextResponse(blob, { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${ticker}-export.json"` } });
  }

  // CSV (multi-section)
  const toCsv = (rows: any[]) => {
    if (!rows.length) return "";
    const headers = Object.keys(rows[0]);
    return [headers.join(","), ...rows.map(r => headers.map(h => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
  };

  const csv = [`# ${company.name} (${company.ticker}) — Quarterly Financials`, toCsv(quarterRows),
    ...(strategyRows.length ? [`\n# ${strategySlug} Strategy Results`, toCsv(strategyRows)] : [])].join("\n");

  return new NextResponse(csv, { headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="${ticker}-marketlens-export.csv"` } });
}
