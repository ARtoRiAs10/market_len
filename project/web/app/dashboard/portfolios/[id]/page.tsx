import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { loadPortfolio, computePortfolioAnalytics } from "@/lib/portfolio/service";
import { PortfolioStudio } from "@/components/portfolio/portfolio-studio";

export const dynamic = "force-dynamic";

export default async function PortfolioDetailPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/dashboard/portfolios");

  const loaded = await loadPortfolio(session.user.id, params.id);
  if (!loaded) notFound();

  const analytics = await computePortfolioAnalytics(loaded);

  return (
    <PortfolioStudio
      data={{
        portfolio: {
          id: loaded.portfolio.id,
          name: loaded.portfolio.name,
          description: loaded.portfolio.description,
          baseCurrency: loaded.portfolio.baseCurrency,
          benchmarkTicker: loaded.portfolio.benchmarkTicker,
          cashBalance: loaded.portfolio.cashBalance,
          createdAt: loaded.portfolio.createdAt.toISOString(),
        },
        positions: loaded.positions,
        totalValue: loaded.totalValue,
        cashValue: loaded.cashValue,
        analytics: {
          metrics: analytics.metrics as never,
          equityCurve: analytics.equityCurve,
          allocation: analytics.allocation,
          sectorAllocation: analytics.sectorAllocation,
          riskContributions: analytics.riskContributions,
          correlation: analytics.correlation,
          attribution: analytics.attribution,
          frequency: analytics.frequency,
          approximated: analytics.approximated,
          observations: analytics.observations,
        },
      }}
    />
  );
}
