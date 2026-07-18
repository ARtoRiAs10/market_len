import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, Plus } from "lucide-react";
import { checkStrategyRunLimit, checkEtlJobLimit, getUserPlan, PLAN_LIMITS } from "@/lib/plan-limits";

export default async function DashboardOverviewPage() {
  const session = await getServerSession(authOptions);
  const userId = session!.user.id;

  const [companyCount, recentRuns, recentEtl, plan, runLimit, etlLimit] = await Promise.all([
    prisma.watchlistItem.count({ where: { userId } }),
    prisma.strategyRun.findMany({
      where: { userId },
      include: { strategy: true, company: true },
      orderBy: { startedAt: "desc" },
      take: 5,
    }),
    prisma.etlJob.findMany({
      where: { userId },
      include: { company: true },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    getUserPlan(userId),
    checkStrategyRunLimit(userId),
    checkEtlJobLimit(userId),
  ]);

  const limits = PLAN_LIMITS[plan];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl">Overview</h1>
          <p className="text-sm text-muted-foreground">Your watchlist, recent strategy runs, and ETL activity.</p>
        </div>
        <Link href="/dashboard/companies">
          <Button><Plus className="h-4 w-4" /> Add company</Button>
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Companies tracked" value={`${companyCount} / ${limits.maxWatchlistItems}`} />
        <StatCard label="Strategy runs left today" value={String(runLimit.remaining)} />
        <StatCard label="ETL jobs left today" value={String(etlLimit.remaining)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent strategy runs</CardTitle>
            <CardDescription>Latest results across all companies and strategies.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentRuns.length === 0 && <EmptyState message="No strategy runs yet. Open a strategy page and run it against a company." />}
            {recentRuns.map((run) => {
              const result = run.result as any;
              return (
                <Link key={run.id} href={`/dashboard/strategies/${run.strategy.slug}?ticker=${run.company.ticker}`}
                  className="flex items-center justify-between rounded-md border p-3 text-sm hover:bg-secondary/50">
                  <div>
                    <p className="font-mono font-medium">{run.company.ticker}</p>
                    <p className="text-xs text-muted-foreground">{run.strategy.name}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {result?.verdict && (
                      <Badge variant={result.verdictColor === "positive" ? "positive" : result.verdictColor === "negative" ? "negative" : "amber"}>
                        {result.verdict}
                      </Badge>
                    )}
                    <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </Link>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent ETL jobs</CardTitle>
            <CardDescription>Extract, transform, validate, load — status of recent pipelines.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentEtl.length === 0 && <EmptyState message="No ETL jobs yet. Start one from the ETL Pipeline page." />}
            {recentEtl.map((job) => (
              <Link key={job.id} href={`/dashboard/etl?job=${job.id}`}
                className="flex items-center justify-between rounded-md border p-3 text-sm hover:bg-secondary/50">
                <div>
                  <p className="font-mono font-medium">{job.company?.ticker ?? (job.inputConfig as any)?.ticker ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">Stage: {job.stage}</p>
                </div>
                <Badge variant={job.status === "SUCCEEDED" ? "positive" : job.status === "FAILED" ? "negative" : "amber"}>
                  {job.status}
                </Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="mt-2 font-mono text-2xl font-tabular">{value}</p>
      </CardContent>
    </Card>
  );
}

function EmptyState({ message }: { message: string }) {
  return <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{message}</div>;
}
