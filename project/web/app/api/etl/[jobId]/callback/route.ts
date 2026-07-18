import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateMockCompanyProfile } from "@/lib/mock-data";
import crypto from "crypto";
import { z } from "zod";

/**
 * Callback endpoint invoked BY the FastAPI ETL microservice as each pipeline
 * stage completes. Authenticated via an HMAC signature (not user session)
 * since the caller is a trusted backend service, not a logged-in browser.
 */

const callbackSchema = z.object({
  secret: z.string(),
  stage: z.enum(["EXTRACT", "TRANSFORM", "VALIDATE", "LOAD", "DONE"]),
  status: z.enum(["QUEUED", "RUNNING", "SUCCEEDED", "FAILED"]),
  stepLog: z.object({
    step: z.string(),
    startedAt: z.string(),
    finishedAt: z.string().optional(),
    rowsIn: z.number().optional(),
    rowsOut: z.number().optional(),
    message: z.string().optional(),
  }),
  errorMessage: z.string().optional(),
  // Present only on the final LOAD/DONE callback:
  payload: z
    .object({
      ticker: z.string(),
      profile: z
        .object({
          name: z.string(),
          sector: z.string(),
          industry: z.string(),
          exchange: z.string(),
          country: z.string(),
          description: z.string(),
          employeeCount: z.number(),
        })
        .optional(),
      quarters: z
        .array(
          z.object({
            fiscalYear: z.number(),
            fiscalQuarter: z.number(),
            periodEndDate: z.string(),
            revenue: z.number().nullable(),
            costOfRevenue: z.number().nullable(),
            grossProfit: z.number().nullable(),
            operatingExpense: z.number().nullable(),
            operatingIncome: z.number().nullable(),
            netIncome: z.number().nullable(),
            ebitda: z.number().nullable(),
            eps: z.number().nullable(),
            sharesOutstanding: z.number().nullable(),
            totalAssets: z.number().nullable(),
            totalLiabilities: z.number().nullable(),
            totalEquity: z.number().nullable(),
            currentAssets: z.number().nullable(),
            currentLiabilities: z.number().nullable(),
            cash: z.number().nullable(),
            totalDebt: z.number().nullable(),
            longTermDebt: z.number().nullable(),
            inventory: z.number().nullable(),
            receivables: z.number().nullable(),
            operatingCashFlow: z.number().nullable(),
            capex: z.number().nullable(),
            freeCashFlow: z.number().nullable(),
            dividendsPaid: z.number().nullable(),
            closePrice: z.number().nullable(),
            volumeAvg: z.number().nullable(),
            grossMargin: z.number().nullable().optional(),
            operatingMargin: z.number().nullable().optional(),
            netMargin: z.number().nullable().optional(),
            roa: z.number().nullable().optional(),
            roe: z.number().nullable().optional(),
            currentRatio: z.number().nullable().optional(),
          })
        )
        .optional(),
      summary: z.record(z.any()).optional(),
    })
    .optional(),
});

export async function POST(req: NextRequest, { params }: { params: { jobId: string } }) {
  const job = await prisma.etlJob.findUnique({ where: { id: params.jobId } });
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = callbackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid callback payload" }, { status: 400 });
  }

  const expectedSecret = crypto
    .createHmac("sha256", process.env.NEXTAUTH_SECRET ?? "dev-secret")
    .update(job.id)
    .digest("hex");

  if (parsed.data.secret !== expectedSecret) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const { stage, status, stepLog, errorMessage, payload } = parsed.data;

  const existingLogs = Array.isArray(job.stepLogs) ? (job.stepLogs as any[]) : [];
  const updatedLogs = [...existingLogs, stepLog];

  // On final LOAD/DONE stage with payload, upsert the company + quarters
  if (status === "SUCCEEDED" && (stage === "LOAD" || stage === "DONE") && payload) {
    const ticker = payload.ticker.toUpperCase();
    const profile = payload.profile ?? generateMockCompanyProfile(ticker);

    const company = await prisma.company.upsert({
      where: { ticker },
      create: {
        ticker,
        name: profile.name,
        sector: profile.sector,
        industry: profile.industry,
        exchange: profile.exchange,
        country: profile.country,
        description: profile.description,
        employeeCount: profile.employeeCount,
        source: job.sourceType,
      },
      update: {
        sector: profile.sector,
        industry: profile.industry,
      },
    });

    if (payload.quarters) {
      for (const q of payload.quarters) {
        await prisma.financialQuarter.upsert({
          where: {
            companyId_fiscalYear_fiscalQuarter: {
              companyId: company.id,
              fiscalYear: q.fiscalYear,
              fiscalQuarter: q.fiscalQuarter,
            },
          },
          create: {
            companyId: company.id,
            fiscalYear: q.fiscalYear,
            fiscalQuarter: q.fiscalQuarter,
            periodEndDate: new Date(q.periodEndDate),
            revenue: q.revenue, costOfRevenue: q.costOfRevenue, grossProfit: q.grossProfit,
            operatingExpense: q.operatingExpense, operatingIncome: q.operatingIncome,
            netIncome: q.netIncome, ebitda: q.ebitda, eps: q.eps, sharesOutstanding: q.sharesOutstanding,
            totalAssets: q.totalAssets, totalLiabilities: q.totalLiabilities, totalEquity: q.totalEquity,
            currentAssets: q.currentAssets, currentLiabilities: q.currentLiabilities, cash: q.cash,
            totalDebt: q.totalDebt, longTermDebt: q.longTermDebt, inventory: q.inventory, receivables: q.receivables,
            operatingCashFlow: q.operatingCashFlow, capex: q.capex, freeCashFlow: q.freeCashFlow,
            dividendsPaid: q.dividendsPaid, closePrice: q.closePrice, volumeAvg: q.volumeAvg,
            grossMargin: q.grossMargin, operatingMargin: q.operatingMargin, netMargin: q.netMargin,
            roa: q.roa, roe: q.roe, currentRatio: q.currentRatio,
          },
          update: {
            revenue: q.revenue, costOfRevenue: q.costOfRevenue, grossProfit: q.grossProfit,
            operatingExpense: q.operatingExpense, operatingIncome: q.operatingIncome,
            netIncome: q.netIncome, ebitda: q.ebitda, eps: q.eps, sharesOutstanding: q.sharesOutstanding,
            totalAssets: q.totalAssets, totalLiabilities: q.totalLiabilities, totalEquity: q.totalEquity,
            currentAssets: q.currentAssets, currentLiabilities: q.currentLiabilities, cash: q.cash,
            totalDebt: q.totalDebt, longTermDebt: q.longTermDebt, inventory: q.inventory, receivables: q.receivables,
            operatingCashFlow: q.operatingCashFlow, capex: q.capex, freeCashFlow: q.freeCashFlow,
            dividendsPaid: q.dividendsPaid, closePrice: q.closePrice, volumeAvg: q.volumeAvg,
            grossMargin: q.grossMargin, operatingMargin: q.operatingMargin, netMargin: q.netMargin,
            roa: q.roa, roe: q.roe, currentRatio: q.currentRatio,
          },
        });
      }
    }

    await prisma.etlJob.update({
      where: { id: job.id },
      data: {
        companyId: company.id,
        stage: "DONE",
        status: "SUCCEEDED",
        stepLogs: updatedLogs as any,
        resultSummary: payload.summary as any,
        completedAt: new Date(),
      },
    });

    return NextResponse.json({ success: true });
  }

  await prisma.etlJob.update({
    where: { id: job.id },
    data: {
      stage,
      status: status === "FAILED" ? "FAILED" : job.status === "FAILED" ? "FAILED" : "RUNNING",
      stepLogs: updatedLogs as any,
      errorMessage: errorMessage ?? job.errorMessage,
      ...(status === "FAILED" ? { completedAt: new Date() } : {}),
    },
  });

  return NextResponse.json({ success: true });
}
