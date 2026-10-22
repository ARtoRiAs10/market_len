"""
Time-series analytics for the research lab.

Contents
--------
* Stationarity: Augmented Dickey–Fuller (ADF) and KPSS tests, automatic
  differencing selection, unit-root diagnostics.
* Autocorrelation: sample ACF/PACF, Ljung–Box portmanteau test.
* Models: ARIMA(p,d,q) by conditional sum of squares (statsmodels when
  available, self-contained fallback otherwise), GARCH(1,1) via maximum
  likelihood, EWMA volatility, rolling/historic forecasts.
* Structure: Hurst exponent, variance-ratio test, Engle–Granger
  cointegration, and a simple two-state regime (HMM-lite) detector.
* Validation: walk-forward forecast accuracy (MAE/RMSE/MAPE), Diebold–
  Mariano test for forecast comparison.

References
----------
Dickey & Fuller (1979); Kwiatkowski et al. (1998); Ljung & Box (1978);
Box & Jenkins (2015); Bollerslev (1986); Engle & Granger (1987);
Diebold & Mariano (1995); Lo (1991) (Hurst exponent).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Sequence

import numpy as np
import pandas as pd

try:  # optional, but present in the lab environment
    from statsmodels.tsa.stattools import adfuller, kpss, acf, pacf

    _HAS_STATSMODELS = True
except Exception:  # pragma: no cover - fallback path
    adfuller = kpss = acf = pacf = None  # type: ignore[assignment]
    _HAS_STATSMODELS = False

try:  # moved between statsmodels versions — import it separately
    from statsmodels.stats.diagnostic import ljungbox

    _HAS_LJUNGBOX = True
except Exception:  # pragma: no cover - fallback path
    ljungbox = None  # type: ignore[assignment]
    _HAS_LJUNGBOX = False


# ── Stationarity ─────────────────────────────────────────────────────────────

@dataclass
class StationarityReport:
    series: str
    observations: int
    adf_statistic: float | None
    adf_pvalue: float | None
    adf_stationary: bool | None
    kpss_statistic: float | None
    kpss_pvalue: float | None
    kpss_stationary: bool | None
    recommended_differences: int
    verdict: str
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return self.__dict__.copy()


def adf_test(series: pd.Series, maxlag: int | None = None) -> tuple[float, float, bool]:
    """Augmented Dickey–Fuller test. Returns (statistic, p-value, stationary)."""
    clean = pd.Series(series).dropna()
    if len(clean) < 40:
        return float("nan"), float("nan"), False
    if _HAS_STATSMODELS:
        stat, pvalue, *_ = adfuller(clean.to_numpy(), autolag="AIC", maxlag=maxlag)
        return float(stat), float(pvalue), bool(pvalue < 0.05)
    # Fallback: OLS of Δy on y, lag, Δy lags with a t-stat on the level term.
    y = clean.to_numpy()
    dy = np.diff(y)
    lags = 4
    if len(dy) <= lags + 5:
        return float("nan"), float("nan"), False
    n = len(dy)
    rows = len(dy) - lags
    X = np.column_stack(
        [
            y[lags:-1],
            *[_lag(dy, k)[:rows] for k in range(1, lags + 1)],
            np.ones(rows),
        ]
    )
    yv = dy[lags:]
    beta, *_ = np.linalg.lstsq(X, yv, rcond=None)
    resid = yv - X @ beta
    dof = len(yv) - X.shape[1]
    sigma2 = (resid @ resid) / max(dof, 1)
    xtx_inv = np.linalg.pinv(X.T @ X)
    se = np.sqrt(sigma2 * xtx_inv[0, 0])
    tstat = beta[0] / se if se > 0 else float("nan")
    # Two-sided normal approximation to the p-value
    from math import erf, sqrt

    pvalue = 2 * (1 - 0.5 * (1 + erf(abs(tstat) / sqrt(2))))
    return float(tstat), float(pvalue), bool(pvalue < 0.05)


def _lag(arr: np.ndarray, k: int) -> np.ndarray:
    out = np.zeros_like(arr)
    out[k:] = arr[:-k]
    return out


def kpss_test(series: pd.Series) -> tuple[float, float, bool]:
    """KPSS test for level stationarity. Returns (statistic, p-value, stationary)."""
    clean = pd.Series(series).dropna()
    if len(clean) < 40:
        return float("nan"), float("nan"), False
    if _HAS_STATSMODELS:
        stat, pvalue, *_ = kpss(clean.to_numpy(), regression="c", nlags="auto")
        return float(stat), float(pvalue), bool(pvalue > 0.05)
    return float("nan"), float("nan"), False


def difference_to_stationary(series: pd.Series, max_d: int = 2) -> tuple[pd.Series, int]:
    """Difference a series until the ADF test rejects a unit root."""
    current = pd.Series(series).dropna()
    d = 0
    while d < max_d:
        _, pvalue, stationary = adf_test(current)
        if stationary:
            return current, d
        current = current.diff().dropna()
        d += 1
    return current, d


def stationarity_report(series: pd.Series, name: str = "series") -> StationarityReport:
    """Full stationarity diagnostic for a single series."""
    clean = pd.Series(series).dropna()
    adf_stat, adf_p, adf_stationary = adf_test(clean)
    kpss_stat, kpss_p, kpss_stationary = kpss_test(clean)
    _, d = difference_to_stationary(clean)

    notes: list[str] = []
    if adf_stationary and kpss_stationary:
        verdict = "Stationary (level)"
    elif adf_stationary and not kpss_stationary:
        verdict = "Trend-stationary / borderline — difference once"
    elif not adf_stationary and not kpss_stationary:
        verdict = "Non-stationary (unit root) — difference before modelling"
    else:
        verdict = "Inconclusive — inspect the ACF and difference the series"

    if d > 0:
        notes.append(f"Apply {d} difference(s) for modelling.")
    if len(clean) < 120:
        notes.append("Fewer than 120 observations — treat inference as fragile.")

    return StationarityReport(
        series=name,
        observations=len(clean),
        adf_statistic=adf_stat,
        adf_pvalue=adf_p,
        adf_stationary=adf_stationary,
        kpss_statistic=kpss_stat,
        kpss_pvalue=kpss_p,
        kpss_stationary=kpss_stationary,
        recommended_differences=d,
        verdict=verdict,
        notes=notes,
    )


# ── Autocorrelation ──────────────────────────────────────────────────────────

def autocorrelation(series: pd.Series, nlags: int = 20) -> pd.Series:
    """Sample autocorrelation function."""
    clean = pd.Series(series).dropna()
    if _HAS_STATSMODELS:
        values = acf(clean.to_numpy(), nlags=nlags, fft=False)
        return pd.Series(values[1:], index=pd.RangeIndex(1, nlags + 1), name="acf")
    x = clean.to_numpy()
    x = x - x.mean()
    denom = (x @ x) or 1.0
    out = []
    for lag in range(1, nlags + 1):
        out.append(float((x[:-lag] @ x[lag:]) / denom))
    return pd.Series(out, index=pd.RangeIndex(1, nlags + 1), name="acf")


def partial_autocorrelation(series: pd.Series, nlags: int = 20) -> pd.Series:
    """Partial autocorrelation function (via Durbin–Levinson when needed)."""
    clean = pd.Series(series).dropna()
    if _HAS_STATSMODELS:
        values = pacf(clean.to_numpy(), nlags=nlags, method="ywm")
        return pd.Series(values[1:], index=pd.RangeIndex(1, nlags + 1), name="pacf")
    r = autocorrelation(clean, nlags=nlags).to_numpy()
    phi = np.zeros(nlags)
    for k in range(1, nlags + 1):
        num = r[k - 1] - sum(phi[j - 1] * r[k - j] for j in range(2, k + 1))
        den = 1 - sum(phi[j - 1] * r[j - 1] for j in range(1, k))
        phi[k - 1] = num / den if den != 0 else 0.0
    return pd.Series(phi, index=pd.RangeIndex(1, nlags + 1), name="pacf")


def ljung_box(series: pd.Series, lags: int = 10) -> tuple[float, float]:
    """Ljung–Box portmanteau test — returns (statistic, p-value)."""
    clean = pd.Series(series).dropna()
    if _HAS_LJUNGBOX:
        result = ljungbox(clean.to_numpy(), lags=[lags], return_df=True)
        return float(result["lb_stat"].iloc[0]), float(result["lb_pvalue"].iloc[0])
    r = autocorrelation(clean, nlags=lags).to_numpy()
    n = len(clean)
    q = n * (n + 2) * sum(r[i - 1] ** 2 / (n - i) for i in range(1, lags + 1))
    from math import erf, sqrt

    p = 1 - 0.5 * (1 + erf(sqrt(q / 2)))
    return float(q), float(p)


# ── Models ───────────────────────────────────────────────────────────────────

@dataclass
class ArimaResult:
    order: tuple[int, int, int]
    aic: float | None
    bic: float | None
    params: dict[str, float]
    sigma2: float
    residual_acf: dict[int, float]
    forecast: pd.Series
    fitted: pd.Series
    converged: bool
    engine: str
    note: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "order": list(self.order),
            "aic": self.aic,
            "bic": self.bic,
            "params": self.params,
            "sigma2": self.sigma2,
            "residual_acf": {str(k): v for k, v in self.residual_acf.items()},
            "converged": self.converged,
            "engine": self.engine,
            "note": self.note,
        }


def fit_arima(
    series: pd.Series,
    order: tuple[int, int, int] = (1, 1, 1),
    forecast_steps: int = 20,
) -> ArimaResult:
    """Fit an ARIMA(p,d,q) model.

    Uses statsmodels when available; otherwise a self-contained conditional
    sum-of-squares estimator with a grid search over (p, q).
    """
    clean = pd.Series(series).dropna().astype(float)
    if len(clean) < 30:
        raise ValueError("Need at least 30 observations to fit an ARIMA model.")

    if _HAS_STATSMODELS:
        from statsmodels.tsa.arima.model import ARIMA

        try:
            model = ARIMA(clean.to_numpy(), order=order).fit()
            forecast = model.forecast(steps=forecast_steps)
            resid = pd.Series(model.resid)
            index = pd.date_range(
                periods=len(clean), freq=clean.index.freq or "D"
            ) if isinstance(clean.index, pd.DatetimeIndex) else pd.RangeIndex(len(clean))
            fc_index = pd.date_range(
                start=clean.index[-1] + (clean.index[1] - clean.index[0]),
                periods=forecast_steps,
                freq=clean.index.freq or "D",
            ) if isinstance(clean.index, pd.DatetimeIndex) else pd.RangeIndex(
                len(clean), len(clean) + forecast_steps
            )
            resid_acf = autocorrelation(resid, nlags=min(10, max(1, len(resid) // 10)))
            return ArimaResult(
                order=order,
                aic=float(model.aic),
                bic=float(model.bic),
                params={k: float(v) for k, v in model.params.items()},
                sigma2=float(np.var(model.resid)),
                residual_acf={int(k): float(v) for k, v in resid_acf.items()},
                forecast=pd.Series(np.asarray(forecast, dtype=float), index=fc_index),
                fitted=pd.Series(np.asarray(model.fittedvalues, dtype=float), index=index),
                converged=bool(getattr(model, "mle_retvals", {}).get("converged", True)),
                engine="statsmodels",
            )
        except Exception as exc:  # fall through to the internal estimator
            note = f"statsmodels failed ({exc}); used the internal CSS estimator."
    else:
        note = "statsmodels not installed; used the internal CSS estimator."

    return _fit_arima_css(clean, order, forecast_steps, note)


def _fit_arima_css(
    series: pd.Series,
    order: tuple[int, int, int],
    forecast_steps: int,
    note: str,
) -> ArimaResult:
    """Conditional sum-of-squares ARIMA with a small grid search."""
    p, d, q = order
    y = series.to_numpy(dtype=float)
    if d > 0:
        for _ in range(d):
            y = np.diff(y)
    n = len(y)
    if n < 10:
        raise ValueError("Not enough observations after differencing.")

    best = None
    for pp in range(max(1, p - 1), p + 2):
        for qq in range(max(0, q - 1), q + 2):
            res = _css_estimate(y, pp, qq)
            if res is not None and (best is None or res["aic"] < best["aic"]):
                best = res

    if best is None:
        raise ValueError("ARIMA estimation failed.")

    # The orders of the *selected* model (the loop variables above are the
    # last candidate tried, not the winner).
    pp = int(best["p"])
    qq = int(best["q"])
    phi = best["phi"]
    theta = best["theta"]
    resid = best["resid"]
    sigma2 = float(np.var(resid)) if len(resid) else 1e-8

    # Recursive forecasts on the differenced scale, then re-invert d times.
    hist = list(y)
    fc: list[float] = []
    for _ in range(forecast_steps):
        preds = []
        for k in range(1, pp + 1):
            preds.append(phi[k - 1] * hist[-k])
        for k in range(1, qq + 1):
            preds.append(theta[k - 1] * resid[-k])
        nxt = sum(preds)
        fc.append(nxt)
        hist.append(nxt)
        resid.append(0.0)

    # Integrate the differenced forecasts back to the original scale.
    level = series.to_numpy(dtype=float)
    last = float(level[-1]) if len(level) else 0.0
    integrated_fc: list[float] = []
    for v in fc:
        last = last + v
        integrated_fc.append(last)

    fitted_vals = list(np.asarray(best["fitted"], dtype=float))
    for _ in range(d):
        # undo differencing for the fitted values
        integrated = []
        prev = series.to_numpy(dtype=float)[0]
        for v in fitted_vals:
            prev = prev + v
            integrated.append(prev)
        fitted_vals = integrated

    resid_acf = autocorrelation(pd.Series(resid), nlags=min(10, max(1, len(resid) // 10)))
    return ArimaResult(
        order=order,
        aic=best["aic"],
        bic=best["bic"],
        params={
            **{f"ar{i+1}": float(v) for i, v in enumerate(phi)},
            **{f"ma{i+1}": float(v) for i, v in enumerate(theta)},
        },
        sigma2=sigma2,
        residual_acf={int(k): float(v) for k, v in resid_acf.items()},
        forecast=pd.Series(integrated_fc, name="forecast"),
        fitted=pd.Series(fitted_vals, name="fitted"),
        converged=True,
        engine="css",
        note=note,
    )


def _css_estimate(y: np.ndarray, p: int, q: int) -> dict[str, Any] | None:
    """Conditional sum-of-squares estimation of ARMA(p, q) by grid search."""
    n = len(y)
    if n <= p + q + 5:
        return None

    def build_row(idx: int) -> tuple[np.ndarray, float]:
        row = [y[idx - 1 - k] for k in range(p)]
        for k in range(1, q + 1):
            row.append(y[idx - k] if idx - k >= 0 else 0.0)
        row.append(1.0)
        return np.asarray(row, dtype=float), y[idx]

    rows, targets = [], []
    for i in range(max(p, q), n):
        row, target = build_row(i)
        rows.append(row)
        targets.append(target)

    X = np.vstack(rows)
    yv = np.asarray(targets)
    if X.shape[0] < X.shape[1] + 2:
        return None

    # Grid search over a small ridge range to keep the fit stable.
    best: dict[str, Any] | None = None
    for lam in (1e-6, 1e-4, 1e-2, 1.0):
        XtX = X.T @ X + lam * np.eye(X.shape[1])
        Xty = X.T @ yv
        try:
            beta = np.linalg.solve(XtX, Xty)
        except np.linalg.LinAlgError:
            continue
        resid = yv - X @ beta
        sigma2 = float(resid @ resid) / max(len(resid) - X.shape[1], 1)
        if not np.isfinite(sigma2) or sigma2 <= 0:
            continue
        loglik = -0.5 * len(resid) * (np.log(2 * np.pi * sigma2) + 1)
        aic = -2 * loglik + 2 * X.shape[1]
        bic = -2 * loglik + np.log(len(resid)) * X.shape[1]
        if best is None or aic < best["aic"]:
            best = {
                "p": p,
                "q": q,
                "phi": beta[:p],
                "theta": beta[p : p + q],
                "const": float(beta[-1]),
                "resid": list(resid),
                "fitted": list(X @ beta),
                "sigma2": sigma2,
                "aic": float(aic),
                "bic": float(bic),
            }
    return best


@dataclass
class GarchResult:
    omega: float
    alpha: float
    beta: float
    persistence: float
    conditional_volatility: pd.Series
    forecast_volatility: float
    log_likelihood: float
    converged: bool
    note: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "omega": self.omega,
            "alpha": self.alpha,
            "beta": self.beta,
            "persistence": self.persistence,
            "forecast_volatility": self.forecast_volatility,
            "log_likelihood": self.log_likelihood,
            "converged": self.converged,
            "note": self.note,
        }


def fit_garch11(series: pd.Series, forecast_steps: int = 5) -> GarchResult:
    """Maximum-likelihood GARCH(1,1) with a normal or Student-t innovation."""
    clean = pd.Series(series).dropna().astype(float)
    returns = clean.pct_change().dropna()
    if len(returns) < 60:
        raise ValueError("Need at least 60 return observations to fit GARCH.")

    if _HAS_STATSMODELS:
        try:
            from arch import arch_model  # optional dependency

            model = arch_model(returns.to_numpy() * 100, vol="GARCH", p=1, q=1, dist="t")
            res = model.fit(disp="off")
            cond_vol = pd.Series(res.conditional_volatility.to_numpy() / 100, index=returns.index)
            fc = float(res.forecast(horizon=forecast_steps).variance.iloc[-1].iloc[0] ** 0.5) / 100
            return GarchResult(
                omega=float(res.params["omega"]) / 10000,
                alpha=float(res.params["alpha[1]"]),
                beta=float(res.params["beta[1]"]),
                persistence=float(res.params["alpha[1]"] + res.params["beta[1]"]),
                conditional_volatility=cond_vol,
                forecast_volatility=fc,
                log_likelihood=float(res.loglikelihood),
                converged=bool(res.convergence_flag == 0),
                engine_note="arch package" if False else "statsmodels/arch",
            )
        except Exception:
            pass

    return _fit_garch_mle(returns, forecast_steps)


def _fit_garch_mle(returns: pd.Series, forecast_steps: int) -> GarchResult:
    """Self-contained GARCH(1,1) MLE using scipy's optimiser."""
    from scipy.optimize import minimize

    x = returns.to_numpy()
    n = len(x)
    var0 = float(np.var(x))

    def nll(params: np.ndarray) -> float:
        omega, alpha, beta = params
        if omega <= 0 or alpha < 0 or beta < 0 or alpha + beta >= 0.999:
            return 1e10
        sigma2 = np.empty(n)
        sigma2[0] = var0
        for t in range(1, n):
            sigma2[t] = omega + alpha * x[t - 1] ** 2 + beta * sigma2[t - 1]
        if np.any(sigma2 <= 0) or not np.all(np.isfinite(sigma2)):
            return 1e10
        ll = -0.5 * np.sum(np.log(sigma2) + x**2 / sigma2)
        return -ll if np.isfinite(ll) else 1e10

    best = None
    for a0 in (0.05, 0.1):
        for b0 in (0.85, 0.9):
            res = minimize(
                nll,
                x0=np.array([var0 * 0.1, a0, b0]),
                method="Nelder-Mead",
                options={"maxiter": 2000, "xatol": 1e-8, "fatol": 1e-8},
            )
            if best is None or res.fun < best.fun:
                best = res

    omega, alpha, beta = best.x
    sigma2 = np.empty(n)
    sigma2[0] = var0
    for t in range(1, n):
        sigma2[t] = omega + alpha * x[t - 1] ** 2 + beta * sigma2[t - 1]
    cond_vol = pd.Series(np.sqrt(sigma2), index=returns.index)
    fc_sigma2 = omega + alpha * x[-1] ** 2 + beta * sigma2[-1]
    for _ in range(forecast_steps - 1):
        fc_sigma2 = omega + (alpha + beta) * fc_sigma2

    return GarchResult(
        omega=float(omega),
        alpha=float(alpha),
        beta=float(beta),
        persistence=float(alpha + beta),
        conditional_volatility=cond_vol,
        forecast_volatility=float(np.sqrt(fc_sigma2)),
        log_likelihood=float(-best.fun),
        converged=bool(best.success),
        note="scipy Nelder–Mead MLE",
    )


def ewma_volatility(returns: pd.Series, lam: float = 0.94) -> pd.Series:
    """RiskMetrics EWMA volatility."""
    r = pd.Series(returns).dropna()
    var = pd.Series(index=r.index, dtype=float)
    lam_inv = 1 - lam
    prev = float(r.iloc[0] ** 2)
    for i, value in enumerate(r.to_numpy()):
        prev = lam * prev + lam_inv * float(value) ** 2
        var.iloc[i] = np.sqrt(prev)
    return var


def hurst_exponent(series: pd.Series, max_lag: int = 40) -> float:
    """Hurst exponent via the variance-of-lagged-differences estimator (Lo, 1991).

    The estimator regresses ``log Var(x[t+k] - x[t])`` on ``log k`` and maps
    the slope onto a *level* persistence scale:

    * ``H ≈ 0.5`` — white noise (the series has no persistence at all),
    * ``H ≈ 1.0`` — a random walk (each new observation carries the whole
      accumulated level forward),
    * ``H > 1.0`` — a trending / integrated process (momentum in the level).

    On this scale ``H > 0.55`` flags a persistent (trending) series and
    ``H < 0.55`` a mean-reverting one.
    """
    x = pd.Series(series).dropna().to_numpy(dtype=float)
    n = len(x)
    if n < 50:
        return float("nan")
    lags = range(2, min(max_lag, n // 4))
    taus = []
    poly = []
    for lag in lags:
        diff = x[lag:] - x[:-lag]
        taus.append(np.log(lag))
        poly.append(np.log(np.mean(diff**2)))
    if len(taus) < 3:
        return float("nan")
    slope = float(np.polyfit(taus, poly, 1)[0])
    # slope 0 (white noise) → 0.5, slope 1 (random walk) → 1.0
    return float(0.5 + slope / 2)


def variance_ratio_test(returns: pd.Series, q: int = 5) -> dict[str, float]:
    """Lo–MacKinlay variance-ratio test for random-walk behaviour."""
    r = pd.Series(returns).dropna().to_numpy(dtype=float)
    n = len(r)
    if n < 40:
        return {"variance_ratio": float("nan"), "z_stat": float("nan"), "pvalue": float("nan")}
    mu = r.mean()
    var1 = np.var(r, ddof=1)
    agg = r[: (n // q) * q].reshape(-1, q).sum(axis=1)
    varq = np.var(agg, ddof=1) / q
    vr = varq / var1
    z = (vr - 1) / np.sqrt(2 * (2 * q - 1 + (q - 1) ** 2 / q) / (q * (n - q)))
    from math import erf, sqrt

    p = 2 * (1 - 0.5 * (1 + erf(abs(z) / sqrt(2))))
    return {"variance_ratio": float(vr), "z_stat": float(z), "pvalue": float(p)}


def engle_granger_cointegration(y: pd.Series, x: pd.Series) -> dict[str, Any]:
    """Engle–Granger two-step cointegration test."""
    df = pd.concat([pd.Series(y).rename("y"), pd.Series(x).rename("x")], axis=1).dropna()
    if len(df) < 40:
        return {"statistic": float("nan"), "pvalue": float("nan"), "cointegrated": False}
    X = np.column_stack([df["x"].to_numpy(), np.ones(len(df))])
    beta, *_ = np.linalg.lstsq(X, df["y"].to_numpy(), rcond=None)
    resid = df["y"].to_numpy() - X @ beta
    stat, pvalue, _, _, _ = adf_test(pd.Series(resid))
    return {
        "statistic": float(stat),
        "pvalue": float(pvalue),
        "cointegrated": bool(pvalue < 0.05),
        "hedge_ratio": float(beta[0]),
    }


@dataclass
class ForecastValidation:
    mae: float
    rmse: float
    mape: float
    directional_accuracy: float
    observations: int
    naive_rmse: float
    skill_score: float

    def to_dict(self) -> dict[str, Any]:
        return self.__dict__.copy()


def walk_forward_forecast(
    series: pd.Series,
    order: tuple[int, int, int] = (1, 1, 1),
    train_size: float = 0.7,
    step: int = 1,
    horizon: int = 1,
) -> tuple[pd.Series, ForecastValidation]:
    """Rolling one-step-ahead (or h-step) forecasts and their accuracy."""
    clean = pd.Series(series).dropna().astype(float)
    n = len(clean)
    split = int(n * train_size)
    predictions: list[float] = []
    actuals: list[float] = []
    index: list[Any] = []

    i = split
    while i + horizon < n:
        train = clean.iloc[:i]
        try:
            result = fit_arima(train, order=order, forecast_steps=horizon)
            pred = float(result.forecast.iloc[horizon - 1])
        except Exception:
            i += step
            continue
        predictions.append(pred)
        actuals.append(float(clean.iloc[i + horizon - 1]))
        index.append(clean.index[i + horizon - 1])
        i += step

    pred_series = pd.Series(predictions, index=index, name="prediction")
    actual_series = pd.Series(actuals, index=index, name="actual")
    errors = actual_series - pred_series
    mae = float(errors.abs().mean())
    rmse = float(np.sqrt((errors**2).mean()))
    mape = float((errors.abs() / actual_series.abs().replace(0, np.nan)).mean() * 100)
    direction = float((np.sign(errors.diff().dropna()) == np.sign(actual_series.diff().dropna())).mean() * 100)

    naive_errors = actual_series - actual_series.shift(1).fillna(actual_series.mean())
    naive_rmse = float(np.sqrt((naive_errors**2).mean()))
    skill = float(1 - rmse / naive_rmse) if naive_rmse > 0 else 0.0

    validation = ForecastValidation(
        mae=mae,
        rmse=rmse,
        mape=mape,
        directional_accuracy=direction,
        observations=len(predictions),
        naive_rmse=naive_rmse,
        skill_score=skill,
    )
    return pd.concat([actual_series, pred_series], axis=1), validation


def diebold_mariano(loss_a: pd.Series, loss_b: pd.Series) -> dict[str, float]:
    """Diebold–Mariano test on the loss differential (h-model, HAC-free)."""
    d = (pd.Series(loss_a) - pd.Series(loss_b)).dropna()
    n = len(d)
    if n < 10:
        return {"statistic": float("nan"), "pvalue": float("nan")}
    dm = float(d.mean())
    s = float(d.std(ddof=1))
    t = dm / (s / np.sqrt(n)) if s > 0 else 0.0
    from math import erf, sqrt

    p = 2 * (1 - 0.5 * (1 + erf(abs(t) / sqrt(2))))
    return {"statistic": t, "pvalue": float(p)}


def detect_regimes(returns: pd.Series, n_states: int = 2, lookback: int = 20) -> pd.DataFrame:
    """Two-state regime detector on rolling volatility (k-means on z-scores)."""
    r = pd.Series(returns).dropna()
    vol = r.rolling(lookback).std()
    z = (vol - vol.rolling(252).mean()) / (vol.rolling(252).std() + 1e-12)
    z = z.dropna()
    if len(z) < 60:
        return pd.DataFrame(columns=["date", "regime", "volatility"])

    values = z.to_numpy().reshape(-1, 1)
    from scipy.cluster.vq import kmeans2

    centroids, labels = kmeans2(values, n_states, minit="++", seed=42)
    order = np.argsort(centroids.ravel())
    remap = {old: new for new, old in enumerate(order)}
    labels = np.array([remap[int(l)] for l in labels])
    return pd.DataFrame(
        {
            "date": z.index,
            "regime": labels,
            "volatility": vol.reindex(z.index).to_numpy(),
        }
    )


def summarise_time_series(series: pd.Series, name: str = "series") -> dict[str, Any]:
    """One-call descriptive + diagnostic summary used by the API and notebooks."""
    clean = pd.Series(series).dropna().astype(float)
    returns = clean.pct_change().dropna()
    report = stationarity_report(clean, name)
    q_stat, q_p = ljung_box(returns, lags=min(10, max(2, len(returns) // 20)))
    vr = variance_ratio_test(returns)
    return {
        "name": name,
        "observations": len(clean),
        "start": str(clean.index[0]) if len(clean) else None,
        "end": str(clean.index[-1]) if len(clean) else None,
        "last": float(clean.iloc[-1]) if len(clean) else None,
        "mean": float(clean.mean()),
        "std": float(clean.std()),
        "min": float(clean.min()),
        "max": float(clean.max()),
        "total_return": float(clean.iloc[-1] / clean.iloc[0] - 1) if len(clean) > 1 else None,
        "annualised_vol": float(returns.std() * np.sqrt(252)) if len(returns) > 1 else None,
        "annualised_return": float(clean.iloc[-1] ** (252 / len(clean)) - 1) if len(clean) > 2 and clean.iloc[0] > 0 else None,
        "sharpe": float(returns.mean() / returns.std() * np.sqrt(252)) if returns.std() > 0 else None,
        "hurst": hurst_exponent(clean),
        "ljung_box_stat": q_stat,
        "ljung_box_pvalue": q_p,
        "variance_ratio": vr["variance_ratio"],
        "variance_ratio_pvalue": vr["pvalue"],
        "stationarity": report.to_dict(),
    }
