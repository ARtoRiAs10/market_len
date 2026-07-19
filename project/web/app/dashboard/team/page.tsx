import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getUserPlan } from "@/lib/plan-limits";
import { TeamWorkspace } from "@/components/team/team-workspace";

export default async function TeamPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");
  const [plan, memberships] = await Promise.all([
    getUserPlan(session.user.id),
    prisma.teamMember.findMany({
      where: { userId: session.user.id, joinedAt: { not: null } },
      include: {
        team: {
          include: {
            members: {
              include: { user: { select: { id: true, name: true, email: true, image: true } } },
            },
          },
        },
      },
    }),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="font-display text-2xl">Team Workspace</h1>
        <p className="text-sm text-muted-foreground">
          Collaborate with analysts. Share watchlists, run strategies together, and manage roles.
        </p>
      </div>
      <TeamWorkspace
        plan={plan}
        teams={memberships.map(m => ({
          id: m.team.id, name: m.team.name, slug: m.team.slug,
          myRole: m.role,
          members: m.team.members.map(mem => ({
            id: mem.id, userId: mem.userId, role: mem.role,
            name: mem.user.name, email: mem.user.email, image: mem.user.image,
            joinedAt: mem.joinedAt?.toISOString() ?? null,
          })),
        }))}
        currentUserId={session.user.id}
      />
    </div>
  );
}
