import { notFound } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { listStrategies } from "@/lib/strategies/registry";
import { QuarterlyChart } from "@/components/dashboard/quarterly-chart";
import { DataQualityBadge } from "@/components/data-quality/data-quality-badge";
import { AnalystNotes } from "@/components/notes/analyst-notes";

export default async function CompanyDetailPage({ params }: { params: { ticker: string } }) {
  const ticker = params.ticker.toUpperCase();
  const session = await getServerSession(authOptions);

  const company = await prisma.company.findUnique({
    where: { ticker },
    include: { quarters: { orderBy: [{ fiscalYear: "asc" }, { fiscalQuarter: "asc" }] } },
  });
  if (!company) notFound();

  const latest = company.quarters[company.quarters.length - 1];
  const strategies = listStrategies();
  const chartData = company.quarters.map(q => ({
    label: `Q${q.fiscalQuarter} FY${q.fiscalYear}`,
    revenue: q.revenue ? Number(q.revenue) : null,
    netIncome: q.netIncome ? Number(q.netIncome) : null,
  }));
  const latestNetMargin = latest?.revenue && latest?.netIncome
    ? Number(latest.netIncome) / Number(latest.revenue) : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="font-mono text-2xl font-semibold">{company.ticker}</h1>
            {company.exchange && <Badge variant="outline">{company.exchange}</Badge>}
            {company.sector && <Badge variant="secondary">{company.sector}</Badge>}
            <DataQualityBadge ticker={company.ticker} showDetails />
          </div>
          <p className="mt-1 text-muted-foreground">{company.name}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {strategies.map(s => (
            <Link key={s.slug} href={`/dashboard/strategies/${s.slug}?ticker=${company.ticker}`}>
              <Button size="sm" variant="outline">Run {s.name.split(" ")[0]}</Button>
            </Link>
          ))}
          <Link href={`/dashboard/etl?ticker=${company.ticker}`}>
            <Button size="sm">Refresh ETL</Button>
          </Link>
        </div>
      </div>

      {company.description && <p className="max-w-3xl text-sm text-muted-foreground">{company.description}</p>}

      <div className="grid gap-4 sm:grid-cols-4">
        <Metric label="Revenue (latest Q)" value={formatCurrency(latest?.revenue, { compact: true })} />
        <Metric label="Net income (latest Q)" value={formatCurrency(latest?.netIncome, { compact: true })} />
        <Metric label="Net margin" value={formatPercent(latestNetMargin)} />
        <Metric label="Employees" value={company.employeeCount?.toLocaleString() ?? "—"} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Revenue & net income trend</CardTitle>
          <CardDescription>{company.quarters.length} quarters on file.</CardDescription>
        </CardHeader>
        <CardContent><QuarterlyChart data={chartData} /></CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quarterly financials</CardTitle>
          <CardDescription>All values in {company.currency}.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs uppercase tracking-wider text-muted-foreground">
                {["Quarter","Revenue","Gross Profit","Net Income","Total Assets","Total Equity","OCF","EPS"].map(h => (
                  <th key={h} className={`py-2 pr-4 font-medium ${h !== "Quarter" ? "text-right" : "text-left"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {company.quarters.map(q => (
                <tr key={q.id} className="border-b font-mono text-xs last:border-0 hover:bg-secondary/20">
                  <td className="py-2 pr-4 font-sans font-medium">Q{q.fiscalQuarter} FY{q.fiscalYear}</td>
                  <td className="py-2 pr-4 text-right">{formatCurrency(q.revenue, { compact: true })}</td>
                  <td className="py-2 pr-4 text-right">{formatCurrency(q.grossProfit, { compact: true })}</td>
                  <td className="py-2 pr-4 text-right">{formatCurrency(q.netIncome, { compact: true })}</td>
                  <td className="py-2 pr-4 text-right">{formatCurrency(q.totalAssets, { compact: true })}</td>
                  <td className="py-2 pr-4 text-right">{formatCurrency(q.totalEquity, { compact: true })}</td>
                  <td className="py-2 pr-4 text-right">{formatCurrency(q.operatingCashFlow, { compact: true })}</td>
                  <td className="py-2 pr-4 text-right">{q.eps ? `$${Number(q.eps).toFixed(2)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <AnalystNotes companyId={company.id} ticker={company.ticker} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="mt-2 font-mono text-xl font-tabular">{value}</p>
      </CardContent>
    </Card>
  );
}
