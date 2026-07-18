import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AddCompanyForm } from "@/components/dashboard/add-company-form";
import { CompaniesTable } from "@/components/dashboard/companies-table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { getSeedCompanyList } from "@/lib/mock-data";

export default async function CompaniesPage() {
  const session = await getServerSession(authOptions);
  const userId = session!.user.id;

  const watchlist = await prisma.watchlistItem.findMany({
    where: { userId },
    include: { company: { include: { quarters: { orderBy: { periodEndDate: "desc" }, take: 1 } } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="font-display text-2xl">Companies</h1>
        <p className="text-sm text-muted-foreground">
          Add a ticker to start tracking it — quarterly fundamentals are generated automatically (mock data by
          default) and can be refreshed via the ETL pipeline.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add a company</CardTitle>
          <CardDescription>
            Try a seed ticker like {getSeedCompanyList().slice(0, 4).map((c) => c.ticker).join(", ")}, or enter any
            ticker to generate mock data for it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AddCompanyForm seedTickers={getSeedCompanyList()} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your watchlist</CardTitle>
          <CardDescription>{watchlist.length} compan{watchlist.length === 1 ? "y" : "ies"} tracked.</CardDescription>
        </CardHeader>
        <CardContent>
          <CompaniesTable
            rows={watchlist.map((w) => ({
              ticker: w.company.ticker,
              name: w.company.name,
              sector: w.company.sector,
              latestQuarter: w.company.quarters[0]
                ? `Q${w.company.quarters[0].fiscalQuarter} FY${w.company.quarters[0].fiscalYear}`
                : "—",
              revenue: w.company.quarters[0]?.revenue?.toString() ?? null,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
