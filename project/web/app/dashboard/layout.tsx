import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { listStrategies } from "@/lib/strategies/registry";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { DashboardTopbar } from "@/components/dashboard/topbar";
import { DashboardShellProvider } from "@/components/dashboard/shell-context";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/dashboard");

  const [subscription, watchlist] = await Promise.all([
    prisma.subscription.findUnique({ where: { userId: session.user.id } }),
    prisma.watchlistItem.findMany({
      where: { userId: session.user.id },
      include: { company: true },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
  ]);

  const strategies = listStrategies();

  return (
    <DashboardShellProvider>
      <div className="flex min-h-screen">
        <DashboardSidebar
          strategies={strategies.map((s) => ({ slug: s.slug, name: s.name, category: s.category, icon: s.icon }))}
          watchlist={watchlist.map((w) => ({ ticker: w.company.ticker, name: w.company.name }))}
        />
        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          <DashboardTopbar
            user={{ name: session.user.name, email: session.user.email, image: session.user.image }}
            plan={subscription?.plan ?? "FREE"}
          />
          <main className="flex-1 bg-secondary/30 p-4 sm:p-6">{children}</main>
        </div>
      </div>
    </DashboardShellProvider>
  );
}
