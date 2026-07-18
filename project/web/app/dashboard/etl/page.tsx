import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { EtlWorkbench } from "@/components/etl/etl-workbench";

export default async function EtlPage() {
  const session = await getServerSession(authOptions);
  const userId = session!.user.id;

  const [watchlist, jobs] = await Promise.all([
    prisma.watchlistItem.findMany({
      where: { userId },
      include: { company: true },
      orderBy: { company: { ticker: "asc" } },
    }),
    prisma.etlJob.findMany({
      where: { userId },
      include: { company: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="font-display text-2xl">ETL Pipeline</h1>
        <p className="text-sm text-muted-foreground">
          Extract → Transform → Validate → Load. Pick a company, choose a data source, and watch each Python step
          run in the FastAPI microservice.
        </p>
      </div>

      <EtlWorkbench
        companies={watchlist.map((w) => ({ ticker: w.company.ticker, name: w.company.name }))}
        recentJobs={jobs.map((j) => ({
          id: j.id,
          ticker: j.company?.ticker ?? (j.inputConfig as any)?.ticker ?? "—",
          stage: j.stage,
          status: j.status,
          createdAt: j.createdAt.toISOString(),
          stepLogs: (j.stepLogs as any[]) ?? [],
        }))}
      />
    </div>
  );
}
