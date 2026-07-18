import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { SettingsForm } from "@/components/dashboard/settings-form";

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  const user = await prisma.user.findUnique({
    where: { id: session!.user.id },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-2xl">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your account preferences.</p>
      </div>
      <SettingsForm user={user!} />
    </div>
  );
}
