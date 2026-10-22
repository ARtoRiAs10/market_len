"use client";
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Sparkles, Send, ChevronDown } from "lucide-react";
import { OPENROUTER_MODELS } from "@/lib/ai/models";

const SUGGESTIONS = [
  "Why did the score change this quarter?",
  "What's driving the ROE trend?",
  "Is the leverage level concerning?",
  "How does earnings quality look?",
  "What are the biggest risk factors?",
  "Compare profitability vs prior year.",
];

interface Props {
  ticker: string;
  strategySlug: string;
  parameters: Record<string, any>;
  isPro: boolean;
}

interface Message { role: "user" | "assistant"; content: string; model?: string }

export function AiAnalystPanel({ ticker, strategySlug, parameters, isPro }: Props) {
  const { toast } = useToast();
  const [question, setQuestion] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [model, setModel] = React.useState("anthropic/claude-opus-4-6");
  const [showModels, setShowModels] = React.useState(false);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function ask(q: string) {
    if (!q.trim() || !ticker || loading) return;
    const userMsg: Message = { role: "user", content: q };
    setMessages(m => [...m, userMsg]);
    setQuestion("");
    setLoading(true);

   
    const res = await fetch("/api/openrouter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker, strategySlug, question: q, parameters, model }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      toast({ title: "AI error", description: data.error, variant: "destructive" as any });
      setMessages(m => m.slice(0, -1));
      return;
    }

    setMessages(m => [...m, { role: "assistant", content: data.answer, model: data.model }]);
  }

  if (!isPro) {
    return (
      <Card className="border-signal-amber/30">
        <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
          <Sparkles className="h-6 w-6 text-signal-amber" />
          <p className="font-medium">AI Analyst — Multi-Model</p>
          <p className="text-sm text-muted-foreground max-w-sm">
            Ask questions about strategy results using GPT-4o, Claude, Gemini, Llama, and more — via OpenRouter.
            Available on Pro and Enterprise plans.
          </p>
          <Button size="sm" onClick={() => window.location.href = "/dashboard/billing"}>Upgrade to unlock</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-signal-amber" />
            <CardTitle className="text-base">AI Analyst</CardTitle>
          </div>
          <button
            onClick={() => setShowModels(s => !s)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Model <ChevronDown className="h-3 w-3" />
          </button>
        </div>
        {showModels && (
          <div className="pt-2">
            <Label className="text-xs">Choose model (via OpenRouter)</Label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger className="mt-1 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPENROUTER_MODELS.map(m => (
                  <SelectItem key={m.id} value={m.id} className="text-xs">{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Requires OPENROUTER_API_KEY in web/.env — <a href="https://openrouter.ai" target="_blank" className="underline">openrouter.ai</a>
            </p>
          </div>
        )}
        <CardDescription className="text-xs">Ask questions about this result. Powered by {OPENROUTER_MODELS.find(m2 => m2.id === model)?.label ?? model}.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map(s => (
              <button key={s} onClick={() => ask(s)}
                className="rounded-full border px-3 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors">
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.length > 0 && (
          <div className="max-h-72 space-y-3 overflow-y-auto scrollbar-thin pr-1">
            {messages.map((msg, i) => (
              <div key={i} className="flex gap-2">
                <Badge variant={msg.role === "user" ? "outline" : "secondary"} className="h-fit text-[10px] shrink-0 mt-0.5">
                  {msg.role === "user" ? "You" : <><Sparkles className="h-2.5 w-2.5 mr-0.5" />AI</>}
                </Badge>
                <div>
                  <p className="text-sm leading-relaxed">{msg.content}</p>
                  {msg.model && <p className="mt-0.5 text-[10px] text-muted-foreground">{OPENROUTER_MODELS.find(m => m.id === msg.model)?.label ?? msg.model}</p>}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex gap-2 items-center">
                <Badge variant="secondary" className="text-[10px]"><Sparkles className="h-2.5 w-2.5 mr-0.5" />AI</Badge>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}

        <div className="flex gap-2">
          <Input
            placeholder="e.g. Why did the F-Score drop this quarter?"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !e.shiftKey && ask(question)}
            disabled={loading}
            className="text-sm"
          />
          <Button size="icon" onClick={() => ask(question)} disabled={loading || !question.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
