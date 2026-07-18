import Link from "next/link";
import { LineChart } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-20">
        <Link href="/" className="mb-10 flex items-center gap-2 text-sm font-medium">
          <LineChart className="h-5 w-5 text-signal-positive" />
          <span className="font-display text-lg tracking-tight">MarketLens</span>
        </Link>
        {children}
      </div>
      <div className="relative hidden overflow-hidden border-l bg-[radial-gradient(ellipse_at_top_left,_hsl(var(--secondary))_0%,_hsl(var(--background))_60%)] lg:flex lg:flex-col lg:justify-between p-12">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Quarterly Filing — Q2 FY2026
          </p>
          <h2 className="mt-4 max-w-md font-display text-3xl leading-tight">
            Read every quarter the way an analyst does.
          </h2>
        </div>
        <ScoreStripPreview />
      </div>
    </div>
  );
}

function ScoreStripPreview() {
  const cells = [1, 1, 1, 0, 1, 1, 0, 1, 1];
  return (
    <div className="rounded-lg border bg-card/60 p-5 backdrop-blur">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-xs text-muted-foreground">PIOTROSKI F-SCORE</span>
        <span className="font-mono text-xs text-signal-positive">7 / 9</span>
      </div>
      <div className="flex gap-1">
        {cells.map((c, i) => (
          <div
            key={i}
            className={`h-8 flex-1 rounded-sm ${c ? "bg-signal-positive/70" : "bg-signal-negative/40"}`}
          />
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Profitability, leverage, and efficiency tests evaluated against trailing four-quarter
        comparisons.
      </p>
    </div>
  );
}
