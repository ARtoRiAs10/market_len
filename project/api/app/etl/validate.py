"""
ETL Step 3 — Validate
======================
Schema + sanity checks before writing to Postgres.
Raises ValidationError with a clear message on any failure so the job status
can reflect exactly what went wrong.
"""
from __future__ import annotations
import pandas as pd


REQUIRED_COLUMNS = [
    "fiscal_year", "fiscal_quarter", "period_end_date",
    "revenue", "net_income", "total_assets", "total_equity",
    "current_assets", "current_liabilities", "operating_cash_flow",
]

NULL_THRESHOLD   = 0.6   # more than 60% nulls in a required column = fail
MIN_ROWS         = 4     # need at least one year of history


class ValidationError(Exception):
    """Raised when the DataFrame fails validation checks."""


def validate(df: pd.DataFrame) -> pd.DataFrame:
    """
    Parameters
    ----------
    df : transformed DataFrame

    Returns
    -------
    Same DataFrame (allows chaining)

    Raises
    ------
    ValidationError
    """
    # 1. Minimum row count
    if len(df) < MIN_ROWS:
        raise ValidationError(
            f"Only {len(df)} quarters found; at least {MIN_ROWS} are required."
        )

    # 2. Required columns present
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValidationError(f"Missing required columns: {missing}")

    # 3. Null density check
    null_ratios = df[REQUIRED_COLUMNS].isna().mean()
    too_null = null_ratios[null_ratios > NULL_THRESHOLD].index.tolist()
    if too_null:
        raise ValidationError(
            f"Columns exceed {NULL_THRESHOLD*100:.0f}% null threshold: {too_null}"
        )

    # 4. Positive total_assets (nonsensical data guard)
    non_pos = df["total_assets"].dropna()
    if len(non_pos) > 0 and (non_pos <= 0).any():
        raise ValidationError("total_assets must be positive for all quarters.")

    # 5. Duplicate quarter check
    dup_mask = df.duplicated(subset=["fiscal_year", "fiscal_quarter"])
    if dup_mask.any():
        dups = df.loc[dup_mask, ["fiscal_year", "fiscal_quarter"]].to_dict("records")
        raise ValidationError(f"Duplicate fiscal_year/fiscal_quarter rows: {dups}")

    # 6. Chronological order sanity
    df_sorted = df.sort_values(["fiscal_year", "fiscal_quarter"])
    if not df.equals(df_sorted):
        # non-fatal – just reorder
        df = df_sorted.reset_index(drop=True)

    return df
