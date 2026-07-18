"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

export function AddCompanyForm({ seedTickers }: { seedTickers: { ticker: string; name: string }[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [ticker, setTicker] = useState("");
  const [loading, setLoading] = useState(false);

  async function addTicker(value: string) {
    if (!value.trim()) return;
    setLoading(true);
    const res = await fetch("/api/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker: value }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      toast({ title: "Couldn't add company", description: data.error, variant: "destructive" as any });
      return;
    }

    toast({ title: `${data.company.ticker} added`, description: "Generating quarterly fundamentals..." });
    setTicker("");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          addTicker(ticker);
        }}
        className="flex gap-2"
      >
        <Input
          placeholder="e.g. NEXG"
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          maxLength={10}
          className="max-w-xs font-mono"
        />
        <Button type="submit" disabled={loading}>
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          Add
        </Button>
      </form>
      <div className="flex flex-wrap gap-2">
        {seedTickers.map((c) => (
          <button key={c.ticker} onClick={() => addTicker(c.ticker)} disabled={loading}>
            <Badge variant="outline" className="cursor-pointer hover:bg-secondary">
              {c.ticker}
            </Badge>
          </button>
        ))}
      </div>
    </div>
  );
}
