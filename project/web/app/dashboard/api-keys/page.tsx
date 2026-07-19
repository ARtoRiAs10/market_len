import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getUserPlan } from "@/lib/plan-limits";
import { ApiKeysManager } from "@/components/dashboard/api-keys-manager";

export default async function ApiKeysPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");
  const [plan, keys] = await Promise.all([
    getUserPlan(session.user.id),
    prisma.apiKey.findMany({
      where: { userId: session.user.id, revokedAt: null },
      select: { id: true, name: true, keyPrefix: true, lastUsedAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-2xl">API Keys</h1>
        <p className="text-sm text-muted-foreground">
          Manage API keys for programmatic access. Available on Pro and Enterprise plans.
        </p>
      </div>
      <ApiKeysManager initialKeys={keys as any} plan={plan} />
    </div>
  );
}
