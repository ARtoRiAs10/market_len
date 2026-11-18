import Link from "next/link";
import { ArrowRight, LineChart, ShieldCheck, Workflow, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PLAN_LIMITS } from "@/lib/plan-limits";

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-2">
            <LineChart className="h-5 w-5 text-signal-positive" />
            <span className="font-display text-lg tracking-tight">MarketLens</span>
          </div>
          <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
            <a href="#strategies" className="hover:text-foreground">Strategies</a>
            <a href="#etl" className="hover:text-foreground">ETL Pipeline</a>
            <a href="#pricing" className="hover:text-foreground">Pricing</a>
          </nav>
          <div className="flex items-center gap-3">
            <Link href="/login"><Button variant="ghost" size="sm">Log in</Button></Link>
            <Link href="/register"><Button size="sm">Get started</Button></Link>
          </div>
        </div>
      </header>

      <section className="border-b">
        <div className="container grid items-center gap-12 py-20 lg:grid-cols-2 lg:py-28">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Fundamental analysis, quarter by quarter
            </p>
            <h1 className="mt-4 font-display text-4xl leading-[1.1] sm:text-5xl">
              Score every company the way an audit committee would.
            </h1>
            <p className="mt-5 max-w-lg text-muted-foreground">
              MarketLens ingests quarterly financial statements, runs institutional-grade
              screens like the Piotroski F-Score and DuPont decomposition, and shows you
              exactly which criteria passed — and why.
            </p>
            <div className="mt-8 flex gap-3">
              <Link href="/register">
                <Button size="lg">
                  Start free <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="#strategies">
                <Button size="lg" variant="outline">See a strategy</Button>
              </Link>
            </div>
          </div>
          <ScoreStripHero />
        </div>
      </section>

      <section id="strategies" className="border-b">
        <div className="container py-20">
          <h2 className="font-display text-3xl">Nine strategies, one audit trail</h2>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            Every model is implemented in TypeScript, parameterised, and versioned. Run a
            screen against a company and see exactly which criteria passed.
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["Piotroski F-Score + DuPont", "9-point quality screen with ROE decomposition."],
              ["Altman Z-Score", "Five-variable bankruptcy-risk model."],
              ["Beneish M-Score", "Eight-index earnings-manipulation screen."],
              ["Fama–French 5-Factor", "Value, profitability, investment, size, momentum."],
              ["Magic Formula", "Greenblatt's ROIC + earnings-yield rank."],
              ["FCFF DCF", "Five-year discounted cash-flow valuation."],
            ].map(([name, description]) => (
              <div key={name} className="rounded-lg border bg-card p-5">
                <p className="font-medium">{name}</p>
                <p className="mt-2 text-sm text-muted-foreground">{description}</p>
              </div>
            ))}
          </div>
          <Link href="/register" className="mt-8 inline-block">
            <Button variant="outline">Explore the research library <ArrowRight className="h-4 w-4" /></Button>
          </Link>
        </div>
      </section>

      <section id="etl" className="border-b">
        <div className="container py-20">
          <div className="grid gap-10 lg:grid-cols-3">
            <Feature
              icon={<Database className="h-5 w-5" />}
              title="Built-in ETL pipeline"
              description="Extract → transform → validate → load. Pull mock or live financial data, watch each stage run, and inspect the Python that powered it."
            />
            <Feature
              icon={<Workflow className="h-5 w-5" />}
              title="Configurable strategies"
              description="Every threshold — margin weights, lookback window, liquidity floors — is a parameter you control, not a hardcoded constant."
            />
            <Feature
              icon={<ShieldCheck className="h-5 w-5" />}
              title="Audit-grade traceability"
              description="Every strategy run and ETL job is logged with the exact parameters and data used to produce it."
            />
          </div>
        </div>
      </section>

      <section id="pricing" className="border-b">
        <div className="container py-20">
          <h2 className="font-display text-3xl">Plans that scale with your coverage universe</h2>
          <div className="mt-10 grid gap-6 lg:grid-cols-3">
            {(["FREE", "PRO", "ENTERPRISE"] as const).map((tier) => {
              const plan = PLAN_LIMITS[tier];
              return (
                <div key={tier} className="rounded-lg border p-6">
                  <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">{plan.label}</p>
                  <p className="mt-2 font-display text-3xl">
                    ${plan.priceMonthly}
                    <span className="text-base font-sans text-muted-foreground">/mo</span>
                  </p>
                  <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
                    {plan.features.map((f) => (
                      <li key={f} className="flex gap-2">
                        <span className="text-signal-positive">—</span>
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Link href="/register" className="mt-6 block">
                    <Button className="w-full" variant={tier === "PRO" ? "default" : "outline"}>
                      {tier === "FREE" ? "Start free" : "Choose " + plan.label}
                    </Button>
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <footer className="py-10">
        <div className="container text-sm text-muted-foreground">
          © {new Date().getFullYear()} MarketLens. Financial data shown for select tiers is illustrative/mock by default.
        </div>
      </footer>
    </div>
  );
}

function Feature({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div>
      <div className="flex h-10 w-10 items-center justify-center rounded-md border text-signal-positive">{icon}</div>
      <h3 className="mt-4 font-medium">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function ScoreStripHero() {
  const rows = [
    { label: "Positive ROA", pass: true },
    { label: "Positive Operating Cash Flow", pass: true },
    { label: "Improving ROA", pass: true },
    { label: "Quality of Earnings", pass: false },
    { label: "Decreasing Leverage", pass: true },
    { label: "Improving Liquidity", pass: true },
    { label: "No Share Dilution", pass: true },
    { label: "Improving Gross Margin", pass: false },
    { label: "Improving Asset Turnover", pass: true },
  ];
  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-xs text-muted-foreground">NEXG — Nexgen Robotics Corp.</p>
          <p className="font-display text-xl">Piotroski F-Score</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-2xl font-semibold text-signal-positive">7/9</p>
          <p className="text-xs text-muted-foreground">Strong</p>
        </div>
      </div>
      <div className="mt-5 space-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2">
            <div className={`h-1.5 w-6 rounded-full ${r.pass ? "bg-signal-positive" : "bg-signal-negative/60"}`} />
            <span className="font-mono text-xs text-muted-foreground">{r.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
