import { StrategyDefinition } from "./types";
import { piotroskiDupontStrategy } from "./piotroski-dupont";
import { altmanZScoreStrategy } from "./altman-zscore";
import { beneishMScoreStrategy } from "./beneish-mscore";

/**
 * Strategy Registry — add new strategies here, everything else auto-wires.
 * Dashboard sidebar groups by .category, strategy pages are at /dashboard/strategies/[slug]
 */
export const STRATEGY_REGISTRY: StrategyDefinition[] = [
  piotroskiDupontStrategy,
  altmanZScoreStrategy,
  beneishMScoreStrategy,
];

export function getStrategyBySlug(slug: string): StrategyDefinition | undefined {
  return STRATEGY_REGISTRY.find((s) => s.slug === slug);
}

export function listStrategies(): StrategyDefinition[] {
  return STRATEGY_REGISTRY;
}
