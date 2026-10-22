import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { computeFactorProfiles, FACTOR_DEFINITIONS } from "@/lib/quant/factor-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/factors
 * Cross-sectional factor exposures (value, profitability, investment, size,
 * momentum, quality, accruals, low-vol) for the user's tracked universe.
 */
export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { profiles, universeSize, skipped } = await computeFactorProfiles(session.user.id);

  return NextResponse.json({
    factors: FACTOR_DEFINITIONS,
    universeSize,
    skipped,
    profiles,
  });
}
