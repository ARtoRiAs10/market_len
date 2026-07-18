"use client";
import { signOut } from "next-auth/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CommandPalette } from "@/components/search/command-palette";
import { PlanTier } from "@prisma/client";

export function DashboardTopbar({ user, plan }: { user: { name?: string | null; email?: string | null; image?: string | null }; plan: PlanTier }) {
  const initials = (user.name ?? user.email ?? "U").split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase();

  return (
    <header className="flex h-16 items-center justify-between border-b bg-background px-6">
      <CommandPalette />
      <div className="flex items-center gap-4">
        <Badge variant={plan === "FREE" ? "outline" : "amber"}>{plan}</Badge>
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Avatar>
              {user.image && <AvatarImage src={user.image} alt={user.name ?? ""} />}
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <p className="text-sm font-medium">{user.name}</p>
              <p className="text-xs text-muted-foreground">{user.email}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => window.location.href = "/dashboard/settings"}>Settings</DropdownMenuItem>
            <DropdownMenuItem onClick={() => window.location.href = "/dashboard/billing"}>Billing</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => signOut({ callbackUrl: "/" })} className="text-destructive">Log out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
