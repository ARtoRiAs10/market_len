"use client";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/hooks/use-theme";
import { Loader2, Shield, ShieldCheck } from "lucide-react";

interface UserData { id: string; name: string | null; email: string; role: string; createdAt: Date; hasTotpEnabled?: boolean }

export function SettingsForm({ user }: { user: UserData }) {
  const { toast } = useToast();
  const [theme, setTheme] = useTheme();
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState(user.name ?? "");
  const [totpSetup, setTotpSetup] = useState<{ otpUri?: string; backupCodes?: string[] } | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [totpLoading, setTotpLoading] = useState(false);
  const [has2FA, setHas2FA] = useState(user.hasTotpEnabled ?? false);

  const joinedDate = new Date(user.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  async function save() {
    setLoading(true);
    const res = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    setLoading(false);
    const d = await res.json();
    if (res.ok) toast({ title: "Settings saved" });
    else toast({ title: "Error", description: d.error, variant: "destructive" as any });
  }

  async function setupTotp() {
    setTotpLoading(true);
    const res = await fetch("/api/auth/totp", { method: "POST" });
    const d = await res.json(); setTotpLoading(false);
    if (!res.ok) { toast({ title: "2FA setup error", description: d.error ?? d.setup, variant: "destructive" as any }); return; }
    setTotpSetup(d);
  }

  async function verifyTotp() {
    setTotpLoading(true);
    const res = await fetch("/api/auth/totp", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: totpCode }) });
    const d = await res.json(); setTotpLoading(false);
    if (!res.ok) { toast({ title: "Invalid code", description: d.error, variant: "destructive" as any }); return; }
    setHas2FA(true); setTotpSetup(null);
    toast({ title: "2FA enabled!", description: "Save your backup codes." });
    if (d.backupCodes) setTotpSetup({ backupCodes: d.backupCodes });
  }

  async function disableTotp() {
    const res = await fetch("/api/auth/totp", { method: "DELETE" });
    if (res.ok) { setHas2FA(false); setTotpSetup(null); toast({ title: "2FA disabled" }); }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Profile</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5"><Label>Display name</Label><Input value={name} onChange={e => setName(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Email</Label><Input value={user.email} disabled className="opacity-60" /></div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Role:</span><Badge variant="outline">{user.role}</Badge>
            <span className="ml-4">Member since {joinedDate}</span>
          </div>
          <Button onClick={save} disabled={loading}>{loading && <Loader2 className="h-4 w-4 animate-spin" />} Save changes</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Appearance</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Dark mode</p>
              <p className="text-xs text-muted-foreground">Ledger dark theme — best for data-dense analysis. Preference is saved.</p>
            </div>
            <Switch checked={theme === "dark"} onCheckedChange={v => setTheme(v ? "dark" : "light")} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                {has2FA ? <ShieldCheck className="h-4 w-4 text-signal-positive" /> : <Shield className="h-4 w-4" />} Two-Factor Authentication
              </CardTitle>
              <CardDescription>Adds a TOTP code requirement at login.</CardDescription>
            </div>
            {has2FA && <Badge variant="positive">Enabled</Badge>}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {!has2FA && !totpSetup && (
            <Button variant="outline" onClick={setupTotp} disabled={totpLoading}>
              {totpLoading && <Loader2 className="h-4 w-4 animate-spin" />} Set up 2FA
            </Button>
          )}
          {totpSetup?.otpUri && !totpSetup?.backupCodes && (
            <div className="space-y-3 rounded-md border p-4">
              <p className="text-sm">1. Scan this URI in your authenticator app (Google Authenticator, Authy, 1Password):</p>
              <code className="block rounded bg-secondary p-2 text-xs break-all">{totpSetup.otpUri}</code>
              <p className="text-sm">2. Enter the 6-digit code to verify:</p>
              <div className="flex gap-2">
                <Input placeholder="000000" maxLength={6} value={totpCode} onChange={e => setTotpCode(e.target.value.replace(/\D/g, ""))} className="w-32 font-mono" />
                <Button onClick={verifyTotp} disabled={totpLoading || totpCode.length !== 6}>
                  {totpLoading && <Loader2 className="h-4 w-4 animate-spin" />} Verify
                </Button>
              </div>
            </div>
          )}
          {totpSetup?.backupCodes && (
            <div className="rounded-md border border-signal-positive/40 bg-signal-positive/5 p-4 space-y-2">
              <p className="text-sm font-medium text-signal-positive">⚠ Save these backup codes now (shown once)</p>
              <div className="grid grid-cols-2 gap-1">
                {totpSetup.backupCodes.map((c, i) => <code key={i} className="rounded bg-secondary px-2 py-1 font-mono text-xs">{c}</code>)}
              </div>
              <Button size="sm" variant="outline" onClick={() => setTotpSetup(null)}>I've saved them</Button>
            </div>
          )}
          {has2FA && (
            <Button variant="outline" className="text-destructive border-destructive/30" onClick={disableTotp}>Disable 2FA</Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Notifications</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div><p className="text-sm font-medium">Weekly digest email</p><p className="text-xs text-muted-foreground">Watchlist summary + strategy runs every Monday.</p></div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={async () => { const r = await fetch("/api/digest"); const h = await r.text(); window.open("data:text/html," + encodeURIComponent(h)); }}>Preview</Button>
              <Button size="sm" onClick={async () => { const r = await fetch("/api/digest", { method: "POST" }); const d = await r.json(); toast({ title: d.success ? "Digest sent!" : "Error", description: d.emailSentTo ?? d.error }); }}>Send test</Button>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div><p className="text-sm font-medium">Active sessions</p><p className="text-xs text-muted-foreground">View and revoke logged-in devices.</p></div>
            <Button size="sm" variant="outline" onClick={() => window.location.href = "/dashboard/sessions"}>Manage sessions</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
