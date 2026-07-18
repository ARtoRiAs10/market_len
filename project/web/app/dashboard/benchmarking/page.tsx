import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listStrategies } from "@/lib/strategies/registry";
import { BenchmarkWorkbench } from "@/components/benchmarking/benchmark-workbench";

export default async function BenchmarkingPage() {
  const strategies = listStrategies();
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="font-display text-2xl">Sector Benchmarking</h1>
        <p className="text-sm text-muted-foreground">Compare companies against sector medians. A 6/9 F-Score in Energy reads differently than in Software.</p>
      </div>
      <BenchmarkWorkbench strategies={strategies.map(s => ({ slug: s.slug, name: s.name, category: s.category }))} />
    </div>
  );
}
