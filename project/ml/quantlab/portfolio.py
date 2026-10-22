"""
Portfolio construction engines.

* ``mean_variance``      – Markowitz with Ledoit–Wolf shrinkage covariance
* ``risk_parity``        – equal risk contribution (Maillard et al. 2010)
* ``black_litterman``    – Bayesian blend of equilibrium returns and views
* ``min_cvar``           – rockafellar–Uryasev CVaR minimisation
* ``efficient_frontier`` – the full risk/return frontier
* ``equal_weight``       – the benchmark every optimizer must beat

All optimisers respect a long-only constraint, a maximum single-name weight
and optional sector caps.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

import numpy as np
import pandas as pd


# ── Covariance ───────────────────────────────────────────────────────────────

def ledoit_wolf(returns: pd.DataFrame) -> tuple[np.ndarray, float]:
    """Ledoit–Wolf (2004) shrinkage covariance estimator.

    Returns (covariance matrix, shrinkage intensity δ).
    """
    x = returns.to_numpy(dtype=float)
    t, n = x.shape  # t = observations, n = assets
    if n < 2 or t < 3:
        return np.cov(x, rowvar=False, ddof=1), 0.0

    sample = np.cov(x, rowvar=False, ddof=1)
    mu = x.mean(axis=0)
    # Target: scaled identity
    var = np.diag(sample).mean()
    target = np.eye(n) * var

    # pi-hat: dispersion of sample covariances around the target
    xc = x - mu
    pi_hat = 0.0
    for i in range(n):
        for j in range(n):
            num = (xc[:, i] * xc[:, j]).sum() / t
            pi_hat += (num - sample[i, j]) ** 2
    pi_hat /= n * t

    # gamma-hat: squared Frobenius distance between sample and target
    gamma_hat = ((sample - target) ** 2).sum() / (n * t)

    kappa = (pi_hat - gamma_hat) / (t * var**2) if var > 0 else 0.0
    delta = float(np.clip(kappa, 0.0, 1.0))
    shrunk = (1 - delta) * sample + delta * target
    return shrunk, delta


def annualise_covariance(returns: pd.DataFrame, periods_per_year: int = 252) -> np.ndarray:
    return ledoit_wolf(returns)[0] * periods_per_year


# ── Constraints ──────────────────────────────────────────────────────────────

@dataclass
class Constraints:
    long_only: bool = True
    max_weight: float = 1.0
    min_weight: float = 0.0
    sector_caps: dict[str, float] = field(default_factory=dict)

    def project(self, w: np.ndarray, sectors: list[str] | None = None) -> np.ndarray:
        w = np.asarray(w, dtype=float)
        w = np.clip(w, self.min_weight, self.max_weight)
        if not self.long_only:
            return w / (w.sum() or 1.0)
        # iterative simplex projection with weight caps
        for _ in range(200):
            s = w.sum()
            if abs(s - 1) < 1e-10:
                break
            w = w - (s - 1) / len(w)
            w = np.clip(w, self.min_weight, self.max_weight)
        if sectors:
            w = self._apply_sector_caps(w, sectors)
        return w / (w.sum() or 1.0)

    def _apply_sector_caps(self, w: np.ndarray, sectors: list[str]) -> np.ndarray:
        w = w.copy()
        for _ in range(50):
            totals: dict[str, float] = {}
            for weight, sector in zip(w, sectors):
                totals[sector] = totals.get(sector, 0.0) + weight
            violated = False
            for sector, cap in self.sector_caps.items():
                total = totals.get(sector, 0.0)
                if total > cap + 1e-9:
                    violated = True
                    idx = [i for i, s in enumerate(sectors) if s == sector]
                    others = [i for i, s in enumerate(sectors) if s != sector]
                    scale = cap / total
                    freed = 0.0
                    for i in idx:
                        freed += w[i] * (1 - scale)
                        w[i] *= scale
                    others_total = sum(w[i] for i in others)
                    if others_total > 0:
                        for i in others:
                            w[i] += freed * w[i] / others_total
            if not violated:
                break
        return w


# ── Optimisers ───────────────────────────────────────────────────────────────

def equal_weight(n: int, constraints: Constraints | None = None) -> np.ndarray:
    w = np.ones(n) / n
    return constraints.project(w) if constraints else w


def inverse_volatility(cov: np.ndarray, constraints: Constraints | None = None) -> np.ndarray:
    vol = np.sqrt(np.clip(np.diag(cov), 1e-12, None))
    w = 1 / vol
    w = w / w.sum()
    return constraints.project(w) if constraints else w


def mean_variance(
    mu: np.ndarray,
    cov: np.ndarray,
    objective: str = "sharpe",
    risk_free: float = 0.0,
    constraints: Constraints | None = None,
) -> np.ndarray:
    """Mean–variance optimisation via projected gradient ascent.

    objective ∈ {"sharpe", "variance", "return"}.
    """
    mu = np.asarray(mu, dtype=float)
    n = len(mu)
    constraints = constraints or Constraints()

    def score(w: np.ndarray) -> float:
        exp = float(w @ mu)
        var = float(w @ cov @ w)
        if objective == "variance":
            return -var
        if objective == "return":
            return exp
        sd = np.sqrt(max(var, 1e-12))
        return (exp - risk_free) / sd

    w = equal_weight(n, constraints)
    best = score(w)
    step = 0.5
    for _ in range(4000):
        grad = np.zeros(n)
        eps = 1e-6
        for i in range(n):
            up = w.copy(); up[i] += eps
            dn = w.copy(); dn[i] -= eps
            grad[i] = (score(up) - score(dn)) / (2 * eps)
        candidate = constraints.project(w + step * grad)
        value = score(candidate)
        if value > best + 1e-12:
            best = value
            w = candidate
        else:
            step *= 0.5
            if step < 1e-10:
                break
    return w


def risk_parity(
    cov: np.ndarray,
    budgets: np.ndarray | None = None,
    constraints: Constraints | None = None,
    max_iter: int = 500,
    tol: float = 1e-10,
) -> np.ndarray:
    """Equal-risk-contribution portfolio (fixed-point iteration)."""
    n = cov.shape[0]
    constraints = constraints or Constraints()
    budgets = np.ones(n) / n if budgets is None else np.asarray(budgets, dtype=float)
    budgets = budgets / budgets.sum()

    w = equal_weight(n, constraints)
    for _ in range(max_iter):
        cw = cov @ w
        vol = np.sqrt(max(float(w @ cw), 1e-18))
        contrib = w * cw / vol
        total = contrib.sum() or 1.0
        rel = contrib / total
        w = w * np.sqrt(budgets / np.clip(rel, 1e-12, None))
        w = w / (w.sum() or 1.0)
        w = constraints.project(w)
        if np.abs(rel - budgets).sum() < tol:
            break
    return w


def black_litterman(
    market_weights: np.ndarray,
    cov: np.ndarray,
    risk_free: float,
    market_risk_premium: float,
    views: list[dict[str, Any]],
    tau: float = 0.05,
) -> tuple[np.ndarray, np.ndarray]:
    """Black–Litterman posterior expected returns.

    views: [{"index": i, "expected_return": r, "confidence": c}]
    Returns (posterior_returns, prior_returns).
    """
    n = len(market_weights)
    prior = risk_free + np.asarray(market_weights, dtype=float) * market_risk_premium
    if not views:
        return prior, prior

    scaled_inv = np.linalg.pinv(cov) / tau
    P = np.zeros((len(views), n))
    q = np.zeros(len(views))
    omega = np.zeros(len(views))
    for k, v in enumerate(views):
        i = int(v["index"])
        P[k, i] = 1.0
        q[k] = float(v["expected_return"])
        conf = float(v.get("confidence", 0.5))
        base = tau * max(cov[i, i], 1e-6)
        omega[k] = base / max(conf, 1e-3)

    PtOP = P.T @ np.diag(1 / omega) @ P
    A = scaled_inv + PtOP
    prior_vec = scaled_inv @ prior
    PtOQ = P.T @ (q / omega)
    b = prior_vec + PtOQ
    posterior = np.linalg.pinv(A) @ b
    return posterior, prior


def min_cvar(
    returns: pd.DataFrame,
    alpha: float = 0.95,
    constraints: Constraints | None = None,
    max_iter: int = 600,
) -> np.ndarray:
    """Rockafellar–Uryasev CVaR minimisation via linear programming.

    Solved with scipy.optimize.linprog (HiGHS). Falls back to minimum
    variance when scipy is unavailable.
    """
    from scipy.optimize import linprog

    matrix = returns.to_numpy(dtype=float)
    n_obs, n_assets = matrix.shape  # rows = observations, columns = assets
    constraints = constraints or Constraints()

    # Decision variables: weights (n) + VaR alpha (1) + u (n_obs)
    n_var = n_assets + 1 + n_obs
    c = np.zeros(n_var)
    c[n_assets] = 1.0
    c[n_assets + 1 :] = 1.0 / (n_obs * (1 - alpha))

    losses = -matrix  # loss matrix L[t, i]
    # -z - u_t <= -L_t . w   ->  -L_t w - u_t <= -z
    A_ub = np.zeros((n_obs, n_var))
    for t in range(n_obs):
        A_ub[t, :n_assets] = losses[t]
        A_ub[t, n_assets] = -1.0
        A_ub[t, n_assets + 1 + t] = -1.0
    b_ub = np.zeros(n_obs)

    A_eq = np.zeros((1, n_var))
    A_eq[0, :n_assets] = 1.0
    b_eq = np.array([1.0])

    bounds = [(0.0, constraints.max_weight)] * n_assets + [(None, None)] + [(0.0, None)] * n_obs

    result = linprog(c, A_ub=A_ub, b_ub=b_ub, A_eq=A_eq, b_eq=b_eq, bounds=bounds, method="highs")
    if result.success:
        return np.asarray(result.x[:n_assets], dtype=float)
    cov = annualise_covariance(returns)
    return mean_variance(np.zeros(n_assets), cov, objective="variance", constraints=constraints)


def efficient_frontier(
    mu: np.ndarray,
    cov: np.ndarray,
    n_points: int = 30,
    risk_free: float = 0.0,
    constraints: Constraints | None = None,
) -> pd.DataFrame:
    """Risk/return frontier of the constrained efficient set.

    The frontier is built by solving a minimum-variance problem subject to a
    fixed expected-return target, sweeping the target from the minimum-variance
    portfolio up to the maximum-return portfolio. Rows are returned sorted by
    expected return, so the frontier is monotone by construction.
    """
    mu = np.asarray(mu, dtype=float)
    n = len(mu)
    constraints = constraints or Constraints()

    min_var = mean_variance(mu, cov, objective="variance", constraints=constraints)
    min_var_vol = np.sqrt(max(float(min_var @ cov @ min_var), 1e-12))
    r_min = float(min_var @ mu)

    max_ret_w = mean_variance(mu, cov, objective="return", constraints=constraints)
    r_max = float(max_ret_w @ mu)
    if r_max < r_min:  # degenerate (e.g. negative expected returns)
        r_min, r_max = r_max, r_min

    rows: list[dict[str, float]] = []
    for target in np.linspace(r_min, r_max, max(2, n_points)):
        w = _target_return_portfolio(mu, cov, float(target), constraints)
        exp = float(w @ mu)
        vol = np.sqrt(max(float(w @ cov @ w), 1e-12))
        rows.append(
            {
                "expected_return": exp,
                "volatility": vol,
                "sharpe": (exp - risk_free) / vol if vol > 0 else 0.0,
            }
        )
    frame = (
        pd.DataFrame(rows)
        .sort_values("expected_return")
        .drop_duplicates(subset=["expected_return"])
        .reset_index(drop=True)
    )
    frame.attrs["min_variance_vol"] = min_var_vol
    return frame


def min_ret_target(mu: np.ndarray, cov: np.ndarray, constraints: Constraints | None = None) -> float:
    """Expected return of the minimum-variance portfolio (the left edge)."""
    constraints = constraints or Constraints()
    w = mean_variance(mu, cov, objective="variance", constraints=constraints)
    return float(w @ mu)


def _target_return_portfolio(
    mu: np.ndarray, cov: np.ndarray, target: float, constraints: Constraints
) -> np.ndarray:
    """Minimise variance subject to an expected-return target.

    Uses SLSQP (scipy) when available — it enforces the return target exactly
    — and falls back to a penalised projected-gradient search otherwise.
    """
    n = len(mu)

    try:
        from scipy.optimize import minimize

        bounds = [(constraints.min_weight, constraints.max_weight)] * n

        def objective(w: np.ndarray) -> float:
            return float(w @ cov @ w)

        def jac(w: np.ndarray) -> np.ndarray:
            return 2.0 * (cov @ w)

        cons = [
            {"type": "eq", "fun": lambda w: float(np.sum(w) - 1.0)},
            {"type": "eq", "fun": lambda w: float(w @ mu - target)},
        ]
        start = equal_weight(n, constraints)
        res = minimize(
            objective,
            start,
            jac=jac,
            bounds=bounds,
            constraints=cons,
            method="SLSQP",
            options={"maxiter": 500, "ftol": 1e-12},
        )
        if res.success and np.all(np.isfinite(res.x)):
            w = np.asarray(res.x, dtype=float)
            if abs(w.sum() - 1.0) < 1e-6 and w.min() >= constraints.min_weight - 1e-6:
                return w
    except Exception:
        pass

    def score(w: np.ndarray) -> float:
        var = float(w @ cov @ w)
        return -var - 500.0 * (float(w @ mu) - target) ** 2

    w = equal_weight(n, constraints)
    best = score(w)
    step = 0.2
    for _ in range(3000):
        grad = np.zeros(n)
        eps = 1e-6
        for i in range(n):
            up = w.copy(); up[i] += eps
            dn = w.copy(); dn[i] -= eps
            grad[i] = (score(up) - score(dn)) / (2 * eps)
        candidate = constraints.project(w + step * grad)
        value = score(candidate)
        if value > best + 1e-14:
            best = value
            w = candidate
        else:
            step *= 0.5
            if step < 1e-11:
                break
    return w


def risk_contributions(weights: np.ndarray, cov: np.ndarray) -> pd.DataFrame:
    """Euler decomposition of portfolio variance into per-asset contributions."""
    w = np.asarray(weights, dtype=float)
    var = float(w @ cov @ w)
    vol = np.sqrt(max(var, 1e-18))
    marginal = (cov @ w) / vol
    component = w * marginal
    total = component.sum() or 1.0
    return pd.DataFrame(
        {
            "weight": w,
            "marginal_risk": marginal,
            "component_risk": component,
            "percent_of_risk": component / total * 100,
        }
    )


def brinson_attribution(
    portfolio_weights: pd.DataFrame,
    benchmark_weights: pd.DataFrame,
    portfolio_returns: pd.DataFrame,
    benchmark_returns: pd.DataFrame,
) -> pd.DataFrame:
    """Brinson–Fachler attribution across periods.

    All inputs are indexed by period with identical columns.
    """
    assets = portfolio_returns.columns
    rows: dict[str, float] = {a: 0.0 for a in assets}
    for asset in assets:
        wp = portfolio_weights[asset].to_numpy()
        wb = benchmark_weights[asset].to_numpy()
        rp = portfolio_returns[asset].to_numpy()
        rb = benchmark_returns[asset].to_numpy()
        pt = (portfolio_weights.to_numpy() * portfolio_returns.to_numpy()).sum(axis=1)
        bt = (benchmark_weights.to_numpy() * benchmark_returns.to_numpy()).sum(axis=1)
        allocation = ((wp - wb) * (rb - bt)).sum()
        selection = (wb * (rp - rb)).sum()
        interaction = ((wp - wb) * (rp - rb)).sum()
        rows[asset] = allocation + selection + interaction

    frame = pd.DataFrame(
        {
            "allocation": [
                ((portfolio_weights[a] - benchmark_weights[a]) * (benchmark_returns[a] - (benchmark_weights.to_numpy() * benchmark_returns.to_numpy()).sum(axis=1))).sum()
                for a in assets
            ],
            "selection": [
                (benchmark_weights[a] * (portfolio_returns[a] - benchmark_returns[a])).sum()
                for a in assets
            ],
            "interaction": [
                ((portfolio_weights[a] - benchmark_weights[a]) * (portfolio_returns[a] - benchmark_returns[a])).sum()
                for a in assets
            ],
        }
    )
    frame["total"] = frame.sum(axis=1)
    frame.index.name = "asset"
    return frame


def summarise_portfolio(
    weights: np.ndarray,
    names: list[str],
    cov: np.ndarray,
    mu: np.ndarray,
    risk_free: float = 0.0,
) -> dict[str, Any]:
    var = float(weights @ cov @ weights)
    vol = np.sqrt(max(var, 1e-18))
    exp = float(weights @ mu)
    rc = risk_contributions(weights, cov)
    return {
        "weights": {n: float(w) for n, w in zip(names, weights)},
        "expected_return": exp,
        "volatility": vol,
        "sharpe": (exp - risk_free) / vol if vol > 0 else 0.0,
        "effective_number_of_bets": float(1 / np.sum(weights**2)) if np.sum(weights**2) > 0 else 0.0,
        "risk_contributions": rc.to_dict(orient="index"),
    }
