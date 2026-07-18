import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Get all watchlist companies and estimate next earnings from latest quarter
  const watchlist = await prisma.watchlistItem.findMany({
    where: { userId: session.user.id },
    include: {
      company: {
        include: { quarters: { orderBy: [{ fiscalYear: "desc" }, { fiscalQuarter: "desc" }], take: 2 } },
      },
    },
  });

  const today = new Date();
  const events = watchlist.map(({ company }) => {
    const latest = company.quarters[0];
    if (!latest) return null;

    // Estimate next earnings: latest period end + ~45 days (typical filing window)
    const periodEnd = new Date(latest.periodEndDate);
    const estimatedReport = new Date(periodEnd);
    estimatedReport.setDate(estimatedReport.getDate() + 45);

    // Next fiscal quarter
    let nextQ = latest.fiscalQuarter + 1;
    let nextY = latest.fiscalYear;
    if (nextQ > 4) { nextQ = 1; nextY += 1; }

    const daysUntil = Math.ceil((estimatedReport.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const status = daysUntil < 0 ? "reported" : daysUntil <= 7 ? "imminent" : daysUntil <= 30 ? "upcoming" : "future";

    return {
      ticker: company.ticker, name: company.name, sector: company.sector,
      latestQuarter: `Q${latest.fiscalQuarter} FY${latest.fiscalYear}`,
      nextQuarter: `Q${nextQ} FY${nextY}`,
      estimatedDate: estimatedReport.toISOString().split("T")[0],
      daysUntil, status,
    };
  }).filter(Boolean).sort((a, b) => (a!.daysUntil) - (b!.daysUntil));

  return NextResponse.json({ events });
}
