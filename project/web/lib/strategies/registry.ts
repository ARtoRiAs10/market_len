import { StrategyDefinition } from "./types";
import { piotroskiDupontStrategy } from "./piotroski-dupont";
import { altmanZScoreStrategy } from "./altman-zscore";
import { beneishMScoreStrategy } from "./beneish-mscore";
import { famaFrenchFiveFactorStrategy } from "./fama-french-five-factor";
import { qualityMinusJunkStrategy } from "./quality-minus-junk";
import { magicFormulaStrategy } from "./magic-formula";
import { grahamDefensiveStrategy } from "./graham-defensive";
import { dcfValuationStrategy } from "./dcf-valuation";
import { momentumStrategy } from "./momentum-12-1";

/**
 * Strategy Registry — add new strategies here, everything else auto-wires.
 * Dashboard sidebar groups by .category, strategy pages are at /dashboard/strategies/[slug]
 *
 * Methodology sources for each strategy are documented in
 * `docs/RESEARCH-LIBRARY.md` and on the /dashboard/research page.
 */
export const STRATEGY_REGISTRY: StrategyDefinition[] = [
  // ── Fundamental quality & credit ─────────────────────────────────────────
  piotroskiDupontStrategy,
  altmanZScoreStrategy,
  beneishMScoreStrategy,

  // ── Factor models (modern quant) ────────────────────────────────────────
  famaFrenchFiveFactorStrategy,
  qualityMinusJunkStrategy,

  // ── Value & momentum ─────────────────────────────────────────────────────
  magicFormulaStrategy,
  grahamDefensiveStrategy,
  momentumStrategy,

  // ── Valuation ────────────────────────────────────────────────────────────
  dcfValuationStrategy,
];

export function getStrategyBySlug(slug: string): StrategyDefinition | undefined {
  return STRATEGY_REGISTRY.find((s) => s.slug === slug);
}

export function listStrategies(): StrategyDefinition[] {
  return STRATEGY_REGISTRY;
}

/** Strategies grouped by category — used by the sidebar and research page. */
export function strategiesByCategory(): { category: string; strategies: StrategyDefinition[] }[] {
  const map = new Map<string, StrategyDefinition[]>();
  for (const s of STRATEGY_REGISTRY) {
    if (!map.has(s.category)) map.set(s.category, []);
    map.get(s.category)!.push(s);
  }
  return Array.from(map.entries()).map(([category, strategies]) => ({ category, strategies }));
}
