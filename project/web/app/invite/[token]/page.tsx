import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Users } from "lucide-react";

export default async function InvitePage({ params }: { params: { token: string } }) {
  const session = await getServerSession(authOptions);

  const invite = await prisma.teamInvite.findUnique({
    where: { token: params.token },
  });

  if (!invite || invite.expiresAt < new Date()) notFound();

  const team = await prisma.team.findUnique({ where: { id: invite.teamId } });
  if (!team) notFound();

  // If logged in and email matches, accept automatically
  if (session?.user?.email === invite.email) {
    const existing = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: invite.teamId, userId: session.user.id } },
    });
    if (!existing) {
      await prisma.teamMember.create({
        data: { teamId: invite.teamId, userId: session.user.id, role: invite.role, joinedAt: new Date() },
      });
    }
    await prisma.teamInvite.delete({ where: { token: params.token } });
    redirect("/dashboard/team");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
            <Users className="h-6 w-6" />
          </div>
          <CardTitle>You&apos;re invited to join</CardTitle>
          <CardDescription className="text-base font-medium text-foreground">{team.name}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          <p className="text-sm text-muted-foreground">
            This invite was sent to <strong>{invite.email}</strong>. You&apos;ll join as <strong>{invite.role}</strong>.
          </p>
          <p className="text-sm text-muted-foreground">
            {session
              ? "You're logged in as a different email. Log out and log in with the invited email."
              : "Log in or create an account with the invited email to accept."}
          </p>
          <div className="flex gap-3 justify-center">
            <Link href={`/login?callbackUrl=/invite/${params.token}`}>
              <Button>Log in to accept</Button>
            </Link>
            <Link href={`/register?callbackUrl=/invite/${params.token}`}>
              <Button variant="outline">Create account</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
