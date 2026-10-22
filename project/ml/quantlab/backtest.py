"""
Fundamental + factor strategy backtesting on real market data.

The pipeline is deliberately institutional in shape:

1. Compute a cross-sectional signal from *reported fundamentals* at each
   rebalance date (Piotroski F-Score, Altman Z-Score, Magic Formula, gross
   profitability, quality composite …).
2. Form the portfolio using only information available at that date
   (no look-ahead: fundamentals are lagged by the reporting lag).
3. Charge realistic transaction costs on every rebalance.
4. Evaluate the result with the full risk/performance battery and compare
   against equal weight and buy & hold.

References
----------
Piotroski (2000) "Value Investing: The Use of Historical Financial Statement
Information to Separate Winners from Losers"; Altman (1968) "Financial
Ratios, Discriminant Analysis and the Prediction of Bankruptcy"; Greenblatt
(2006) "You Can Be a Stock Market Genius"; Novy-Marx (2013); Fama & French
(2015); Asness, Frazzini & Pedersen (2019).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

import numpy as np
import pandas as pd

from .metrics import performance_stats


@dataclass
class BacktestConfig:
    top_n: int = 10
    rebalance: str = "quarterly"          # daily | weekly | monthly | quarterly
    transaction_cost_bps: float = 10.0
    slippage_bps: float = 5.0
    reporting_lag_days: int = 45          # fundamentals become public later
    periods_per_year: int = 252
    long_only: bool = True
    benchmark: str | None = None


# ── Signal construction ──────────────────────────────────────────────────────

def _safe_div(a, b):
    return np.where((b != 0) & np.isfinite(b) & np.isfinite(a), a / b, np.nan)


def piotroski_f_score(panel: pd.DataFrame) -> pd.Series:
    """Piotroski (2000) F-Score computed from a panel of quarterly fundamentals.

    panel columns: ticker, fiscal_year, fiscal_quarter, period_end and the
    statement fields. Returns a Series indexed by (ticker, period_end).
    """
    df = panel.sort_values(["ticker", "period_end"]).copy()
    g = df.groupby("ticker", group_keys=False)

    df["roa"] = _safe_div(df["net_income"], df["total_assets"])
    df["cfo"] = _safe_div(df["operating_cash_flow"], df["total_assets"])
    df["delta_roa"] = g["roa"].diff(4)
    df["delta_cfo"] = g["cfo"].diff(4)
    df["delta_leverage"] = g["debt_to_assets"].diff(4)
    df["delta_current_ratio"] = g["current_ratio"].diff(4)
    df["delta_shares"] = g["shares_outstanding"].diff(4)
    df["delta_gross_margin"] = g["gross_margin"].diff(4)
    df["delta_asset_turnover"] = g["asset_turnover"].diff(4)
    df["accrual"] = df["cfo"] - df["roa"]

    df["s1"] = (df["roa"] > 0).astype(float)
    df["s2"] = (df["cfo"] > 0).astype(float)
    df["s3"] = (df["delta_roa"] > 0).astype(float)
    df["s4"] = (df["cfo"] > df["roa"]).astype(float)
    df["s5"] = (df["delta_leverage"] < 0).astype(float)
    df["s6"] = (df["delta_current_ratio"] > 0).astype(float)
    df["s7"] = (df["delta_shares"] <= 0).astype(float)
    df["s8"] = (df["delta_gross_margin"] > 0).astype(float)
    df["s9"] = (df["delta_asset_turnover"] > 0).astype(float)

    cols = [f"s{i}" for i in range(1, 10)]
    df["f_score"] = df[cols].sum(axis=1)
    out = df.set_index(["ticker", "period_end"])["f_score"]
    return out


def altman_z_score(panel: pd.DataFrame, market_cap: pd.Series | None = None) -> pd.Series:
    """Altman (1968) Z-Score for public manufacturers."""
    df = panel.copy()
    working_capital = df["current_assets"] - df["current_liabilities"]
    x1 = _safe_div(working_capital, df["total_assets"])
    x2 = _safe_div(df["total_equity"], df["total_assets"])
    x3 = _safe_div(df["operating_income"], df["total_assets"])
    if market_cap is not None:
        aligned = market_cap.reindex(pd.MultiIndex.from_arrays([df["ticker"], df["period_end"]])).to_numpy()
        equity_market = np.where(np.isfinite(aligned), aligned, df["total_equity"].to_numpy())
    else:
        equity_market = df["total_equity"].to_numpy()
    x4 = _safe_div(equity_market, df["total_liabilities"])
    x5 = _safe_div(df["revenue"], df["total_assets"])
    z = 1.2 * x1 + 1.4 * x2 + 3.3 * x3 + 0.6 * x4 + 1.0 * x5
    return pd.Series(z, index=pd.MultiIndex.from_arrays([df["ticker"], df["period_end"]]))


def magic_formula_score(panel: pd.DataFrame, market_cap: pd.Series | None = None) -> pd.Series:
    """Greenblatt (2006) combined rank score (higher is better)."""
    df = panel.copy()
    nwc = df["current_assets"] - df["current_liabilities"]
    net_fixed_assets = df["total_assets"] - df["current_assets"]
    invested = nwc + net_fixed_assets
    roce = _safe_div(df["operating_income"], invested)

    if market_cap is not None:
        aligned = market_cap.reindex(pd.MultiIndex.from_arrays([df["ticker"], df["period_end"]])).to_numpy()
        ev = np.where(np.isfinite(aligned), aligned + df["total_debt"].fillna(0).to_numpy() - df["cash"].fillna(0).to_numpy(), np.nan)
    else:
        ev = df["total_equity"].to_numpy()
    earnings_yield = _safe_div(df["operating_income"], ev)

    frame = pd.DataFrame({"roce": roce, "ey": earnings_yield})
    frame["roce_rank"] = frame.groupby(level=1)["roce"].rank(pct=True)
    frame["ey_rank"] = frame.groupby(level=1)["ey"].rank(pct=True)
    # classic magic formula prefers a low combined rank → invert
    return (2 - (frame["roce_rank"] + frame["ey_rank"])) / 2


def gross_profitability_score(panel: pd.DataFrame) -> pd.Series:
    """Novy-Marx (2013) gross profitability (gross profit / total assets)."""
    df = panel.copy()
    return pd.Series(
        _safe_div(df["gross_profit"], df["total_assets"]),
        index=pd.MultiIndex.from_arrays([df["ticker"], df["period_end"]]),
    )


def quality_score(panel: pd.DataFrame) -> pd.Series:
    """Asness–Frazzini–Pedersen (2019) quality composite (higher is better)."""
    df = panel.copy()
    profitability = _safe_div(df["gross_profit"], df["total_assets"])
    accruals = _safe_div(df["net_income"] - df["operating_cash_flow"], df["total_assets"])
    safety = -_safe_div(df["total_debt"], df["total_assets"])
    frame = pd.DataFrame({"p": profitability, "a": -accruals, "s": safety})
    return frame.mean(axis=1, skipna=True)


SIGNALS: dict[str, Callable[[pd.DataFrame], pd.Series]] = {
    "piotroski": piotroski_f_score,
    "altman_z": altman_z_score,
    "magic_formula": magic_formula_score,
    "gross_profitability": gross_profitability_score,
    "quality": quality_score,
}


# ── Backtest engine ──────────────────────────────────────────────────────────

#: Columns the signals rely on. Missing ones are filled with NaN so a partial
#: panel (e.g. one without a balance-sheet split) degrades gracefully instead
#: of raising.
REQUIRED_PANEL_COLUMNS: tuple[str, ...] = (
    "revenue",
    "gross_profit",
    "operating_income",
    "net_income",
    "operating_cash_flow",
    "total_assets",
    "total_liabilities",
    "total_equity",
    "current_assets",
    "current_liabilities",
    "cash",
    "total_debt",
    "long_term_debt",
    "inventory",
    "receivables",
    "eps",
    "shares_outstanding",
    "capex",
    "free_cash_flow",
    "dividends_paid",
)


def prepare_panel(fundamentals: pd.DataFrame) -> pd.DataFrame:
    """Add the derived ratios used by the signals."""
    df = fundamentals.copy()
    for column in REQUIRED_PANEL_COLUMNS:
        if column not in df.columns:
            df[column] = np.nan
    df = df.sort_values(["ticker", "period_end"])
    df["gross_margin"] = _safe_div(df["gross_profit"], df["revenue"])
    df["asset_turnover"] = _safe_div(df["revenue"], df["total_assets"])
    df["current_ratio"] = _safe_div(df["current_assets"], df["current_liabilities"])
    df["debt_to_assets"] = _safe_div(df["total_debt"], df["total_assets"])
    df["period_end"] = pd.to_datetime(df["period_end"])
    return df


def build_signal_panel(
    panel: pd.DataFrame,
    signal: str,
    market_cap: pd.Series | None = None,
) -> pd.DataFrame:
    """Return a wide panel (date × ticker) of the chosen signal."""
    scorer = SIGNALS.get(signal)
    if scorer is None:
        raise ValueError(f"Unknown signal '{signal}'. Available: {sorted(SIGNALS)}")
    values = scorer(panel, market_cap) if signal in ("altman_z", "magic_formula") else scorer(panel)
    if isinstance(values, pd.Series) and values.index.nlevels == 2:
        wide = values.unstack(level=0)
    else:
        wide = values.to_frame(name="score")
    return wide.sort_index()


def run_fundamental_backtest(
    panel: pd.DataFrame,
    prices: pd.DataFrame,
    signal: str = "piotroski",
    config: BacktestConfig | None = None,
    market_cap: pd.Series | None = None,
) -> dict[str, Any]:
    """Walk-forward backtest of a cross-sectional fundamental signal.

    At each rebalance date the signal must be at least
    ``reporting_lag_days`` old, so the backtest cannot use data that had not
    yet been published.
    """
    config = config or BacktestConfig()
    panel = prepare_panel(panel)
    signal_panel = build_signal_panel(panel, signal, market_cap)

    prices = prices.copy()
    prices.index = pd.to_datetime(prices.index)
    if isinstance(prices.columns[0], tuple):
        prices.columns = [c[0] for c in prices.columns]

    rebalance_dates = _rebalance_dates(prices.index, config.rebalance)
    cost_rate = (config.transaction_cost_bps + config.slippage_bps) / 10_000.0

    weights_history: list[pd.Series] = []
    positions: list[pd.Series] = []
    turnover_total = 0.0
    current_weights = pd.Series(0.0, index=prices.columns)

    for date in rebalance_dates:
        # only use signals that were public at the time
        cutoff = date - pd.Timedelta(days=config.reporting_lag_days)
        eligible = signal_panel.loc[:cutoff] if signal_panel.index.min() <= cutoff else signal_panel.iloc[0:0]
        if eligible.empty:
            continue
        latest_date = eligible.index[-1]
        scores = eligible.loc[latest_date].dropna()
        if len(scores) < 2:
            continue

        selected = scores.sort_values(ascending=False).head(config.top_n).index.tolist()
        target = pd.Series(0.0, index=prices.columns)
        for ticker in selected:
            if ticker in target.index:
                target[ticker] = 1.0 / len(selected)
        if config.long_only:
            target = target.clip(lower=0)

        turnover = float((target - current_weights).abs().sum())
        turnover_total += turnover
        weights_history.append(target)
        positions.append(target)
        current_weights = target

    # ── Realise the returns of the target weights ─────────────────────────
    if not weights_history:
        return {"signal": signal, "error": "No rebalance could be formed from the available data."}

    weight_frame = pd.DataFrame(positions, index=rebalance_dates[: len(positions)])
    daily_returns = prices.pct_change().fillna(0.0)

    strategy_returns = pd.Series(0.0, index=daily_returns.index)
    for i, date in enumerate(weight_frame.index):
        end = weight_frame.index[i + 1] if i + 1 < len(weight_frame.index) else daily_returns.index[-1]
        window = daily_returns.loc[date:end]
        if window.empty:
            continue
        # weights are applied with a one-day lag to avoid trading on the same
        # close that generated the signal
        for date_row, row in window.iloc[1:].iterrows():
            strategy_returns.loc[date_row] = float(row @ weight_frame.loc[date].reindex(row.index).fillna(0).to_numpy())

    # transaction costs are charged on the rebalance dates
    cost_series = pd.Series(0.0, index=daily_returns.index)
    for i, date in enumerate(weight_frame.index):
        turnover = float((weight_frame.iloc[i] - (weight_frame.iloc[i - 1] if i > 0 else 0)).abs().sum())
        cost_series.loc[date] = turnover * cost_rate

    net_returns = strategy_returns - cost_series
    equal_weight = daily_returns.mean(axis=1)

    stats = performance_stats(
        net_returns,
        periods_per_year=config.periods_per_year,
        benchmark=equal_weight,
    )
    stats_bh = performance_stats(equal_weight, periods_per_year=config.periods_per_year)

    return {
        "signal": signal,
        "top_n": config.top_n,
        "rebalance": config.rebalance,
        "rebalances": len(weight_frame),
        "total_turnover": turnover_total,
        "strategy": stats,
        "equal_weight": stats_bh,
        "strategy_series": net_returns,
        "equity_curve": (1 + net_returns).cumprod(),
        "weights": weight_frame,
        "signal_panel": signal_panel,
    }


def _rebalance_dates(index: pd.DatetimeIndex, frequency: str) -> list[pd.Timestamp]:
    if frequency == "daily":
        return list(index)
    rule = {"weekly": "W-FRI", "monthly": "ME", "quarterly": "QE"}[frequency]
    try:
        return list(index.to_series().resample(rule).last().dropna().unique())
    except Exception:
        return list(index[::21])
