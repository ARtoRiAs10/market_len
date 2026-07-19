"use client";
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2, Copy, Check, Eye } from "lucide-react";
import { PlanTier } from "@prisma/client";
import { cn } from "@/lib/utils";

interface ApiKey { id: string; name: string; keyPrefix: string; lastUsedAt: string | null; createdAt: string }

export function ApiKeysManager({ initialKeys, plan }: { initialKeys: ApiKey[]; plan: PlanTier }) {
  const { toast } = useToast();
  const [keys, setKeys] = React.useState<ApiKey[]>(initialKeys);
  const [newName, setNewName] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [newRawKey, setNewRawKey] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [deleting, setDeleting] = React.useState<string | null>(null);

  if (plan === "FREE") {
    return (
      <Card className="border-signal-amber/30">
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <p className="font-medium">API Access — Pro Feature</p>
          <p className="text-sm text-muted-foreground max-w-sm">Create API keys to call MarketLens strategy endpoints from your own tools, scripts, or data pipelines.</p>
          <div className="rounded-md bg-secondary/50 p-4 text-left text-xs font-mono w-full max-w-sm">
            <p className="text-muted-foreground"># Example</p>
            <p>curl -X POST https://yourapp.com/api/v1/strategies/run \</p>
            <p>  -H "X-API-Key: mkl_live_..." \</p>
            <p>{`  -d '{"slug":"piotroski-fscore-dupont","ticker":"NEXG"}'`}</p>
          </div>
          <Button onClick={() => window.location.href = "/dashboard/billing"}>Upgrade to Pro</Button>
        </CardContent>
      </Card>
    );
  }

  async function create() {
    if (!newName.trim()) return;
    setCreating(true);
    const res = await fetch("/api/v1/apikeys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newName }) });
    const data = await res.json(); setCreating(false);
    if (!res.ok) { toast({ title: "Error", description: data.error, variant: "destructive" as any }); return; }
    setKeys(k => [data.key, ...k]);
    setNewRawKey(data.rawKey);
    setNewName("");
    toast({ title: "API key created", description: "Save it now — it won't be shown again." });
  }

  async function revoke(id: string) {
    setDeleting(id);
    await fetch("/api/v1/apikeys", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keyId: id }) });
    setKeys(k => k.filter(key => key.id !== id));
    setDeleting(null);
    toast({ title: "API key revoked" });
  }

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-6">
      {newRawKey && (
        <Card className="border-signal-positive/40 bg-signal-positive/5">
          <CardHeader><CardTitle className="text-base text-signal-positive">⚠ Save your API key now</CardTitle><CardDescription>This is the only time the full key will be shown.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <code className="flex-1 rounded-md bg-secondary px-3 py-2 font-mono text-xs break-all">{newRawKey}</code>
              <Button size="icon" variant="outline" onClick={() => copy(newRawKey)}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</Button>
            </div>
            <Button size="sm" variant="outline" onClick={() => setNewRawKey(null)}>I've saved it</Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Create new key</CardTitle></CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input placeholder="Key name (e.g. Production, Analysis Script)" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === "Enter" && create()} />
            <Button onClick={create} disabled={creating || !newName.trim()}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Active keys ({keys.length}/10)</CardTitle></CardHeader>
        <CardContent>
          {keys.length === 0 && <p className="text-sm text-muted-foreground">No API keys yet.</p>}
          <div className="space-y-2">
            {keys.map(key => (
              <div key={key.id} className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <p className="text-sm font-medium">{key.name}</p>
                  <p className="font-mono text-xs text-muted-foreground">{key.keyPrefix}</p>
                  <p className="text-xs text-muted-foreground">
                    Created {new Date(key.createdAt).toLocaleDateString()}
                    {key.lastUsedAt && ` · Last used ${new Date(key.lastUsedAt).toLocaleDateString()}`}
                  </p>
                </div>
                <Button size="icon" variant="ghost" className="text-signal-negative hover:text-signal-negative" onClick={() => revoke(key.id)} disabled={deleting === key.id}>
                  {deleting === key.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Usage examples</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {[
            { label: "List strategies", code: `curl https://yourapp.com/api/v1/strategies \\\n  -H "X-API-Key: mkl_live_..."` },
            { label: "Run Piotroski F-Score", code: `curl -X POST https://yourapp.com/api/v1/strategies/run \\\n  -H "X-API-Key: mkl_live_..." \\\n  -H "Content-Type: application/json" \\\n  -d '{"slug":"piotroski-fscore-dupont","ticker":"NEXG"}'` },
            { label: "Custom parameters", code: `curl -X POST https://yourapp.com/api/v1/strategies/run \\\n  -H "X-API-Key: mkl_live_..." \\\n  -H "Content-Type: application/json" \\\n  -d '{"slug":"altman-zscore","ticker":"VTLX","parameters":{"safeZone":3.0,"distressZone":1.5}}'` },
          ].map(ex => (
            <div key={ex.label}>
              <Label className="text-xs mb-1 block text-muted-foreground">{ex.label}</Label>
              <pre className="rounded-md bg-secondary/60 p-3 font-mono text-xs overflow-x-auto">{ex.code}</pre>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
