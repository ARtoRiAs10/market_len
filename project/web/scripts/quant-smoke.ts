/**
 * Quant engine smoke test
 * =======================
 * Exercises the numerical engines (strategies, backtester, optimiser, risk
 * statistics, factor builder) against deterministic mock data — no database
 * and no network required.
 *
 *   npm run smoke
 *
 * It is not a unit-test suite (the project has no JS test runner); it is a
 * fast sanity check that the maths still produces sensible numbers.
 */
import { generateMockQuarters } from "../lib/mock-data";
import { getStrategyBySlug } from "../lib/strategies/registry";
import { runBacktest } from "../lib/quant/backtest";
import { optimizePortfolio, efficientFrontier } from "../lib/quant/optimizer";
import { buildFactorProfile, computeRawFactors } from "../lib/quant/factors";
import { computeRiskMetrics } from "../lib/quant/risk";

let failures = 0;

function check(name: string, condition: boolean, detail: string) {
  if (condition) {
    console.log(`  ✓ ${name} — ${detail}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name} — ${detail}`);
  }
}

console.log("Quant engine smoke test\n");

// ── Strategies + backtester ─────────────────────────────────────────────────
const quarters = generateMockQuarters("AAPL", 12) as never;
for (const slug of ["piotroski-fscore-dupont", "altman-zscore", "momentum-12-1", "dcf-valuation"]) {
  const strategy = getStrategyBySlug(slug);
  if (!strategy) {
    check(slug, false, "strategy not registered");
    continue;
  }
  const result = strategy.evaluate(quarters, {});
  check(
    slug,
    Number.isFinite(result.score) && result.score >= 0 && result.score <= 100,
    `score ${result.score.toFixed(1)}/100 (${result.verdict})`
  );
}

const piotroski = getStrategyBySlug("piotroski-fscore-dupont")!;
const bt = runBacktest(piotroski, quarters, { ticker: "AAPL", strategySlug: piotroski.slug, windowSize: 6 });
check(
  "backtest",
  bt.signals.length > 0 && bt.equityCurve.length > 0,
  `${bt.signals.length} signals, ${bt.equityCurve.length} equity points, Sharpe ${
    bt.summary.sharpe?.toFixed(2) ?? "n/a"
  }`
);

// ── Optimiser ───────────────────────────────────────────────────────────────
const n = 5;
const series = Array.from({ length: n }, (_, i) =>
  Array.from(
    { length: 300 },
    (_, t) => 0.0004 * (i + 1) + Math.sin(t / 7 + i) * 0.01 + (Math.random() - 0.5) * 0.004
  )
);
const assets = series.map((s, i) => ({
  symbol: `A${i}`,
  expectedReturn: (s.reduce((a, b) => a + b, 0) / s.length) * 252,
  sector: "Tech",
}));

for (const method of [
  "equal-weight",
  "inverse-vol",
  "min-variance",
  "max-sharpe",
  "risk-parity",
  "black-litterman",
] as const) {
  const res = optimizePortfolio(
    method,
    assets,
    series,
    { longOnly: true, maxWeight: 0.4, riskFreeRate: 0.04 },
    { periodsPerYear: 252 }
  );
  const sum = res.weights.reduce((a, b) => a + b, 0);
  check(
    `optimizer:${method}`,
    Math.abs(sum - 1) < 1e-6 && Math.max(...res.weights) <= 0.4 + 1e-6,
    `Σw ${sum.toFixed(4)}, max ${Math.max(...res.weights).toFixed(3)}, Sharpe ${res.sharpe.toFixed(2)}`
  );
}

const frontier = efficientFrontier(assets, series, { longOnly: true, maxWeight: 0.4 }, 10, 252);
const monotone = frontier.every((p, i) => i === 0 || p.expectedReturn >= frontier[i - 1].expectedReturn - 1e-12);
check("efficient frontier", frontier.length > 3 && monotone, `${frontier.length} monotone points`);

// ── Risk statistics ─────────────────────────────────────────────────────────
const metrics = computeRiskMetrics(series[0], {
  benchmark: series[1],
  frequency: "daily",
  riskFreeRate: 0.04,
});
check(
  "risk metrics",
  metrics.sharpe !== null && Number.isFinite(metrics.sharpe) && metrics.maxDrawdown !== null,
  `Sharpe ${metrics.sharpe?.toFixed(2)}, maxDD ${(metrics.maxDrawdown ?? 0).toFixed(3)}, beta ${metrics.beta?.toFixed(2)}`
);

// ── Factors ─────────────────────────────────────────────────────────────────
const tickers = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META"];
const raws = tickers.map((t) => {
  const q = generateMockQuarters(t, 12) as never as { closePrice: number }[];
  return computeRawFactors(generateMockQuarters(t, 12) as never, 1e12, q.map((x) => Number(x.closePrice)));
});
const profiles = tickers.map((t, i) => buildFactorProfile(t, raws[i], raws));
check(
  "factor profiles",
  profiles.every((p) => p.exposures.length === 8) && profiles.some((p) => p.compositeScore !== null),
  `${profiles.length} profiles, composite ${profiles[0].compositeScore}`
);

console.log(failures === 0 ? "\n✅  All checks passed\n" : `\n❌  ${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
