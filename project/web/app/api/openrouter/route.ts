/**
 * OpenRouter AI Analyst endpoint
 * Supports 200+ models via a single API — user selects model in settings.
 * Falls back gracefully when OPENROUTER_API_KEY is not set.
 * Docs: https://openrouter.ai/docs
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getStrategyBySlug } from "@/lib/strategies/registry";
import { rateLimit } from "@/lib/rate-limit";
import { getUserPlan } from "@/lib/plan-limits";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

const OPENROUTER_MODELS = [
  { id: "anthropic/claude-opus-4-6",     label: "Claude Opus 4.6 (Anthropic)" },
  { id: "openai/gpt-4o",                  label: "GPT-4o (OpenAI)" },
  { id: "openai/gpt-4o-mini",             label: "GPT-4o Mini (OpenAI)" },
  { id: "google/gemini-pro-1.5",          label: "Gemini Pro 1.5 (Google)" },
  { id: "mistralai/mistral-large",        label: "Mistral Large" },
  { id: "meta-llama/llama-3.1-70b-instruct", label: "Llama 3.1 70B (Meta)" },
  { id: "deepseek/deepseek-r1",           label: "DeepSeek R1" },
  { id: "qwen/qwen-2.5-72b-instruct",    label: "Qwen 2.5 72B" },
];

export { OPENROUTER_MODELS };

const schema = z.object({
  ticker: z.string(),
  strategySlug: z.string(),
  question: z.string().max(600),
  parameters: z.record(z.union([z.number(), z.string(), z.boolean()])).default({}),
  model: z.string().default("anthropic/claude-opus-4-6"),
});

export async function GET() {
  return NextResponse.json({ models: OPENROUTER_MODELS });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const plan = await getUserPlan(session.user.id);
  if (plan === "FREE") return NextResponse.json({ error: "AI Analyst is available on Pro and Enterprise plans." }, { status: 403 });

  const limited = rateLimit(`openrouter:${session.user.id}`, { limit: 15, windowMs: 60_000 });
  if (!limited.success) return NextResponse.json({ error: "Too many requests (15/min). Slow down." }, { status: 429 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const { ticker, strategySlug, question, parameters, model } = parsed.data;

  const strategy = getStrategyBySlug(strategySlug);
  if (!strategy) return NextResponse.json({ error: "Strategy not found" }, { status: 404 });

  const company = await prisma.company.findUnique({
    where: { ticker: ticker.toUpperCase() },
    include: { quarters: { orderBy: [{ fiscalYear: "asc" }, { fiscalQuarter: "asc" }] } },
  });
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  if (company.quarters.length < strategy.minQuartersRequired) {
    return NextResponse.json({ error: "Insufficient data for analysis." }, { status: 422 });
  }

  const result = strategy.evaluate(company.quarters, parameters);
  const latest = company.quarters[company.quarters.length - 1];
  const prior  = company.quarters[company.quarters.length - 5] ?? company.quarters[company.quarters.length - 2];

  const systemPrompt = `You are a senior financial analyst specialising in ${strategy.name}.
Answer in ≤200 words. Be direct, cite specific numbers from the data. Format: plain prose, no markdown headers.`;

  const userContent = `Company: ${company.name} (${company.ticker}) — ${company.sector ?? "Unknown sector"}
Strategy: ${strategy.name} | Score: ${result.score}/100 | Verdict: ${result.verdict}
Summary: ${result.summary}

Criteria (scored):
${result.criteria.filter(c => c.weight > 0).map(c =>
  `  ${c.pass === true ? "✓" : c.pass === false ? "✗" : "?"} ${c.label}: value=${c.value?.toFixed(4) ?? "N/A"}, threshold=${c.threshold ?? "—"}`
).join("\n")}

Latest (Q${latest.fiscalQuarter} FY${latest.fiscalYear}): Revenue=$${Number(latest.revenue ?? 0).toLocaleString()}, NetIncome=$${Number(latest.netIncome ?? 0).toLocaleString()}, Assets=$${Number(latest.totalAssets ?? 0).toLocaleString()}, OCF=$${Number(latest.operatingCashFlow ?? 0).toLocaleString()}
${prior ? `Prior (Q${prior.fiscalQuarter} FY${prior.fiscalYear}): Revenue=$${Number(prior.revenue ?? 0).toLocaleString()}, NetIncome=$${Number(prior.netIncome ?? 0).toLocaleString()}` : ""}

Question: ${question}`;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OPENROUTER_API_KEY not configured in web/.env", model, ticker }, { status: 502 });
  }

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXTAUTH_URL ?? "http://localhost:3000",
        "X-Title": "MarketLens AI Analyst",
      },
      body: JSON.stringify({
        model,
        max_tokens: 512,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[openrouter]", res.status, err);
      return NextResponse.json({ error: `OpenRouter error (${res.status}). Check your API key and model name.` }, { status: 502 });
    }

    const data = await res.json();
    const answer = data.choices?.[0]?.message?.content ?? "No response generated.";
    const usage  = data.usage ?? {};

    await logAudit({
      userId: session.user.id,
      action: "ai.openrouter",
      metadata: { model, ticker, strategySlug, tokensUsed: usage.total_tokens },
    });

    return NextResponse.json({ answer, model, ticker, strategyName: strategy.name, score: result.score, verdict: result.verdict, usage });
  } catch (err: any) {
    console.error("[openrouter] fetch error:", err);
    return NextResponse.json({ error: "Failed to reach OpenRouter. Check network and API key." }, { status: 502 });
  }
}
