import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { listStrategies } from "@/lib/strategies/registry";
import { BacktestWorkbench } from "@/components/backtesting/backtest-workbench";

export default async function BacktestingPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");
  const watchlist = await prisma.watchlistItem.findMany({
    where: { userId: session.user.id },
    include: { company: true },
    orderBy: { company: { ticker: "asc" } },
  });
  const strategies = listStrategies();
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="font-display text-2xl">Strategy Backtesting</h1>
        <p className="text-sm text-muted-foreground">
          Replay any strategy over historical quarterly data. See if following Buy/Sell signals would have outperformed buy-and-hold.
        </p>
      </div>
      <BacktestWorkbench
        strategies={strategies.map(s => ({ slug: s.slug, name: s.name, category: s.category }))}
        companies={watchlist.map(w => ({ ticker: w.company.ticker, name: w.company.name }))}
      />
    </div>
  );
}
