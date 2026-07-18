"use client";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2, Bell } from "lucide-react";

interface Alert { id: string; companyId: string; ticker: string; strategySlug: string; condition: string; threshold: number | null; notifyEmail: boolean; createdAt: string }
interface Company { id: string; ticker: string; name: string }
interface Strategy { slug: string; name: string }

const CONDITIONS = [
  { value: "SCORE_ABOVE", label: "Score rises above threshold" },
  { value: "SCORE_BELOW", label: "Score drops below threshold" },
  { value: "SCORE_CHANGE", label: "Score changes by ±N points" },
  { value: "VERDICT_CHANGE", label: "Verdict changes (Strong/Moderate/Weak)" },
];

export function AlertsManager({ initialAlerts, companies, strategies }: { initialAlerts: Alert[]; companies: Company[]; strategies: Strategy[] }) {
  const { toast } = useToast();
  const [alerts, setAlerts] = useState<Alert[]>(initialAlerts);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [form, setForm] = useState({ companyId: companies[0]?.id ?? "", strategySlug: strategies[0]?.slug ?? "", condition: "SCORE_BELOW", threshold: 45, notifyEmail: true });

  async function create() {
    setSaving(true);
    const res = await fetch("/api/alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const data = await res.json(); setSaving(false);
    if (!res.ok) { toast({ title: "Error", description: data.error, variant: "destructive" as any }); return; }
    setAlerts(a => [{ ...data.alert, ticker: companies.find(c => c.id === form.companyId)?.ticker ?? "?" }, ...a]);
    setCreating(false);
    toast({ title: "Alert created" });
  }

  async function remove(id: string) {
    setDeleting(id);
    await fetch("/api/alerts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ alertId: id }) });
    setAlerts(a => a.filter(x => x.id !== id));
    setDeleting(null);
    toast({ title: "Alert removed" });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Active alerts ({alerts.length}/20)</CardTitle>
            <Button size="sm" onClick={() => setCreating(c => !c)}><Plus className="h-4 w-4" /> New alert</Button>
          </div>
        </CardHeader>
        {creating && (
          <CardContent className="border-t space-y-4 pt-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label className="text-xs">Company</Label>
                <Select value={form.companyId} onValueChange={v => setForm(f => ({ ...f, companyId: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{companies.map(c => <SelectItem key={c.id} value={c.id}><span className="font-mono">{c.ticker}</span></SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label className="text-xs">Strategy</Label>
                <Select value={form.strategySlug} onValueChange={v => setForm(f => ({ ...f, strategySlug: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{strategies.map(s => <SelectItem key={s.slug} value={s.slug}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label className="text-xs">Condition</Label>
                <Select value={form.condition} onValueChange={v => setForm(f => ({ ...f, condition: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CONDITIONS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {form.condition !== "VERDICT_CHANGE" && (
                <div className="space-y-1.5"><Label className="text-xs">Threshold (score 0–100)</Label>
                  <Input type="number" min={0} max={100} value={form.threshold} onChange={e => setForm(f => ({ ...f, threshold: parseInt(e.target.value) }))} />
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.notifyEmail} onCheckedChange={v => setForm(f => ({ ...f, notifyEmail: v }))} />
              <Label className="text-xs">Email notification</Label>
            </div>
            <div className="flex gap-2">
              <Button onClick={create} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Create alert</Button>
              <Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
            </div>
          </CardContent>
        )}
        <CardContent className="space-y-2">
          {alerts.length === 0 && <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground"><Bell className="h-6 w-6" />No alerts configured yet.</div>}
          {alerts.map(a => (
            <div key={a.id} className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold">{a.ticker}</span>
                  <Badge variant="secondary" className="text-[10px]">{a.strategySlug.split("-")[0]}</Badge>
                  <Badge variant="outline" className="text-[10px]">{CONDITIONS.find(c => c.value === a.condition)?.label ?? a.condition}</Badge>
                </div>
                {a.threshold !== null && <p className="text-xs text-muted-foreground">Threshold: {a.threshold}</p>}
              </div>
              <Button size="icon" variant="ghost" className="text-destructive" onClick={() => remove(a.id)} disabled={deleting === a.id}>
                {deleting === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
