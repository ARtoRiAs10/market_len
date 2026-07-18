import { NextResponse } from "next/server";
import { listStrategies } from "@/lib/strategies/registry";

export async function GET() {
  const strategies = listStrategies().map((s) => ({
    slug: s.slug,
    name: s.name,
    shortDescription: s.shortDescription,
    category: s.category,
    icon: s.icon,
    parameters: s.parameters,
    minQuartersRequired: s.minQuartersRequired,
  }));
  return NextResponse.json({ strategies });
}
