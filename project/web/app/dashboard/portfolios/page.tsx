import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PortfolioManager } from "@/components/portfolio/portfolio-manager";

export const dynamic = "force-dynamic";

export default async function PortfoliosPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/dashboard/portfolios");

  const [portfolios, companies] = await Promise.all([
    prisma.portfolio.findMany({
      where: { userId: session.user.id },
      include: { _count: { select: { positions: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.company.findMany({
      select: { ticker: true, name: true },
      orderBy: { ticker: "asc" },
    }),
  ]);

  return (
    <PortfolioManager
      initialPortfolios={portfolios.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        baseCurrency: p.baseCurrency,
        benchmarkTicker: p.benchmarkTicker,
        cashBalance: Number(p.cashBalance),
        positions: p._count.positions,
        createdAt: p.createdAt.toISOString(),
      }))}
      companies={companies}
    />
  );
}
