import { prisma } from "@/lib/db";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { IndexWatchlistImporter } from "@/components/index-watchlists/index-watchlist-importer";

export default async function IndexWatchlistsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");
  const lists = await prisma.indexWatchlist.findMany({ orderBy: { name: "asc" } });
  const watchlist = await prisma.watchlistItem.findMany({
    where: { userId: session.user.id },
    include: { company: true },
  });
  const watchedTickers = new Set(watchlist.map(w => w.company.ticker));
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="font-display text-2xl">Index Watchlists</h1>
        <p className="text-sm text-muted-foreground">One-click import pre-built sector or index watchlists. ETL data generates automatically for each ticker.</p>
      </div>
      <IndexWatchlistImporter lists={lists.map(l => ({ id: l.id, name: l.name, description: l.description, region: l.region, tickers: l.tickers as string[] }))} watchedTickers={Array.from(watchedTickers)} />
    </div>
  );
}
