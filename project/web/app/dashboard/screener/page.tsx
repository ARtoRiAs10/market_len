import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { listStrategies } from "@/lib/strategies/registry";
import { ScreenerWorkbench } from "@/components/screener/screener-workbench";

export default async function ScreenerPage() {
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
        <h1 className="font-display text-2xl">Strategy Screener</h1>
        <p className="text-sm text-muted-foreground">
          Run any strategy across your entire watchlist simultaneously. Results ranked by score with sector-relative comparison.
        </p>
      </div>
      <ScreenerWorkbench
        strategies={strategies.map(s => ({ slug: s.slug, name: s.name, category: s.category, parameters: s.parameters }))}
        companies={watchlist.map(w => ({ ticker: w.company.ticker, name: w.company.name, sector: w.company.sector }))}
      />
    </div>
  );
}
