import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getStrategyBySlug } from "@/lib/strategies/registry";
import { rateLimit } from "@/lib/rate-limit";
import { getUserPlan } from "@/lib/plan-limits";
import { z } from "zod";

const schema = z.object({
  ticker: z.string(),
  strategySlug: z.string(),
  question: z.string().max(500),
  parameters: z.record(z.union([z.number(), z.string(), z.boolean()])).default({}),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const plan = await getUserPlan(session.user.id);
  if (plan === "FREE") return NextResponse.json({ error: "AI Analyst is available on Pro and Enterprise plans." }, { status: 403 });

  const limited = rateLimit(`ai-analyst:${session.user.id}`, { limit: 10, windowMs: 60_000 });
  if (!limited.success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const { ticker, strategySlug, question, parameters } = parsed.data;
  const strategy = getStrategyBySlug(strategySlug);
  if (!strategy) return NextResponse.json({ error: "Strategy not found" }, { status: 404 });

  const company = await prisma.company.findUnique({
    where: { ticker: ticker.toUpperCase() },
    include: { quarters: { orderBy: [{ fiscalYear: "asc" }, { fiscalQuarter: "asc" }] } },
  });
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  if (company.quarters.length < strategy.minQuartersRequired) {
    return NextResponse.json({ error: "Insufficient quarterly data to analyse." }, { status: 422 });
  }

  const result = strategy.evaluate(company.quarters, parameters);
  const latest = company.quarters[company.quarters.length - 1];
  const prev = company.quarters[company.quarters.length - 5] ?? company.quarters[company.quarters.length - 2];

  // Build context for Claude
  const contextData = {
    company: { ticker: company.ticker, name: company.name, sector: company.sector, industry: company.industry },
    strategy: { name: strategy.name, slug: strategy.slug },
    result: { score: result.score, verdict: result.verdict, summary: result.summary },
    criteria: result.criteria.filter(c => c.weight > 0).map(c => ({ label: c.label, category: c.category, pass: c.pass, value: c.value, threshold: c.threshold })),
    latestQuarter: {
      period: `Q${latest.fiscalQuarter} FY${latest.fiscalYear}`,
      revenue: latest.revenue, netIncome: latest.netIncome, totalAssets: latest.totalAssets,
      totalEquity: latest.totalEquity, operatingCashFlow: latest.operatingCashFlow,
      grossProfit: latest.grossProfit, totalDebt: latest.totalDebt,
    },
    priorYearQuarter: prev ? { period: `Q${prev.fiscalQuarter} FY${prev.fiscalYear}`, revenue: prev.revenue, netIncome: prev.netIncome } : null,
  };

  const systemPrompt = `You are a senior financial analyst specialising in fundamental equity analysis and credit risk. 
You have access to a company's latest quarterly financial data and the results of a ${strategy.name} analysis.
Answer the user's question concisely and precisely, referencing specific numbers from the data provided.
Be direct — this is for professionals. Cite the specific criterion names, values, and thresholds where relevant.
Format numbers clearly (e.g. "$12.3M", "4.2%", "1.8x"). Use no more than 200 words unless the question requires more detail.`;

  const userPrompt = `Company: ${company.name} (${company.ticker}) — ${company.sector} / ${company.industry}

Strategy: ${strategy.name}
Score: ${result.score}/100 — Verdict: ${result.verdict}
Summary: ${result.summary}

Criteria Results:
${result.criteria.filter(c => c.weight > 0).map(c => `• ${c.label}: ${c.pass === true ? "PASS" : c.pass === false ? "FAIL" : "N/A"} | Value: ${c.value !== null ? c.value.toFixed(4) : "N/A"} | Threshold: ${c.threshold}`).join("\n")}

Latest Quarter (${contextData.latestQuarter.period}):
Revenue: ${contextData.latestQuarter.revenue}
Net Income: ${contextData.latestQuarter.netIncome}
Total Assets: ${contextData.latestQuarter.totalAssets}
Total Equity: ${contextData.latestQuarter.totalEquity}
Operating Cash Flow: ${contextData.latestQuarter.operatingCashFlow}
${contextData.priorYearQuarter ? `\nPrior Year (${contextData.priorYearQuarter.period}):\nRevenue: ${contextData.priorYearQuarter.revenue}\nNet Income: ${contextData.priorYearQuarter.netIncome}` : ""}

User question: ${question}`;

  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-opus-4-6",
        max_tokens: 512,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!anthropicRes.ok) {
      const err = await anthropicRes.text();
      console.error("[ai-analyst] Anthropic error:", err);
      return NextResponse.json({ error: "AI service unavailable. Check ANTHROPIC_API_KEY." }, { status: 502 });
    }

    const aiData = await anthropicRes.json();
    const answer = aiData.content?.[0]?.text ?? "No response generated.";

    return NextResponse.json({ answer, ticker: company.ticker, strategyName: strategy.name, score: result.score, verdict: result.verdict });
  } catch (err) {
    console.error("[ai-analyst] fetch error:", err);
    return NextResponse.json({ error: "Failed to reach AI service." }, { status: 502 });
  }
}
