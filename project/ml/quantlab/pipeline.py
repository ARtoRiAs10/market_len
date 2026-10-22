"""
End-to-end research pipeline over **real** market data.

    python -m quantlab.pipeline --tickers AAPL MSFT NVDA --period 3y

The pipeline performs, in order:

1. **Ingestion** — daily OHLCV for every ticker (Yahoo Finance chart API),
   quarterly fundamentals from SEC EDGAR XBRL company facts, benchmark and
   risk-free rate from FRED, and company metadata from Nasdaq.
2. **Time-series analysis** — stationarity (ADF/KPSS), autocorrelation,
   Ljung–Box, Hurst exponent, variance ratio, ARIMA fit + walk-forward
   forecast validation, GARCH(1,1) conditional volatility.
3. **Factor analysis** — cross-sectional factor construction, Fama–MacBeth
   style premium estimation, and fundamental-signal backtests (Piotroski,
   Altman Z, Magic Formula, gross profitability, quality).
4. **Portfolio construction** — mean–variance, risk parity, Black–Litterman
   and minimum-CVaR, with a full risk report and an efficient frontier.
5. **Reinforcement learning** — trained agents (REINFORCE, deterministic
   policy gradient, Thompson sampling) benchmarked against equal weight and
   buy & hold on the same real data.
6. **Reporting** — a JSON artefact written to ``ml/outputs/``.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from . import backtest as bt
from . import data_sources as ds
from . import metrics as mx
from . import portfolio as pf
from . import rl
from . import timeseries as ts
from .config import CONFIG, PROJECT_ROOT

OUTPUT_DIR = PROJECT_ROOT / "ml" / "outputs"


def _json_default(obj: Any) -> Any:
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        return float(obj)
    if isinstance(obj, (np.ndarray,)):
        return obj.tolist()
    if isinstance(obj, (pd.Timestamp, datetime)):
        return obj.isoformat()
    if isinstance(obj, pd.Series):
        return obj.to_dict()
    if isinstance(obj, pd.DataFrame):
        return obj.to_dict(orient="split")
    return str(obj)


def _strip(obj: Any) -> Any:
    """Remove pandas/numpy objects from a nested structure."""
    if isinstance(obj, dict):
        return {k: _strip(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_strip(v) for v in obj]
    if isinstance(obj, pd.Series):
        return _strip(obj.to_dict())
    if isinstance(obj, pd.DataFrame):
        return _strip(obj.to_dict(orient="split"))
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        value = float(obj)
        return None if not np.isfinite(value) else value
    if isinstance(obj, np.ndarray):
        return _strip(obj.tolist())
    if isinstance(obj, (pd.Timestamp, datetime)):
        return obj.isoformat()
    if isinstance(obj, float) and not np.isfinite(obj):
        return None
    return obj


# ── Stages ───────────────────────────────────────────────────────────────────

def stage_timeseries(prices: pd.DataFrame, benchmark: str | None) -> dict[str, Any]:
    """Stationarity, autocorrelation, ARIMA and GARCH diagnostics per asset."""
    out: dict[str, Any] = {}
    for symbol in prices.columns:
        series = prices[symbol]
        returns = series.pct_change().dropna()
        entry: dict[str, Any] = {"summary": ts.summarise_time_series(series, symbol)}

        try:
            report = ts.stationarity_report(returns, f"{symbol} returns")
            entry["stationarity"] = report.to_dict()
            entry["acf"] = ts.autocorrelation(returns, nlags=20).to_dict()
            entry["pacf"] = ts.partial_autocorrelation(returns, nlags=20).to_dict()
            entry["ljung_box"] = dict(zip(("statistic", "pvalue"), ts.ljung_box(returns, 10)))
            entry["hurst"] = ts.hurst_exponent(series)
            entry["variance_ratio"] = ts.variance_ratio_test(returns, 5)
        except Exception as exc:
            entry["error"] = str(exc)

        try:
            arima = ts.fit_arima(returns, order=(1, 0, 1), forecast_steps=10)
            entry["arima"] = arima.to_dict()
        except Exception as exc:
            entry["arima_error"] = str(exc)

        try:
            garch = ts.fit_garch11(returns, forecast_steps=5)
            entry["garch"] = garch.to_dict()
        except Exception as exc:
            entry["garch_error"] = str(exc)

        out[symbol] = entry
    return out


def stage_factor_backtests(
    fundamentals: pd.DataFrame,
    prices: pd.DataFrame,
    market_cap: pd.Series | None = None,
) -> dict[str, Any]:
    """Backtest each fundamental signal against equal weight."""
    out: dict[str, Any] = {}
    config = bt.BacktestConfig(top_n=max(3, min(10, fundamentals["ticker"].nunique() // 2)))
    for signal in bt.SIGNALS:
        try:
            result = bt.run_fundamental_backtest(fundamentals, prices, signal, config, market_cap)
            result.pop("strategy_series", None)
            result.pop("equity_curve", None)
            result.pop("weights", None)
            result.pop("signal_panel", None)
            out[signal] = _strip(result)
        except Exception as exc:
            out[signal] = {"error": str(exc)}
    return out


def stage_portfolio_construction(prices: pd.DataFrame) -> dict[str, Any]:
    """Optimise the universe with four different construction methods."""
    returns = prices.pct_change().dropna(how="any")
    if returns.shape[0] < 60 or returns.shape[1] < 2:
        return {"error": "Not enough return history for optimisation."}

    cov, delta = pf.ledoit_wolf(returns)
    cov = cov * 252
    mu = returns.mean().to_numpy() * 252
    names = list(returns.columns)
    constraints = pf.Constraints(long_only=True, max_weight=0.25)

    results: dict[str, Any] = {
        "shrinkage_delta": float(delta),
        "annualised_mean": {n: float(v) for n, v in zip(names, mu)},
        "annualised_vol": {n: float(np.sqrt(cov[i, i])) for i, n in enumerate(names)},
    }

    variants = {
        "equal_weight": pf.equal_weight(len(names), constraints),
        "inverse_volatility": pf.inverse_volatility(cov, constraints),
        "mean_variance_max_sharpe": pf.mean_variance(mu, cov, "sharpe", 0.04, constraints),
        "min_variance": pf.mean_variance(mu, cov, "variance", 0.04, constraints),
        "risk_parity": pf.risk_parity(cov, None, constraints),
    }

    # Black–Litterman with a single "market is expensive" view on the first asset
    try:
        views = [{"index": 0, "expected_return": float(mu[0] * 0.5), "confidence": 0.4}]
        posterior, prior = pf.black_litterman(pf.equal_weight(len(names)), cov, 0.04, 0.05, views)
        variants["black_litterman"] = pf.mean_variance(posterior, cov, "sharpe", 0.04, constraints)
        results["black_litterman_prior"] = {n: float(v) for n, v in zip(names, prior)}
        results["black_litterman_posterior"] = {n: float(v) for n, v in zip(names, posterior)}
    except Exception as exc:
        results["black_litterman_error"] = str(exc)

    try:
        variants["min_cvar"] = pf.min_cvar(returns, 0.95, constraints)
    except Exception as exc:
        results["min_cvar_error"] = str(exc)

    for name, weights in variants.items():
        weights = np.asarray(weights, dtype=float)
        if weights.sum() <= 0:
            continue
        weights = weights / weights.sum()
        summary = pf.summarise_portfolio(weights, names, cov, mu, 0.04)
        port_returns = returns.to_numpy() @ weights
        summary["backtest"] = mx.performance_stats(port_returns, 252, 0.04, returns.mean(axis=1).to_numpy())
        results[name] = _strip(summary)

    try:
        frontier = pf.efficient_frontier(mu, cov, 30, 0.04, constraints)
        results["efficient_frontier"] = _strip(frontier.to_dict(orient="records"))
    except Exception as exc:
        results["efficient_frontier_error"] = str(exc)

    return results


def stage_rl(prices: pd.DataFrame, episodes: int = 8) -> dict[str, Any]:
    """Train and evaluate the RL agents on real market data."""
    returns = prices.pct_change().dropna(how="any")
    if returns.shape[0] < 120:
        return {"error": "Not enough history to train the agents."}
    config = rl.EnvConfig(
        transaction_cost_bps=CONFIG.transaction_cost_bps,
        risk_aversion=0.5,
    )
    comparison = rl.run_agent_comparison(returns, config, episodes=episodes)
    return _strip(comparison)


# ── Orchestration ────────────────────────────────────────────────────────────

def run_pipeline(
    tickers: list[str] | None = None,
    period: str = "3y",
    episodes: int = 8,
    output: Path | None = None,
) -> dict[str, Any]:
    """Run the full research pipeline over real market data."""
    tickers = [t.upper() for t in (tickers or list(CONFIG.default_universe))]
    started = datetime.now()

    report: dict[str, Any] = {
        "generated_at": started.isoformat(),
        "tickers": tickers,
        "period": period,
        "stages": {},
    }

    print(f"[1/5] fetching daily prices for {len(tickers)} symbols …")
    price_frames: dict[str, pd.DataFrame] = {}
    for ticker in tickers:
        try:
            frame = ds.fetch_daily_prices(ticker, period=period)
            if not frame.empty:
                price_frames[ticker] = frame
        except Exception as exc:
            print(f"      ! {ticker}: {exc}")
    if not price_frames:
        report["error"] = "No price data could be fetched."
        return report

    close = pd.concat(
        {t: f.set_index("date")["adj_close"] for t, f in price_frames.items()}, axis=1
    ).sort_index().ffill().dropna(how="any")
    report["stages"]["data"] = {
        "symbols": list(close.columns),
        "observations": int(len(close)),
        "start": str(close.index[0].date()),
        "end": str(close.index[-1].date()),
    }
    print(f"      {close.shape[0]} observations × {close.shape[1]} symbols")

    print("[2/5] pulling SEC EDGAR XBRL fundamentals …")
    try:
        fundamentals = ds.fundamentals_panel(tickers, max_quarters=16)
    except Exception as exc:
        fundamentals = pd.DataFrame()
        report["stages"]["data"]["fundamentals_error"] = str(exc)
    report["stages"]["data"]["fundamental_rows"] = int(len(fundamentals))
    report["stages"]["data"]["fundamental_tickers"] = sorted(fundamentals["ticker"].unique().tolist()) if not fundamentals.empty else []

    print("[3/5] time-series diagnostics …")
    report["stages"]["timeseries"] = stage_timeseries(close, CONFIG.benchmark)

    print("[4/5] factor backtests & portfolio construction …")
    if not fundamentals.empty:
        report["stages"]["factor_backtests"] = stage_factor_backtests(fundamentals, close)
    report["stages"]["portfolio"] = stage_portfolio_construction(close)

    print("[5/5] reinforcement-learning agents …")
    report["stages"]["reinforcement_learning"] = stage_rl(close, episodes=episodes)

    report["completed_at"] = datetime.now().isoformat()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    path = output or (OUTPUT_DIR / f"research-report-{started.strftime('%Y%m%d-%H%M%S')}.json")
    path.write_text(json.dumps(_strip(report), indent=2, default=_json_default))
    report["_output_path"] = str(path)
    print(f"\n✓ report written to {path}")
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="MarketLens research pipeline (real market data)")
    parser.add_argument("--tickers", nargs="*", default=None, help="Ticker universe")
    parser.add_argument("--period", default="3y", help="Price history window")
    parser.add_argument("--episodes", type=int, default=8, help="RL training episodes")
    parser.add_argument("--output", default=None, help="Output JSON path")
    args = parser.parse_args(argv)

    report = run_pipeline(
        tickers=args.tickers,
        period=args.period,
        episodes=args.episodes,
        output=Path(args.output) if args.output else None,
    )
    if report.get("error"):
        print("ERROR:", report["error"])
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
