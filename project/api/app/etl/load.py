"""
ETL Step 4 — Load
==================
POST the cleaned, validated, transformed DataFrame back to Next.js via the
/api/etl/[jobId]/callback endpoint.  Next.js writes the data to Neon Postgres
via Prisma (single source of truth for the ORM/schema).

Intermediate step logs are sent for each stage so the UI can show live progress.
"""
from __future__ import annotations
import asyncio
from datetime import datetime, timezone
from typing import Any

import httpx
import pandas as pd


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _series_to_payload(df: pd.DataFrame, ticker: str) -> dict[str, Any]:
    """
    Convert the DataFrame into the JSON shape expected by the Next.js callback handler.
    Column names are camelCased to match Prisma model fields.
    """
    COL_MAP = {
        "fiscal_year": "fiscalYear",
        "fiscal_quarter": "fiscalQuarter",
        "period_end_date": "periodEndDate",
        "revenue": "revenue",
        "cost_of_revenue": "costOfRevenue",
        "gross_profit": "grossProfit",
        "operating_expense": "operatingExpense",
        "operating_income": "operatingIncome",
        "net_income": "netIncome",
        "ebitda": "ebitda",
        "eps": "eps",
        "shares_outstanding": "sharesOutstanding",
        "total_assets": "totalAssets",
        "total_liabilities": "totalLiabilities",
        "total_equity": "totalEquity",
        "current_assets": "currentAssets",
        "current_liabilities": "currentLiabilities",
        "cash": "cash",
        "total_debt": "totalDebt",
        "long_term_debt": "longTermDebt",
        "inventory": "inventory",
        "receivables": "receivables",
        "operating_cash_flow": "operatingCashFlow",
        "capex": "capex",
        "free_cash_flow": "freeCashFlow",
        "dividends_paid": "dividendsPaid",
        "close_price": "closePrice",
        "volume_avg": "volumeAvg",
        "gross_margin": "grossMargin",
        "operating_margin": "operatingMargin",
        "net_margin": "netMargin",
        "roa": "roa",
        "roe": "roe",
        "current_ratio": "currentRatio",
    }

    cols_present = {k: v for k, v in COL_MAP.items() if k in df.columns}
    renamed = df[list(cols_present.keys())].rename(columns=cols_present)

    # Replace NaN with None for JSON serialisation
    records = renamed.where(pd.notna(renamed), other=None).to_dict(orient="records")

    return {
        "ticker": ticker,
        "quarters": records,
        "summary": {
            "rowCount": len(records),
            "fiscalRange": f"Q{records[0]['fiscalQuarter']} FY{records[0]['fiscalYear']} – Q{records[-1]['fiscalQuarter']} FY{records[-1]['fiscalYear']}" if records else "—",
        },
    }


async def _post_callback(callback_url: str, secret: str, payload: dict[str, Any]) -> None:
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(callback_url, json=payload)
        r.raise_for_status()


async def send_stage_log(
    callback_url: str,
    secret: str,
    stage: str,
    step: str,
    message: str,
    rows_in: int = 0,
    rows_out: int = 0,
) -> None:
    """Send an intermediate progress update for a pipeline stage."""
    await _post_callback(callback_url, secret, {
        "secret": secret,
        "stage": stage,
        "status": "RUNNING",
        "stepLog": {
            "step": step,
            "startedAt": _now(),
            "finishedAt": _now(),
            "rowsIn": rows_in,
            "rowsOut": rows_out,
            "message": message,
        },
    })


async def load(
    job_id: str,
    ticker: str,
    df: pd.DataFrame,
    callback_url: str,
    callback_secret: str,
) -> None:
    """POST the final payload to Next.js and mark the job DONE."""
    payload = _series_to_payload(df, ticker)
    rows = len(df)

    await _post_callback(callback_url, callback_secret, {
        "secret": callback_secret,
        "stage": "DONE",
        "status": "SUCCEEDED",
        "stepLog": {
            "step": "load",
            "startedAt": _now(),
            "finishedAt": _now(),
            "rowsIn": rows,
            "rowsOut": rows,
            "message": f"Loaded {rows} quarters for {ticker} into Neon Postgres",
        },
        "payload": payload,
    })
