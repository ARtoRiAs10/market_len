import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

const REQUIRED_FIELDS = ["revenue","grossProfit","netIncome","totalAssets","totalLiabilities","totalEquity","currentAssets","currentLiabilities","operatingCashFlow","longTermDebt","sharesOutstanding","ebitda","eps"];
const OPTIONAL_FIELDS = ["closePrice","volumeAvg","inventory","receivables","capex","freeCashFlow","dividendsPaid"];

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ticker = req.nextUrl.searchParams.get("ticker");
  if (!ticker) return NextResponse.json({ error: "ticker required" }, { status: 400 });

  const company = await prisma.company.findUnique({
    where: { ticker: ticker.toUpperCase() },
    include: { quarters: { orderBy: [{ fiscalYear: "asc" }, { fiscalQuarter: "asc" }] } },
  });
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  const quarters = company.quarters;
  const totalQuarters = quarters.length;

  // Per-field completeness across all quarters
  const fieldCompleteness = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS].map(field => {
    const populated = quarters.filter(q => (q as any)[field] !== null && (q as any)[field] !== undefined).length;
    return { field, populated, total: totalQuarters, pct: totalQuarters ? Math.round((populated / totalQuarters) * 100) : 0, required: REQUIRED_FIELDS.includes(field) };
  });

  // Per-quarter completeness
  const quarterCompleteness = quarters.map(q => {
    const populated = REQUIRED_FIELDS.filter(f => (q as any)[f] !== null).length;
    return {
      label: `Q${q.fiscalQuarter} FY${q.fiscalYear}`, populated, total: REQUIRED_FIELDS.length,
      pct: Math.round((populated / REQUIRED_FIELDS.length) * 100),
      sparseFields: REQUIRED_FIELDS.filter(f => (q as any)[f] === null),
    };
  });

  const overallScore = Math.round(
    fieldCompleteness.filter(f => f.required).reduce((acc, f) => acc + f.pct, 0) /
    Math.max(REQUIRED_FIELDS.length, 1)
  );

  const issues: string[] = [];
  if (totalQuarters < 5) issues.push(`Only ${totalQuarters} quarters available — most strategies need ≥ 5`);
  fieldCompleteness.filter(f => f.required && f.pct < 60).forEach(f => issues.push(`${f.field} is sparse (${f.pct}% populated)`));
  if (quarterCompleteness.some(q => q.pct < 60)) issues.push("Some quarters have >40% missing required fields");

  return NextResponse.json({ ticker: company.ticker, name: company.name, totalQuarters, overallScore, fieldCompleteness, quarterCompleteness, issues, strategyReadiness: {
    "piotroski-fscore-dupont": totalQuarters >= 5 && overallScore >= 70,
    "altman-zscore": totalQuarters >= 2 && overallScore >= 60,
    "beneish-mscore": totalQuarters >= 5 && overallScore >= 65,
  } });
}
