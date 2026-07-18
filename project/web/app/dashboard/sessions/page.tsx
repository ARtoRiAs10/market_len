import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { SessionsManager } from "@/components/dashboard/sessions-manager";

export default async function SessionsPage() {
  const session = await getServerSession(authOptions);
  const sessions = await prisma.session.findMany({
    where: { userId: session!.user.id, expires: { gt: new Date() } },
    orderBy: { expires: "desc" },
  });
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-2xl">Active Sessions</h1>
        <p className="text-sm text-muted-foreground">Devices and browsers currently logged in to your account.</p>
      </div>
      <SessionsManager sessions={sessions.map(s => ({ id: s.id, expires: s.expires.toISOString() }))} currentToken={session!.user.id} />
    </div>
  );
}
