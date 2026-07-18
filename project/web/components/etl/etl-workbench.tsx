"use client";
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Play, Database, Filter, ShieldCheck, UploadCloud } from "lucide-react";
import { ETL_CODE_SNIPPETS } from "@/components/etl/etl-snippets";
import { CodeBlock } from "@/components/etl/code-block";

interface Company { ticker: string; name: string }
interface JobLog {
  id: string;
  ticker: string;
  stage: string;
  status: string;
  createdAt: string;
  stepLogs: { step: string; message?: string; rowsIn?: number; rowsOut?: number }[];
}

const STAGES = [
  { key: "EXTRACT", label: "Extract", icon: Database },
  { key: "TRANSFORM", label: "Transform", icon: Filter },
  { key: "VALIDATE", label: "Validate", icon: ShieldCheck },
  { key: "LOAD", label: "Load", icon: UploadCloud },
] as const;

export function EtlWorkbench({ companies, recentJobs }: { companies: Company[]; recentJobs: JobLog[] }) {
  const { toast } = useToast();
  const [ticker, setTicker] = React.useState(companies[0]?.ticker ?? "");
  const [customTicker, setCustomTicker] = React.useState("");
  const [quarters, setQuarters] = React.useState(12);
  const [sourceType, setSourceType] = React.useState<"MOCK" | "ALPHA_VANTAGE" | "FMP">("MOCK");
  const [loading, setLoading] = React.useState(false);
  const [activeJob, setActiveJob] = React.useState<JobLog | null>(recentJobs[0] ?? null);
  const [jobs, setJobs] = React.useState<JobLog[]>(recentJobs);

  const effectiveTicker = customTicker.trim() ? customTicker.trim().toUpperCase() : ticker;

  async function startJob() {
    if (!effectiveTicker) {
      toast({ title: "Choose or enter a ticker first", variant: "destructive" as any });
      return;
    }
    setLoading(true);
    const res = await fetch("/api/etl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker: effectiveTicker, quarters, sourceType }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      toast({ title: "Couldn't start ETL job", description: data.error, variant: "destructive" as any });
      return;
    }

    const newJob: JobLog = {
      id: data.job.id,
      ticker: effectiveTicker,
      stage: data.job.stage,
      status: data.job.status,
      createdAt: data.job.createdAt,
      stepLogs: [],
    };
    setJobs((j) => [newJob, ...j]);
    setActiveJob(newJob);
    toast({ title: "ETL job started", description: `Extracting data for ${effectiveTicker}...` });
    pollJob(data.job.id);
  }

  function pollJob(jobId: string) {
    const interval = setInterval(async () => {
      const res = await fetch(`/api/etl/${jobId}`);
      if (!res.ok) return clearInterval(interval);
      const data = await res.json();
      const updated: JobLog = {
        id: data.job.id,
        ticker: data.job.company?.ticker ?? effectiveTicker,
        stage: data.job.stage,
        status: data.job.status,
        createdAt: data.job.createdAt,
        stepLogs: data.job.stepLogs ?? [],
      };
      setJobs((js) => js.map((j) => (j.id === jobId ? updated : j)));
      setActiveJob((curr) => (curr?.id === jobId ? updated : curr));

      if (data.job.status === "SUCCEEDED" || data.job.status === "FAILED") {
        clearInterval(interval);
        if (data.job.status === "SUCCEEDED") {
          toast({ title: "ETL job complete", description: `${updated.ticker} financial data loaded.` });
        } else {
          toast({ title: "ETL job failed", description: data.job.errorMessage, variant: "destructive" as any });
        }
      }
    }, 1500);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Start a pipeline run</CardTitle>
          <CardDescription>Choose input data, then run extract → transform → validate → load.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Company from watchlist</Label>
            <Select value={ticker} onValueChange={(v) => { setTicker(v); setCustomTicker(""); }}>
              <SelectTrigger><SelectValue placeholder="Select a company" /></SelectTrigger>
              <SelectContent>
                {companies.map((c) => (
                  <SelectItem key={c.ticker} value={c.ticker}>
                    <span className="font-mono">{c.ticker}</span> — {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">...or enter any ticker</Label>
            <Input
              placeholder="e.g. NEWCO"
              value={customTicker}
              onChange={(e) => setCustomTicker(e.target.value.toUpperCase())}
              className="font-mono"
              maxLength={10}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Quarters of history</Label>
            <Input type="number" min={4} max={40} value={quarters} onChange={(e) => setQuarters(parseInt(e.target.value || "12"))} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Data source</Label>
            <Select value={sourceType} onValueChange={(v: any) => setSourceType(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="MOCK">Mock generator (no API key needed)</SelectItem>
                <SelectItem value="ALPHA_VANTAGE">Alpha Vantage (requires API key)</SelectItem>
                <SelectItem value="FMP">Financial Modeling Prep (requires API key)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={startJob} disabled={loading} className="w-full">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Run ETL pipeline
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-6">
        {/* Stage progress + recent jobs */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{activeJob ? `Job: ${activeJob.ticker}` : "No job selected"}</CardTitle>
            {activeJob && <CardDescription>Status: {activeJob.status}</CardDescription>}
          </CardHeader>
          <CardContent>
            {!activeJob && <p className="text-sm text-muted-foreground">Start a pipeline run to see progress here.</p>}
            {activeJob && (
              <div className="grid grid-cols-4 gap-2">
                {STAGES.map((s, i) => {
                  const stageOrder = STAGES.findIndex((x) => x.key === activeJob.stage);
                  const isDone = i < stageOrder || activeJob.stage === "DONE" || activeJob.status === "SUCCEEDED";
                  const isActive = s.key === activeJob.stage && activeJob.status === "RUNNING";
                  const Icon = s.icon;
                  return (
                    <div
                      key={s.key}
                      className={`flex flex-col items-center gap-2 rounded-md border p-3 text-center ${
                        isDone ? "border-signal-positive/40 bg-signal-positive/5" : isActive ? "border-signal-amber/40 bg-signal-amber/5" : ""
                      }`}
                    >
                      <Icon className={`h-4 w-4 ${isDone ? "text-signal-positive" : isActive ? "text-signal-amber animate-pulse" : "text-muted-foreground"}`} />
                      <span className="text-xs font-medium">{s.label}</span>
                    </div>
                  );
                })}
              </div>
            )}
            {activeJob && activeJob.stepLogs.length > 0 && (
              <div className="mt-4 space-y-1.5 font-mono text-xs text-muted-foreground">
                {activeJob.stepLogs.map((log, i) => (
                  <div key={i} className="flex justify-between border-b py-1 last:border-0">
                    <span>{log.step}{log.message ? `: ${log.message}` : ""}</span>
                    {log.rowsIn !== undefined && <span>{log.rowsIn}→{log.rowsOut} rows</span>}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Step-by-step code walkthrough */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pipeline code</CardTitle>
            <CardDescription>The exact Python steps the FastAPI service runs for each stage.</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="extract">
              <TabsList>
                <TabsTrigger value="extract">Extract</TabsTrigger>
                <TabsTrigger value="transform">Transform</TabsTrigger>
                <TabsTrigger value="validate">Validate</TabsTrigger>
                <TabsTrigger value="load">Load</TabsTrigger>
              </TabsList>
              <TabsContent value="extract"><CodeBlock code={ETL_CODE_SNIPPETS.extract} /></TabsContent>
              <TabsContent value="transform"><CodeBlock code={ETL_CODE_SNIPPETS.transform} /></TabsContent>
              <TabsContent value="validate"><CodeBlock code={ETL_CODE_SNIPPETS.validate} /></TabsContent>
              <TabsContent value="load"><CodeBlock code={ETL_CODE_SNIPPETS.load} /></TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Recent jobs list */}
        <Card>
          <CardHeader><CardTitle className="text-base">Recent jobs</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {jobs.length === 0 && <p className="text-sm text-muted-foreground">No jobs yet.</p>}
            {jobs.map((j) => (
              <button
                key={j.id}
                onClick={() => setActiveJob(j)}
                className="flex w-full items-center justify-between rounded-md border p-3 text-left text-sm hover:bg-secondary/40"
              >
                <span className="font-mono">{j.ticker}</span>
                <Badge variant={j.status === "SUCCEEDED" ? "positive" : j.status === "FAILED" ? "negative" : "amber"}>
                  {j.status}
                </Badge>
              </button>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
