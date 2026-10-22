import { prisma } from "@/lib/db";
import {
  buildFactorProfile,
  computeRawFactors,
  FACTOR_DEFINITIONS,
  CompanyFactorProfile,
} from "./factors";

/**
 * Factor service
 * ==============
 * Builds cross-sectional factor profiles for a universe of companies.
 *
 * The universe is the set of companies the user tracks (watchlist + portfolio
 * positions); when the user tracks nothing, every company with a usable
 * history is used so the page is never empty in a fresh install.
 */

export interface FactorProfileResult {
  profiles: CompanyFactorProfile[];
  universeSize: number;
  /** Tickers that were skipped because they lack enough history. */
  skipped: string[];
}

export async function computeFactorProfiles(userId?: string): Promise<FactorProfileResult> {
  const tracked = userId
    ? await prisma.company.findMany({
        where: {
          OR: [
            { watchlistedBy: { some: { userId } } },
            { portfolioPositions: { some: { portfolio: { userId } } } },
          ],
        },
        select: { ticker: true },
      })
    : [];

  let companies = await prisma.company.findMany({
    where: {
      ticker: tracked.length > 0 ? { in: tracked.map((t) => t.ticker) } : undefined,
    },
    include: {
      quarters: { orderBy: [{ fiscalYear: "asc" }, { fiscalQuarter: "asc" }] },
    },
    take: 60,
  });

  if (companies.length === 0) {
    companies = await prisma.company.findMany({
      include: {
        quarters: { orderBy: [{ fiscalYear: "asc" }, { fiscalQuarter: "asc" }] },
      },
      take: 60,
    });
  }

  const skipped: string[] = [];
  const raws = companies.map((company) => {
    const quarters = company.quarters;
    if (quarters.length < 4) {
      skipped.push(company.ticker);
      return null;
    }
    const latest = quarters[quarters.length - 1];
    const price = latest.closePrice !== null ? Number(latest.closePrice) : null;
    const shares = latest.sharesOutstanding !== null ? Number(latest.sharesOutstanding) : null;
    const marketCap = price !== null && shares !== null ? price * shares : null;
    const closePrices = quarters
      .map((q) => (q.closePrice !== null ? Number(q.closePrice) : null))
      .filter((v): v is number => v !== null && v > 0);
    return {
      ticker: company.ticker,
      raw: computeRawFactors(quarters, marketCap, closePrices),
    };
  });

  const valid = raws.filter((r): r is { ticker: string; raw: ReturnType<typeof computeRawFactors> } => r !== null);
  const universe = valid.map((v) => v.raw);

  const profiles = valid
    .map((v) => buildFactorProfile(v.ticker, v.raw, universe))
    .sort((a, b) => (b.compositeScore ?? -1) - (a.compositeScore ?? -1));

  return { profiles, universeSize: universe.length, skipped };
}

export { FACTOR_DEFINITIONS };
