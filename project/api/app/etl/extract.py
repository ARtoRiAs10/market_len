"""
ETL Step 1 — Extract
====================
Pull raw quarterly fundamentals for a ticker from the chosen provider and
return a pandas DataFrame.

This is Step 1 of 4. The DataFrame returned here has snake_case column names
matching the provider output. No transformation or validation is done yet.
"""
from __future__ import annotations
import pandas as pd
from app.providers import get_provider


def extract(ticker: str, quarters: int, source_type: str) -> pd.DataFrame:
    """
    Parameters
    ----------
    ticker      : company ticker symbol (uppercased before passing in)
    quarters    : how many trailing quarters of history to pull
    source_type : "MOCK" | "ALPHA_VANTAGE" | "FMP"

    Returns
    -------
    pd.DataFrame  – raw quarterly records (one row per quarter, oldest first)
    """
    provider = get_provider(source_type)
    raw_records = provider.fetch_quarters(ticker, quarters)

    if not raw_records:
        raise ValueError(f"Provider {source_type} returned no records for {ticker}")

    df = pd.DataFrame(raw_records)
    df["ticker"] = ticker
    df["source_type"] = source_type

    # Sort oldest → newest (provider may return newest-first)
    df = df.sort_values(["fiscal_year", "fiscal_quarter"]).reset_index(drop=True)

    return df
