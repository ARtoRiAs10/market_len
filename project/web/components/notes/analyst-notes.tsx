"use client";
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Pin, PinOff, Trash2, Plus, StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";

interface Note { id: string; content: string; pinned: boolean; fiscalYear: number | null; fiscalQuarter: number | null; createdAt: string }

export function AnalystNotes({ companyId, ticker }: { companyId: string; ticker: string }) {
  const { toast } = useToast();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/notes?companyId=${companyId}`)
      .then(r => r.json())
      .then(d => setNotes(d.notes ?? []))
      .finally(() => setLoading(false));
  }, [companyId]);

  async function save() {
    if (!draft.trim()) return;
    setSaving(true);
    const res = await fetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId, content: draft }) });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { toast({ title: "Error", description: data.error, variant: "destructive" as any }); return; }
    setNotes(n => [data.note, ...n]);
    setDraft(""); setAdding(false);
    toast({ title: "Note saved" });
  }

  async function togglePin(note: Note) {
    await fetch(`/api/notes/${note.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: note.content, pinned: !note.pinned }) });
    setNotes(ns => ns.map(n => n.id === note.id ? { ...n, pinned: !n.pinned } : n).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)));
  }

  async function remove(id: string) {
    setDeleting(id);
    await fetch(`/api/notes/${id}`, { method: "DELETE" });
    setNotes(ns => ns.filter(n => n.id !== id));
    setDeleting(null);
    toast({ title: "Note deleted" });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base"><StickyNote className="h-4 w-4" /> Analyst Notes</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setAdding(a => !a)}><Plus className="h-3.5 w-3.5" /> Add note</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {adding && (
          <div className="space-y-2 rounded-md border p-3">
            <textarea
              className="w-full resize-none rounded-sm bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              rows={3} placeholder={`Note for ${ticker} (e.g. Q3 FY2024: one-time impairment, ignore EBITDA dip)`}
              value={draft} onChange={e => setDraft(e.target.value)} autoFocus
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={saving || !draft.trim()}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Save</Button>
              <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setDraft(""); }}>Cancel</Button>
            </div>
          </div>
        )}
        {loading && <p className="text-sm text-muted-foreground">Loading notes…</p>}
        {!loading && notes.length === 0 && !adding && (
          <p className="text-sm text-muted-foreground">No notes yet. Add context about earnings, restatements, or one-off items.</p>
        )}
        {notes.map(note => (
          <div key={note.id} className={cn("rounded-md border p-3 text-sm", note.pinned && "border-signal-amber/40 bg-signal-amber/5")}>
            <div className="flex items-start justify-between gap-2">
              <p className="flex-1 leading-relaxed">{note.content}</p>
              <div className="flex items-center gap-1 shrink-0">
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => togglePin(note)}>
                  {note.pinned ? <PinOff className="h-3 w-3 text-signal-amber" /> : <Pin className="h-3 w-3 text-muted-foreground" />}
                </Button>
                <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => remove(note.id)} disabled={deleting === note.id}>
                  {deleting === note.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                </Button>
              </div>
            </div>
            <p className="mt-1.5 text-[10px] text-muted-foreground">{new Date(note.createdAt).toLocaleDateString()}{note.pinned && <Badge variant="amber" className="ml-2 text-[9px] py-0">Pinned</Badge>}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
