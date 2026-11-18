import { prisma } from "@/lib/db";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { IndexWatchlistImporter } from "@/components/index-watchlists/index-watchlist-importer";
import {
  NIFTY_50_CONSTITUENTS,
  SENSEX_CONSTITUENTS,
  GLOBAL_TOP_10,
  MARKET_SNAPSHOT_META,
} from "@/lib/market-data/snapshot";

const STATIC_INDEX_LISTS = [
  {
    id: "static-nifty-50",
    name: "NIFTY 50",
    description: `50 NIFTY 50 constituents (snapshot ${MARKET_SNAPSHOT_META.retrievedAt}; source: Wikipedia).`,
    region: "IN",
    tickers: NIFTY_50_CONSTITUENTS.map((c) => c.symbol),
  },
  {
    id: "static-sensex",
    name: "BSE SENSEX",
    description: `30 BSE SENSEX constituents (snapshot ${MARKET_SNAPSHOT_META.retrievedAt}; source: Wikipedia).`,
    region: "IN",
    tickers: SENSEX_CONSTITUENTS.map((c) => c.symbol),
  },
  {
    id: "static-global-top-10",
    name: "Global Top 10 (Public)",
    description: `Top 10 publicly listed companies by market cap (snapshot ${MARKET_SNAPSHOT_META.retrievedAt}; source: companiesmarketcap.com).`,
    region: "GLOBAL",
    tickers: GLOBAL_TOP_10.map((c) => c.ticker),
  },
];

export default async function IndexWatchlistsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");
  const dbLists = await prisma.indexWatchlist.findMany({ orderBy: { name: "asc" } });
  // If the database has not been seeded yet, still show the bundled real
  // NIFTY 50 / SENSEX / global-leaders lists. Importing one creates the
  // companies on demand from the same snapshot.
  const lists = dbLists.length > 0 ? dbLists : STATIC_INDEX_LISTS;
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
