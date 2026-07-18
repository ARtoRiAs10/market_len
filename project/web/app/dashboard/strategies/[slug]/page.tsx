import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getStrategyBySlug } from "@/lib/strategies/registry";
import { StrategyWorkbench } from "@/components/strategies/strategy-workbench";
import { Badge } from "@/components/ui/badge";

export default async function StrategyDetailPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { ticker?: string };
}) {
  const strategy = getStrategyBySlug(params.slug);
  if (!strategy) notFound();

  const session = await getServerSession(authOptions);
  const userId = session!.user.id;

  const watchlist = await prisma.watchlistItem.findMany({
    where: { userId },
    include: { company: true },
    orderBy: { company: { ticker: "asc" } },
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="font-display text-2xl">{strategy.name}</h1>
          <Badge variant="outline">{strategy.category}</Badge>
        </div>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{strategy.shortDescription}</p>
      </div>

      <StrategyWorkbench
        strategySlug={strategy.slug}
        parameters={strategy.parameters}
        companies={watchlist.map((w) => ({ ticker: w.company.ticker, name: w.company.name }))}
        defaultTicker={searchParams.ticker}
        minQuartersRequired={strategy.minQuartersRequired}
      />
    </div>
  );
}
