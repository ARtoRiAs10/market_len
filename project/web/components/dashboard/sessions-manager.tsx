"use client";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Monitor, Loader2 } from "lucide-react";

interface SessionRow { id: string; expires: string }

export function SessionsManager({ sessions, currentToken }: { sessions: SessionRow[]; currentToken: string }) {
  const { toast } = useToast();
  const [revoking, setRevoking] = useState<string | null>(null);
  const [list, setList] = useState(sessions);

  async function revoke(id: string) {
    setRevoking(id);
    await fetch("/api/sessions/" + id, { method: "DELETE" });
    setList(l => l.filter(s => s.id !== id));
    setRevoking(null);
    toast({ title: "Session revoked" });
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{list.length} active session{list.length !== 1 ? "s" : ""}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {list.length === 0 && <p className="text-sm text-muted-foreground">No other active sessions.</p>}
        {list.map(s => (
          <div key={s.id} className="flex items-center justify-between rounded-md border p-3">
            <div className="flex items-center gap-3">
              <Monitor className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-mono">{s.id.slice(0, 16)}…</p>
                <p className="text-xs text-muted-foreground">Expires: {new Date(s.expires).toLocaleString()}</p>
              </div>
            </div>
            <Button size="sm" variant="outline" className="text-destructive" onClick={() => revoke(s.id)} disabled={revoking === s.id}>
              {revoking === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Revoke"}
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
