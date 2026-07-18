import { getEnv } from "@/lib/env";

/**
 * Thin client for the FastAPI ETL microservice (see /api directory at repo
 * root). Next.js triggers jobs here; the FastAPI service does the actual
 * extract -> transform -> validate -> load work and writes step-by-step
 * logs back via the callback endpoint (/api/etl/[jobId]/callback).
 */

export interface EtlRunRequest {
  jobId: string;
  ticker: string;
  quarters: number;
  sourceType: "MOCK" | "ALPHA_VANTAGE" | "FMP";
  callbackUrl: string;
  callbackSecret: string;
}

export interface EtlRunResponse {
  accepted: boolean;
  jobId: string;
  message: string;
}

export async function triggerEtlJob(payload: EtlRunRequest): Promise<EtlRunResponse> {
  const env = getEnv();
  const base = env.ETL_SERVICE_URL;

  if (!base) {
    throw new Error(
      "ETL_SERVICE_URL is not configured. Start the FastAPI service (see /api/README.md) and set ETL_SERVICE_URL in web/.env"
    );
  }

  const res = await fetch(`${base.replace(/\/$/, "")}/jobs/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(env.ETL_SERVICE_API_KEY ? { "X-API-Key": env.ETL_SERVICE_API_KEY } : {}),
    },
    body: JSON.stringify(payload),
    // ETL jobs are kicked off async; the FastAPI service responds immediately
    // with "accepted" and streams progress back via the callback URL.
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ETL service error (${res.status}): ${text}`);
  }

  return res.json();
}
