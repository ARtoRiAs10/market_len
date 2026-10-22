import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { strategiesByCategory } from "@/lib/strategies/registry";
import { getStrategyResearch } from "@/lib/strategies/research";
import { BookOpen, ExternalLink, ArrowRight } from "lucide-react";

export const metadata = {
  title: "Research library — MarketLens",
  description: "The academic and practitioner sources behind every MarketLens strategy.",
};

/**
 * Research library
 * ----------------
 * Every strategy in the registry, grouped by category, with the methodology,
 * the sources it is based on and the known caveats. The page is the
 * in-app version of `docs/RESEARCH-LIBRARY.md`.
 */
export default function ResearchPage() {
  const groups = strategiesByCategory();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Research library</h1>
        <p className="text-sm text-muted-foreground">
          Every score in MarketLens is a published model. Here is what each one measures, where it comes
          from, and where it breaks down.
        </p>
      </div>

      {groups.map((group) => (
        <section key={group.category} className="space-y-3">
          <h2 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            {group.category}
          </h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {group.strategies.map((strategy) => {
              const research = getStrategyResearch(strategy.slug);
              return (
                <Card key={strategy.slug} className="flex flex-col">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-base">{strategy.name}</CardTitle>
                        <CardDescription className="mt-1 text-xs">{strategy.shortDescription}</CardDescription>
                      </div>
                      <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                        {strategy.slug}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col gap-3">
                    {research ? (
                      <>
                        <p className="text-sm text-muted-foreground">{research.methodology}</p>

                        <div>
                          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Sources
                          </p>
                          <ul className="space-y-1">
                            {research.references.map((ref) => (
                              <li key={ref.citation} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                                <BookOpen className="mt-0.5 h-3 w-3 shrink-0" />
                                <span>
                                  {ref.url ? (
                                    <a
                                      href={ref.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
                                    >
                                      {ref.citation}
                                      <ExternalLink className="h-2.5 w-2.5" />
                                    </a>
                                  ) : (
                                    ref.citation
                                  )}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        {research.caveats.length > 0 && (
                          <div>
                            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Caveats
                            </p>
                            <ul className="list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
                              {research.caveats.map((c) => (
                                <li key={c}>{c}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Methodology notes for this strategy are not documented yet.
                      </p>
                    )}

                    <div className="mt-auto pt-1">
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/dashboard/strategies/${strategy.slug}`}>
                          Run the strategy <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
