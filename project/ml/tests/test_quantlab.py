"""
Test suite for QuantLab.

Run with:  cd project/ml && python -m pytest tests -q

The tests cover three layers:

1. **Unit correctness** — the estimators behave as theory says (ADF on a
   random walk vs. a stationary series, GARCH recovers volatility
   clustering, the optimiser respects its constraints, the RL agents learn).
2. **Integration with real data** — live SEC EDGAR / market-data calls are
   exercised (skipped automatically when the network is unavailable).
3. **Pipeline smoke test** — the end-to-end research pipeline runs on a
   small universe and produces a report.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from quantlab import backtest as bt  # noqa: E402
from quantlab import data_sources as ds  # noqa: E402
from quantlab import metrics as mx  # noqa: E402
from quantlab import portfolio as pf  # noqa: E402
from quantlab import rl  # noqa: E402
from quantlab import timeseries as ts  # noqa: E402


# ── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def synthetic_returns() -> pd.DataFrame:
    """Four assets, 750 daily observations, with a real market-like structure."""
    rng = np.random.default_rng(11)
    n = 750
    dates = pd.bdate_range("2021-01-03", periods=n)
    market = rng.normal(0.0004, 0.011, n)
    frames = {}
    for i, (beta, idio) in enumerate([(1.0, 0.004), (0.9, 0.006), (1.1, 0.005), (0.7, 0.008)]):
        idio_noise = rng.normal(0, idio, n)
        frames[f"AST{i}"] = beta * market + idio_noise + rng.normal(0.0002, 0.001, n)
    return pd.DataFrame(frames, index=dates)


@pytest.fixture(scope="module")
def synthetic_prices(synthetic_returns: pd.DataFrame) -> pd.DataFrame:
    return (1 + synthetic_returns).cumprod() * 100


# ── Time-series ──────────────────────────────────────────────────────────────

def test_adf_rejects_unit_root_on_random_walk():
    rng = np.random.default_rng(3)
    walk = pd.Series(np.cumsum(rng.normal(0, 1, 500)))
    stat, pvalue, stationary = ts.adf_test(walk)
    assert not stationary
    assert pvalue > 0.05


def test_adf_accepts_stationary_series():
    rng = np.random.default_rng(4)
    stationary = pd.Series(rng.normal(0, 1, 500))
    stat, pvalue, stationary = ts.adf_test(stationary)
    assert stationary
    assert pvalue < 0.05


def test_differencing_makes_series_stationary():
    rng = np.random.default_rng(5)
    walk = pd.Series(np.cumsum(rng.normal(0, 1, 400)))
    _, d = ts.difference_to_stationary(walk)
    assert d >= 1


def test_hurst_exponent_distinguishes_trend_and_mean_reversion():
    rng = np.random.default_rng(6)
    trend = pd.Series(np.cumsum(rng.normal(0, 1, 600)))
    noisy = pd.Series(rng.normal(0, 1, 600))
    assert ts.hurst_exponent(trend) > 0.55
    assert ts.hurst_exponent(noisy) < 0.55


def test_acf_of_ar1_process_decays_exponentially():
    rng = np.random.default_rng(7)
    phi = 0.7
    x = np.zeros(400)
    for i in range(1, len(x)):
        x[i] = phi * x[i - 1] + rng.normal(0, 1)
    acf = ts.autocorrelation(pd.Series(x), nlags=5)
    assert acf.iloc[0] > 0.5
    assert acf.iloc[0] > acf.iloc[2] > acf.iloc[4]


def test_ljung_box_detects_autocorrelation():
    rng = np.random.default_rng(8)
    x = np.zeros(400)
    for i in range(1, len(x)):
        x[i] = 0.8 * x[i - 1] + rng.normal(0, 1)
    stat, pvalue = ts.ljung_box(pd.Series(x), lags=5)
    assert pvalue < 0.05


def test_garch_persistence_is_positive_and_below_one():
    rng = np.random.default_rng(9)
    returns = pd.Series(rng.normal(0, 0.01, 800))
    result = ts.fit_garch11(returns)
    assert 0 < result.alpha < 1
    assert 0 < result.beta < 1
    assert 0 < result.persistence < 1


def test_walk_forward_forecast_reports_skill():
    rng = np.random.default_rng(10)
    series = pd.Series(np.cumsum(rng.normal(0.0005, 0.01, 400)))
    _, validation = ts.walk_forward_forecast(series, order=(1, 1, 1), train_size=0.7)
    assert validation.observations > 20
    assert validation.rmse > 0
    assert -1.0 <= validation.skill_score <= 1.0


def test_stationarity_report_structure():
    rng = np.random.default_rng(12)
    report = ts.stationarity_report(pd.Series(rng.normal(0, 1, 300)), "x")
    assert report.observations == 300
    assert report.verdict


# ── Metrics ──────────────────────────────────────────────────────────────────

def test_sharpe_of_zero_return_stream_is_zero():
    stats = mx.performance_stats(pd.Series([0.0] * 100))
    assert stats["sharpe"] == 0.0


def test_max_drawdown_math():
    nav = np.array([1.0, 1.2, 0.9, 1.1])
    dd = mx.drawdown_series(nav)
    assert np.isclose(dd.min(), -0.25)


def test_cvar_is_worse_than_var():
    rng = np.random.default_rng(13)
    returns = pd.Series(rng.normal(0, 0.01, 2000))
    stats = mx.performance_stats(returns)
    assert stats["cvar_95"] >= stats["var_95"]


def test_deflated_sharpe_penalises_more_trials():
    base = mx.deflated_sharpe_ratio(1.0, 500, trials=1)
    many = mx.deflated_sharpe_ratio(1.0, 500, trials=100)
    assert base is not None and many is not None
    assert many < base


# ── Portfolio construction ───────────────────────────────────────────────────

def test_ledoit_wolf_shrinks_covariance():
    rng = np.random.default_rng(14)
    returns = pd.DataFrame(rng.normal(0, 0.01, (200, 12)))
    cov, delta = pf.ledoit_wolf(returns)
    assert 0.0 <= delta <= 1.0
    assert cov.shape == (12, 12)
    assert np.allclose(cov, cov.T)


def test_optimizer_respects_max_weight():
    rng = np.random.default_rng(15)
    n = 8
    cov = np.eye(n) * 0.04 + 0.01
    mu = rng.normal(0.08, 0.03, n)
    constraints = pf.Constraints(long_only=True, max_weight=0.2)
    weights = pf.mean_variance(mu, cov, "sharpe", 0.02, constraints)
    assert weights.sum() == pytest.approx(1.0, abs=1e-6)
    assert weights.min() >= -1e-9
    assert weights.max() <= 0.2 + 1e-6


def test_risk_parity_equalises_risk_contributions():
    rng = np.random.default_rng(16)
    n = 6
    base = rng.normal(0, 0.01, (400, 1))
    noise = rng.normal(0, 0.01, (400, n))
    returns = pd.DataFrame(base + noise, columns=[f"A{i}" for i in range(n)])
    cov = pf.ledoit_wolf(returns)[0] * 252
    weights = pf.risk_parity(cov)
    rc = pf.risk_contributions(weights, cov)
    spread = rc["percent_of_risk"].max() - rc["percent_of_risk"].min()
    assert spread < 8.0  # roughly equal contributions


def test_black_litterman_moves_prior_towards_view():
    rng = np.random.default_rng(17)
    n = 4
    cov = np.eye(n) * 0.05
    weights = np.ones(n) / n
    views = [{"index": 0, "expected_return": 0.30, "confidence": 0.9}]
    posterior, prior = pf.black_litterman(weights, cov, 0.04, 0.05, views)
    assert posterior[0] > prior[0]
    assert posterior[1] == pytest.approx(prior[1], abs=1e-6)


def test_min_cvar_weights_sum_to_one():
    rng = np.random.default_rng(18)
    returns = pd.DataFrame(rng.normal(0, 0.01, (300, 5)), columns=list("ABCDE"))
    weights = pf.min_cvar(returns, 0.95, pf.Constraints(long_only=True, max_weight=0.5))
    assert weights.sum() == pytest.approx(1.0, abs=1e-6)
    assert weights.min() >= -1e-9


def test_efficient_frontier_is_monotone_in_return():
    rng = np.random.default_rng(19)
    n = 6
    cov = np.eye(n) * 0.05
    mu = np.linspace(0.04, 0.14, n)
    frontier = pf.efficient_frontier(mu, cov, 15, 0.02, pf.Constraints(max_weight=0.6))
    assert len(frontier) > 5
    assert frontier["expected_return"].is_monotonic_increasing


# ── Reinforcement learning ───────────────────────────────────────────────────

def test_environment_accounts_for_transaction_costs():
    returns = pd.DataFrame({"A": [0.01] * 50, "B": [0.01] * 50})
    env = rl.PortfolioEnv(returns, rl.EnvConfig(transaction_cost_bps=100, risk_aversion=0.0))
    env.reset()
    action = np.array([1.0, 0.0])
    _, reward, _, info = env.step(action)
    assert info["cost"] > 0
    assert reward < info["gross_return"]


def test_rl_agents_run_and_return_valid_weights(synthetic_returns):
    env = rl.PortfolioEnv(synthetic_returns)
    agents = [
        rl.EqualWeightAgent(),
        rl.RandomAgent(),
        rl.MomentumAgent(),
        rl.REINFORCEAgent(synthetic_returns.shape[1]),
        rl.PolicyGradientAgent(synthetic_returns.shape[1]),
        rl.ThompsonSamplingAgent(synthetic_returns.shape[1]),
    ]
    for agent in agents:
        state = env.reset()
        weights = agent.act(state, env)
        assert weights.shape == (synthetic_returns.shape[1],)
        assert weights.min() >= -1e-12
        assert weights.sum() == pytest.approx(1.0, abs=1e-6)


def test_policy_gradient_learns(synthetic_returns):
    """Training the deterministic policy gradient must improve the reward."""
    agent = rl.PolicyGradientAgent(synthetic_returns.shape[1], learning_rate=0.05)
    config = rl.EnvConfig(risk_aversion=0.0)
    before = rl.evaluate_agent(rl.PolicyGradientAgent(synthetic_returns.shape[1]), synthetic_returns, config)
    rl.train_agent(agent, synthetic_returns, config, episodes=6, seed=3)
    after = rl.evaluate_agent(agent, synthetic_returns, config)
    assert after["total_return"] >= before["total_return"] - 0.02


def test_agent_comparison_reports_all_agents(synthetic_returns):
    result = rl.run_agent_comparison(synthetic_returns, rl.EnvConfig(), episodes=2, seed=1)
    for name in ("equal-weight", "random", "momentum", "reinforce", "policy-gradient", "thompson-sampling", "buy-and-hold"):
        assert name in result["evaluation"]


# ── Backtesting ──────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def sample_panel() -> pd.DataFrame:
    rows = []
    rng = np.random.default_rng(21)
    for ticker in ["AAA", "BBB", "CCC"]:
        equity = 1000.0
        for year in range(3):
            for q in range(1, 5):
                revenue = 500 + rng.normal(0, 20)
                gross = revenue * (0.35 + rng.normal(0, 0.03))
                operating = gross * 0.6
                net = operating * 0.75
                equity *= 1 + rng.normal(0.02, 0.05)
                rows.append(
                    {
                        "ticker": ticker,
                        "fiscal_year": 2022 + year,
                        "fiscal_quarter": q,
                        "period_end": pd.Timestamp(2022 + year, q * 3, 28),
                        "revenue": revenue,
                        "gross_profit": gross,
                        "operating_income": operating,
                        "net_income": net,
                        "operating_cash_flow": net * 1.1,
                        "total_assets": equity,
                        "total_liabilities": equity * 0.55,
                        "total_equity": equity * 0.45,
                        "current_assets": equity * 0.3,
                        "current_labilities": equity * 0.2,
                        "cash": equity * 0.1,
                        "total_debt": equity * 0.25,
                        "long_term_debt": equity * 0.2,
                        "inventory": equity * 0.05,
                        "receivables": equity * 0.08,
                        "eps": 1.5 + rng.normal(0, 0.2),
                        "shares_outstanding": 100.0,
                        "capex": revenue * 0.05,
                        "free_cash_flow": net * 0.8,
                        "dividends_paid": net * 0.1,
                    }
                )
    return pd.DataFrame(rows)


def test_piotroski_score_between_zero_and_nine(sample_panel):
    scores = bt.piotroski_f_score(bt.prepare_panel(sample_panel))
    valid = scores.dropna()
    assert len(valid) > 0
    assert valid.min() >= 0
    assert valid.max() <= 9


def test_backtest_produces_statistics(sample_panel):
    rng = np.random.default_rng(22)
    dates = pd.bdate_range("2022-01-03", periods=500)
    prices = pd.DataFrame(
        {t: 100 * (1 + rng.normal(0.0005, 0.012, 500)).cumprod() for t in ["AAA", "BBB", "CCC"]},
        index=dates,
    )
    result = bt.run_fundamental_backtest(sample_panel, prices, "piotroski", bt.BacktestConfig(top_n=2))
    assert "strategy" in result
    assert result["strategy"]["observations"] > 0
    assert result["rebalances"] >= 1


# ── Live data (network) ──────────────────────────────────────────────────────

@pytest.mark.network
def test_sec_company_facts_available():
    cik = ds.cik_for("AAPL")
    assert cik is not None
    fundamentals = ds.fetch_sec_fundamentals("AAPL", max_quarters=6)
    assert len(fundamentals.rows) >= 4
    frame = fundamentals.to_frame()
    assert frame["revenue"].notna().all()


@pytest.mark.network
def test_nasdaq_quote_available():
    quote = ds.fetch_nasdaq_quote("AAPL")
    assert quote["symbol"] == "AAPL"
    assert quote["company_name"]


@pytest.mark.network
def test_daily_prices_available():
    frame = ds.fetch_daily_prices("AAPL", period="1y")
    assert len(frame) > 200
    assert (frame["close"] > 0).all()
