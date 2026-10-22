"""
Institutional performance and risk statistics.

Everything is annualisation-aware and reports the *sample size* alongside
each estimate so a user can judge whether a number is meaningful.

References
----------
Lo (2002) "The Statistics of Sharpe Ratios"; Sortino & Price (1994);
Rockafellar & Uryasev (2002) (CVaR); Bailey & López de Prado (2014)
(Deflated Sharpe Ratio); Politis & White (2004) (block bootstrap).
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from typing import Any, Iterable


def _clean(returns: Iterable[float] | pd.Series) -> np.ndarray:
    x = np.asarray(list(returns), dtype=float)
    return x[np.isfinite(x)]


def drawdown_series(nav: np.ndarray) -> np.ndarray:
    peak = np.maximum.accumulate(nav)
    return np.where(peak > 0, nav / peak - 1.0, 0.0)


def performance_stats(
    returns: Iterable[float] | pd.Series,
    periods_per_year: int = 252,
    risk_free_rate: float = 0.0,
    benchmark: Iterable[float] | pd.Series | None = None,
) -> dict[str, Any]:
    """Full performance/risk report for a return stream."""
    r = _clean(returns)
    if len(r) < 2:
        return {"observations": int(len(r))}

    nav = np.cumprod(1 + r)
    years = len(r) / periods_per_year
    total_return = float(nav[-1] - 1)
    cagr = float(nav[-1] ** (1 / years) - 1) if years > 0 else None

    vol = float(np.std(r, ddof=1))
    ann_vol = vol * np.sqrt(periods_per_year)
    rf_period = (1 + risk_free_rate) ** (1 / periods_per_year) - 1
    excess = r - rf_period
    ann_excess_return = float(np.mean(excess) * periods_per_year)

    # A flat return stream has zero volatility: the ratio is 0/0, which is
    # reported as 0.0 (no excess return earned) rather than None.
    sharpe = ann_excess_return / ann_vol if ann_vol > 0 else (0.0 if abs(ann_excess_return) < 1e-12 else None)

    downside = excess[excess < 0]
    downside_dev = float(np.sqrt(np.mean(downside**2)) * np.sqrt(periods_per_year)) if len(downside) else 0.0
    sortino = (
        ann_excess_return / downside_dev
        if downside_dev > 0
        else (0.0 if abs(ann_excess_return) < 1e-12 else None)
    )

    dd = drawdown_series(np.concatenate([[1.0], nav]))
    max_dd = float(dd.min())
    calmar = (cagr / abs(max_dd)) if (cagr is not None and max_dd < 0) else None

    # Ulcer index
    ulcer = float(np.sqrt(np.mean(dd**2)))

    # VaR / CVaR
    var95 = float(-np.percentile(r, 5))
    tail = r[r <= np.percentile(r, 5)]
    cvar95 = float(-tail.mean()) if len(tail) else None

    # Omega ratio
    gains = r[r > 0].sum()
    losses = -r[r < 0].sum()
    omega = float(gains / losses) if losses > 0 else None

    # Tail statistics
    skew = float(pd.Series(r).skew())
    kurt = float(pd.Series(r).kurtosis())

    stats: dict[str, Any] = {
        "observations": int(len(r)),
        "total_return": total_return,
        "cagr": cagr,
        "annualised_vol": ann_vol,
        "sharpe": sharpe,
        "sortino": sortino,
        "calmar": calmar,
        "max_drawdown": max_dd,
        "ulcer_index": ulcer,
        "var_95": var95,
        "cvar_95": cvar95,
        "omega_ratio": omega,
        "skew": skew,
        "excess_kurtosis": kurt,
        "hit_rate": float((r > 0).mean() * 100),
        "best": float(r.max()),
        "worst": float(r.min()),
        "positive_days": int((r > 0).sum()),
    }

    if benchmark is not None:
        b = _clean(benchmark)
        n = min(len(r), len(b))
        if n > 10:
            rr, bb = r[-n:], b[-n:]
            cov = np.cov(rr, bb, ddof=1)[0, 1]
            var_b = np.var(bb, ddof=1)
            beta = float(cov / var_b) if var_b > 0 else None
            alpha = float((np.mean(rr) - beta * np.mean(bb)) * periods_per_year) if beta is not None else None
            active = rr - bb
            te = float(np.std(active, ddof=1) * np.sqrt(periods_per_year))
            ir = float(np.mean(active) * periods_per_year / te) if te > 0 else None
            stats.update(
                {
                    "beta": beta,
                    "alpha": alpha,
                    "tracking_error": te,
                    "information_ratio": ir,
                    "correlation": float(np.corrcoef(rr, bb)[0, 1]),
                    "excess_return": float(np.mean(active) * periods_per_year),
                }
            )
    return stats


def deflated_sharpe_ratio(
    sharpe: float,
    observations: int,
    trials: int = 1,
    skew: float = 0.0,
    kurtosis: float = 3.0,
) -> float | None:
    """Probability the true Sharpe is positive after selection bias (Bailey & L-P 2014)."""
    from math import erf, sqrt

    if observations < 2 or trials < 1:
        return None
    euler_gamma = 0.5772156649
    expected_max = (
        (1 - euler_gamma) * _norm_ppf(1 - 1 / trials)
        + euler_gamma * _norm_ppf(1 - 1 / (trials * np.e))
    )
    denom = 1 - skew * sharpe + (kurtosis - 1) / 4 * sharpe**2
    if denom <= 0:
        return None
    sharpe_var = (1 + sharpe**2 / 2) / denom / (observations - 1)
    d = (sharpe - expected_max) / np.sqrt(sharpe_var)
    return float(0.5 * (1 + erf(d / sqrt(2))))


def _norm_ppf(p: float) -> float:
    """Inverse standard normal CDF (Acklam)."""
    from math import erf, log, sqrt

    if p <= 0:
        return -np.inf
    if p >= 1:
        return np.inf
    a = [-3.969683028665376e01, 2.209460984245205e02, -2.759285104469687e02,
         1.383577518672690e02, -3.066479806614716e01, 2.506628277459239e00]
    b = [-5.447609879822406e01, 1.615858368580409e02, -1.556989798598866e02,
         6.680131188771972e01, -1.328068155288572e01]
    c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e00,
         -2.549732539343734e00, 4.374664141464968e00, 2.938163982698783e00]
    d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e00,
         3.754408661907416e00]
    plow, phigh = 0.02425, 1 - 0.02425
    if p < plow:
        q = sqrt(-2 * log(p))
        return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / \
               ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    if p > phigh:
        q = sqrt(-2 * log(1 - p))
        return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / \
               ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    q = p - 0.5
    r = q * q
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / \
           (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)


def block_bootstrap_ci(
    series: Iterable[float] | pd.Series,
    statistic,
    block_size: int = 10,
    iterations: int = 1000,
    confidence: float = 0.95,
    seed: int = 7,
) -> dict[str, float]:
    """Stationary block-bootstrap confidence interval for a statistic."""
    x = _clean(series)
    n = len(x)
    if n < block_size * 2:
        return {}
    rng = np.random.default_rng(seed)
    n_blocks = int(np.ceil(n / block_size))
    values: list[float] = []
    for _ in range(iterations):
        starts = rng.integers(0, max(1, n - block_size + 1), size=n_blocks)
        sample = np.concatenate([x[s : s + block_size] for s in starts])[:n]
        stat = statistic(sample)
        if np.isfinite(stat):
            values.append(stat)
    if len(values) < 20:
        return {}
    alpha = (1 - confidence) / 2
    return {
        "point": float(statistic(x)),
        "lower": float(np.percentile(values, alpha * 100)),
        "upper": float(np.percentile(values, (1 - alpha) * 100)),
        "iterations": len(values),
    }


def rolling_sharpe(returns: Iterable[float] | pd.Series, window: int = 63, periods_per_year: int = 252) -> pd.Series:
    r = pd.Series(returns).dropna()
    roll_mean = r.rolling(window).mean()
    roll_std = r.rolling(window).std(ddof=1)
    return (roll_mean / roll_std) * np.sqrt(periods_per_year)


def rolling_volatility(returns: Iterable[float] | pd.Series, window: int = 21, periods_per_year: int = 252) -> pd.Series:
    return pd.Series(returns).dropna().rolling(window).std(ddof=1) * np.sqrt(periods_per_year)


def autocorrelation_matrix(returns: pd.DataFrame) -> pd.DataFrame:
    """Correlation matrix of a returns DataFrame (columns = assets)."""
    return returns.corr()


def portfolio_series(weights: np.ndarray, returns: pd.DataFrame) -> pd.Series:
    """Weighted portfolio return series."""
    weights = np.asarray(weights, dtype=float)
    return pd.Series(returns.to_numpy() @ weights, index=returns.index)
