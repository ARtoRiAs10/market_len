/**
 * Display-only copies of the Python snippets that run inside the FastAPI
 * ETL service (see /api/app/etl/*.py for the real, executed versions).
 * Shown in the UI so users understand exactly what each stage does.
 */
export const ETL_CODE_SNIPPETS = {
  extract: `# api/app/etl/extract.py
import pandas as pd
from app.providers.mock_provider import MockProvider
from app.providers.alpha_vantage import AlphaVantageProvider
from app.providers.fmp import FMPProvider

PROVIDERS = {
    "MOCK": MockProvider(),
    "ALPHA_VANTAGE": AlphaVantageProvider(),
    "FMP": FMPProvider(),
}

def extract(ticker: str, quarters: int, source_type: str) -> pd.DataFrame:
    """Pull raw quarterly fundamentals for a ticker into a DataFrame."""
    provider = PROVIDERS[source_type]
    raw_records = provider.fetch_quarters(ticker, quarters)
    df = pd.DataFrame(raw_records)
    df["ticker"] = ticker
    return df
`,

  transform: `# api/app/etl/transform.py
import pandas as pd
import numpy as np

def transform(df: pd.DataFrame) -> pd.DataFrame:
    """Derive ratio columns used by every strategy (margins, ROA/ROE, etc.)."""
    df = df.sort_values(["fiscal_year", "fiscal_quarter"]).copy()

    df["gross_margin"] = df["gross_profit"] / df["revenue"]
    df["operating_margin"] = df["operating_income"] / df["revenue"]
    df["net_margin"] = df["net_income"] / df["revenue"]

    df["roa"] = df["net_income"] / df["total_assets"]
    df["roe"] = df["net_income"] / df["total_equity"]

    df["current_ratio"] = df["current_assets"] / df["current_liabilities"]
    df["quick_ratio"] = (df["current_assets"] - df["inventory"]) / df["current_liabilities"]
    df["debt_to_equity"] = df["total_liabilities"] / df["total_equity"]
    df["asset_turnover"] = df["revenue"] / df["total_assets"]

    # Year-over-year deltas (4-quarter shift), used by the F-Score criteria
    for col in ["roa", "gross_margin", "current_ratio", "debt_to_equity"]:
        df[f"{col}_yoy_delta"] = df[col] - df[col].shift(4)

    df = df.replace([np.inf, -np.inf], np.nan)
    return df
`,

  validate: `# api/app/etl/validate.py
import pandas as pd

REQUIRED_COLUMNS = [
    "revenue", "net_income", "total_assets", "total_equity",
    "current_assets", "current_liabilities", "operating_cash_flow",
]

class ValidationError(Exception):
    pass

def validate(df: pd.DataFrame) -> pd.DataFrame:
    """Schema + sanity checks before loading into Postgres."""
    missing_cols = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing_cols:
        raise ValidationError(f"Missing required columns: {missing_cols}")

    null_ratio = df[REQUIRED_COLUMNS].isna().mean()
    bad_cols = null_ratio[null_ratio > 0.5].index.tolist()
    if bad_cols:
        raise ValidationError(f"Too many nulls in columns: {bad_cols}")

    if (df["total_assets"] <= 0).any():
        raise ValidationError("total_assets must be positive for every quarter")

    if df.duplicated(subset=["fiscal_year", "fiscal_quarter"]).any():
        raise ValidationError("Duplicate fiscal_year/fiscal_quarter rows found")

    return df
`,

  load: `# api/app/etl/load.py
import httpx
from datetime import datetime

async def load(job_id: str, ticker: str, df, callback_url: str, callback_secret: str):
    """POST the cleaned, validated quarters back to Next.js, which writes
    them to Neon Postgres via Prisma (keeps a single ORM/source of truth)."""
    quarters_payload = df.to_dict(orient="records")

    async with httpx.AsyncClient(timeout=30) as client:
        await client.post(
            callback_url,
            json={
                "secret": callback_secret,
                "stage": "LOAD",
                "status": "SUCCEEDED",
                "stepLog": {
                    "step": "load",
                    "startedAt": datetime.utcnow().isoformat(),
                    "rowsIn": len(quarters_payload),
                    "rowsOut": len(quarters_payload),
                    "message": f"Loaded {len(quarters_payload)} quarters for {ticker}",
                },
                "payload": {"ticker": ticker, "quarters": quarters_payload},
            },
        )
`,
};
