import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { computeFactorProfiles, FACTOR_DEFINITIONS } from "@/lib/quant/factor-service";
import { FactorHeatmap } from "@/components/factors/factor-heatmap";

export const dynamic = "force-dynamic";

export default async function FactorsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/dashboard/factors");

  const { profiles, universeSize } = await computeFactorProfiles(session.user.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Factor exposure</h1>
        <p className="text-sm text-muted-foreground">
          Value, profitability, investment, size, momentum, quality, accruals and low volatility — ranked
          against every company you track.
        </p>
      </div>
      <FactorHeatmap factors={FACTOR_DEFINITIONS} profiles={profiles} universeSize={universeSize} />
    </div>
  );
}
