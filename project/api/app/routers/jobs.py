"""
/jobs router
============
POST /jobs/run   – accept a job from Next.js, run the 4-step ETL pipeline
                   asynchronously, stream step-logs back via callback URL.
GET  /jobs/health – liveness check
"""
from __future__ import annotations
import asyncio
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Header
from pydantic import BaseModel

from app.config import settings
from app.etl.extract import extract
from app.etl.transform import transform
from app.etl.validate import validate, ValidationError
from app.etl.load import load, send_stage_log

router = APIRouter(prefix="/jobs", tags=["jobs"])


# ── Auth ─────────────────────────────────────────────────────────────────────

def verify_api_key(x_api_key: str = Header(default="")):
    if x_api_key != settings.api_key:
        raise HTTPException(status_code=401, detail="Invalid API key")


# ── Schemas ───────────────────────────────────────────────────────────────────

class RunJobRequest(BaseModel):
    jobId: str
    ticker: str
    quarters: int = 12
    sourceType: str = "MOCK"
    callbackUrl: str
    callbackSecret: str


# ── Background worker ─────────────────────────────────────────────────────────

async def _notify_failed(callback_url: str, secret: str, stage: str, error: str) -> None:
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            await client.post(callback_url, json={
                "secret": secret,
                "stage": stage,
                "status": "FAILED",
                "stepLog": {
                    "step": stage.lower(),
                    "startedAt": datetime.now(timezone.utc).isoformat(),
                    "message": error,
                },
                "errorMessage": error,
            })
    except Exception as exc:
        print(f"[jobs] Failed to notify callback of failure: {exc}")


async def run_pipeline(req: RunJobRequest) -> None:
    ticker = req.ticker.upper()
    cb_url = req.callbackUrl
    cb_sec = req.callbackSecret

    # ── Stage 1: Extract ──────────────────────────────────────────────────────
    try:
        await send_stage_log(cb_url, cb_sec, "EXTRACT", "extract",
                             f"Fetching {req.quarters} quarters for {ticker} from {req.sourceType}")
        df_raw = extract(ticker, req.quarters, req.sourceType)
        await send_stage_log(cb_url, cb_sec, "EXTRACT", "extract",
                             f"Extracted {len(df_raw)} quarters",
                             rows_in=0, rows_out=len(df_raw))
    except Exception as exc:
        await _notify_failed(cb_url, cb_sec, "EXTRACT", str(exc))
        return

    # ── Stage 2: Transform ────────────────────────────────────────────────────
    try:
        await send_stage_log(cb_url, cb_sec, "TRANSFORM", "transform",
                             "Computing ratio and delta columns",
                             rows_in=len(df_raw))
        df_transformed = transform(df_raw)
        await send_stage_log(cb_url, cb_sec, "TRANSFORM", "transform",
                             f"Added {len(df_transformed.columns) - len(df_raw.columns)} derived columns",
                             rows_in=len(df_raw), rows_out=len(df_transformed))
    except Exception as exc:
        await _notify_failed(cb_url, cb_sec, "TRANSFORM", str(exc))
        return

    # ── Stage 3: Validate ─────────────────────────────────────────────────────
    try:
        await send_stage_log(cb_url, cb_sec, "VALIDATE", "validate",
                             "Running schema and sanity checks",
                             rows_in=len(df_transformed))
        df_validated = validate(df_transformed)
        await send_stage_log(cb_url, cb_sec, "VALIDATE", "validate",
                             "All validation checks passed",
                             rows_in=len(df_transformed), rows_out=len(df_validated))
    except ValidationError as exc:
        await _notify_failed(cb_url, cb_sec, "VALIDATE", str(exc))
        return
    except Exception as exc:
        await _notify_failed(cb_url, cb_sec, "VALIDATE", f"Unexpected error: {exc}")
        return

    # ── Stage 4: Load ─────────────────────────────────────────────────────────
    try:
        await send_stage_log(cb_url, cb_sec, "LOAD", "load",
                             "Posting validated data to Next.js callback",
                             rows_in=len(df_validated))
        await load(req.jobId, ticker, df_validated, cb_url, cb_sec)
    except Exception as exc:
        await _notify_failed(cb_url, cb_sec, "LOAD", str(exc))
        return


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/run")
async def run_job(
    req: RunJobRequest,
    background_tasks: BackgroundTasks,
    _: None = Depends(verify_api_key),
):
    """Accept a pipeline job and execute it asynchronously."""
    background_tasks.add_task(run_pipeline, req)
    return {"accepted": True, "jobId": req.jobId, "message": "Pipeline started"}


@router.get("/health")
async def health():
    return {"status": "ok", "service": "marketlens-etl"}
