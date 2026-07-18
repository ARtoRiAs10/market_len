import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { StrategyResultPanel } from "@/components/strategies/strategy-result-panel";
import { Badge } from "@/components/ui/badge";
import { LineChart } from "lucide-react";
import Link from "next/link";

export default async function SharedRunPage({ params }: { params: { runId: string } }) {
  const shared = await prisma.sharedRun.findUnique({
    where: { id: params.runId },
    include: { run: { include: { strategy: true, company: true } } },
  });
  if (!shared) notFound();

  const result = shared.run.result as any;
  if (!result) notFound();

  await prisma.sharedRun.update({ where: { id: params.runId }, data: { viewCount: { increment: 1 } } });

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <LineChart className="h-5 w-5 text-signal-positive" />
          <span className="font-display text-base tracking-tight">MarketLens</span>
        </Link>
        <Badge variant="outline">Shared Analysis</Badge>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-8 space-y-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-2xl font-semibold">{shared.run.company.ticker}</h1>
            <Badge variant="outline">{shared.run.strategy.name}</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{shared.run.company.name} — shared analysis (read-only)</p>
        </div>
        <StrategyResultPanel result={result} ticker={shared.run.company.ticker} />
        <p className="text-xs text-muted-foreground">View count: {shared.viewCount + 1}</p>
      </main>
    </div>
  );
}
