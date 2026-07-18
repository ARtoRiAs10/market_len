"""
ETL Step 2 — Transform
=======================
Derive ratio and delta columns used by every analysis strategy.
All arithmetic uses pandas/numpy so it is vectorised over the full history.

DuPont decomposition ratios are computed here:
  ROE = net_margin × asset_turnover × equity_multiplier
"""
from __future__ import annotations
import numpy as np
import pandas as pd


REQUIRED_NUMERICS = [
    "revenue", "gross_profit", "operating_income", "net_income",
    "total_assets", "total_equity", "current_assets", "current_liabilities",
    "operating_cash_flow", "long_term_debt",
]


def transform(df: pd.DataFrame) -> pd.DataFrame:
    """
    Parameters
    ----------
    df : raw DataFrame from the extract step

    Returns
    -------
    pd.DataFrame with additional ratio columns appended
    """
    df = df.copy().sort_values(["fiscal_year", "fiscal_quarter"]).reset_index(drop=True)

    # --- Ensure numeric types ---
    for col in REQUIRED_NUMERICS:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    # --- Margin ratios ---
    df["gross_margin"]     = df["gross_profit"]     / df["revenue"]
    df["operating_margin"] = df["operating_income"] / df["revenue"]
    df["net_margin"]       = df["net_income"]       / df["revenue"]

    # --- Asset efficiency ---
    df["roa"]            = df["net_income"]       / df["total_assets"]
    df["roe"]            = df["net_income"]       / df["total_equity"]
    df["asset_turnover"] = df["revenue"]          / df["total_assets"]

    # --- DuPont equity multiplier ---
    df["equity_multiplier"] = df["total_assets"] / df["total_equity"]

    # --- Reconstructed DuPont ROE = margin × turnover × multiplier ---
    df["roe_dupont"] = df["net_margin"] * df["asset_turnover"] * df["equity_multiplier"]

    # --- Liquidity ---
    df["current_ratio"] = df["current_assets"]  / df["current_liabilities"]
    df["quick_ratio"]   = (df["current_assets"] - df.get("inventory", 0)) / df["current_liabilities"]

    # --- Leverage ---
    df["debt_to_equity"]  = df.get("total_liabilities", np.nan) / df["total_equity"]
    df["lt_debt_to_assets"] = df.get("long_term_debt", np.nan) / df["total_assets"]

    # --- Cash quality of earnings (Piotroski F-Score criterion #4) ---
    df["accrual_ratio"] = df["operating_cash_flow"] / df["total_assets"] - df["roa"]

    # --- Year-over-year deltas (shift by 4 quarters) ---
    YOY_SHIFT = 4
    for col in ["roa", "gross_margin", "current_ratio", "lt_debt_to_assets",
                "asset_turnover", "shares_outstanding"]:
        if col in df.columns:
            df[f"{col}_yoy_delta"] = df[col] - df[col].shift(YOY_SHIFT)

    # --- Clean up infinities produced by division-by-zero ---
    df.replace([np.inf, -np.inf], np.nan, inplace=True)

    return df
