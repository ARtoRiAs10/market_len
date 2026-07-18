"use client";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Users, Mail, Trash2, Copy, Check } from "lucide-react";
import { PlanTier } from "@prisma/client";

interface Member { id: string; userId: string; role: string; name: string | null; email: string | null; image: string | null; joinedAt: string | null }
interface Team { id: string; name: string; slug: string; myRole: string; members: Member[] }

const ROLE_COLORS: Record<string, any> = { OWNER: "amber", ADMIN: "positive", ANALYST: "secondary", VIEWER: "outline" };

export function TeamWorkspace({ plan, teams: initialTeams, currentUserId }: { plan: PlanTier; teams: Team[]; currentUserId: string }) {
  const { toast } = useToast();
  const [teams, setTeams] = useState<Team[]>(initialTeams);
  const [newTeamName, setNewTeamName] = useState("");
  const [creating, setCreating] = useState(false);
  const [inviteEmail, setInviteEmail] = useState<Record<string, string>>({});
  const [inviteRole, setInviteRole] = useState<Record<string, string>>({});
  const [inviting, setInviting] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (plan === "FREE") {
    return (
      <Card className="border-signal-amber/30">
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <Users className="h-8 w-8 text-signal-amber" />
          <p className="font-medium">Team Workspaces — Pro Feature</p>
          <p className="text-sm text-muted-foreground max-w-sm">
            Invite analysts, assign roles (Owner / Admin / Analyst / Viewer), and collaborate on watchlists and strategy runs.
          </p>
          <Button onClick={() => window.location.href = "/dashboard/billing"}>Upgrade to Pro</Button>
        </CardContent>
      </Card>
    );
  }

  async function createTeam() {
    if (!newTeamName.trim()) return;
    setCreating(true);
    const res = await fetch("/api/team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newTeamName }) });
    const data = await res.json();
    setCreating(false);
    if (!res.ok) { toast({ title: "Error", description: data.error, variant: "destructive" as any }); return; }
    setTeams(t => [...t, { ...data.team, myRole: "OWNER", members: [{ id: "me", userId: currentUserId, role: "OWNER", name: "You", email: null, image: null, joinedAt: new Date().toISOString() }] }]);
    setNewTeamName("");
    toast({ title: "Team created: " + data.team.name });
  }

  async function invite(teamId: string) {
    const email = inviteEmail[teamId];
    const role = inviteRole[teamId] ?? "ANALYST";
    if (!email) return;
    setInviting(teamId);
    const res = await fetch(`/api/team/${teamId}/invite`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, role }) });
    const data = await res.json();
    setInviting(null);
    if (!res.ok) { toast({ title: "Error", description: data.error, variant: "destructive" as any }); return; }
    setInviteLink(data.inviteUrl);
    setInviteEmail(e => ({ ...e, [teamId]: "" }));
    toast({ title: "Invite created", description: "Copy the link and share it with " + email });
  }

  async function removeMember(teamId: string, memberId: string) {
    await fetch(`/api/team/${teamId}/members/${memberId}`, { method: "DELETE" });
    setTeams(ts => ts.map(t => t.id === teamId ? { ...t, members: t.members.filter(m => m.id !== memberId) } : t));
    toast({ title: "Member removed" });
  }

  async function copyLink() {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Create a team</CardTitle></CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input placeholder="Team name (e.g. Equity Research)" value={newTeamName} onChange={e => setNewTeamName(e.target.value)} onKeyDown={e => e.key === "Enter" && createTeam()} className="max-w-xs" />
            <Button onClick={createTeam} disabled={creating || !newTeamName.trim()}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create
            </Button>
          </div>
        </CardContent>
      </Card>

      {inviteLink && (
        <Card className="border-signal-positive/40">
          <CardContent className="flex items-center gap-3 py-4">
            <Mail className="h-4 w-4 text-signal-positive shrink-0" />
            <p className="flex-1 font-mono text-xs break-all text-muted-foreground">{inviteLink}</p>
            <Button size="sm" variant="outline" onClick={copyLink}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</Button>
            <Button size="sm" variant="ghost" onClick={() => setInviteLink(null)}>✕</Button>
          </CardContent>
        </Card>
      )}

      {teams.length === 0 && <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">No teams yet. Create one above.</div>}

      {teams.map(team => (
        <Card key={team.id}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">{team.name}</CardTitle>
                <CardDescription className="font-mono text-xs">{team.slug}</CardDescription>
              </div>
              <Badge variant={ROLE_COLORS[team.myRole] ?? "outline"}>{team.myRole}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              {team.members.map(m => (
                <div key={m.id} className="flex items-center justify-between rounded-md border p-2.5">
                  <div className="flex items-center gap-2.5">
                    <Avatar className="h-7 w-7">
                      {m.image && <AvatarImage src={m.image} />}
                      <AvatarFallback className="text-[10px]">{(m.name ?? m.email ?? "?")[0].toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium">{m.name ?? m.email}</p>
                      {m.name && <p className="text-xs text-muted-foreground">{m.email}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={ROLE_COLORS[m.role] ?? "outline"} className="text-[10px]">{m.role}</Badge>
                    {["OWNER","ADMIN"].includes(team.myRole) && m.userId !== currentUserId && (
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeMember(team.id, m.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {["OWNER","ADMIN"].includes(team.myRole) && (
              <div className="flex gap-2 border-t pt-4">
                <Input placeholder="colleague@company.com" type="email" value={inviteEmail[team.id] ?? ""} onChange={e => setInviteEmail(ie => ({ ...ie, [team.id]: e.target.value }))} className="flex-1 text-sm" />
                <Select value={inviteRole[team.id] ?? "ANALYST"} onValueChange={v => setInviteRole(ir => ({ ...ir, [team.id]: v }))}>
                  <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["ADMIN","ANALYST","VIEWER"].map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button size="sm" onClick={() => invite(team.id)} disabled={inviting === team.id || !inviteEmail[team.id]}>
                  {inviting === team.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Invite
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
