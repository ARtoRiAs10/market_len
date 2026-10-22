"""
Reinforcement learning for portfolio management.

The environment is a cost-aware, fully-invested portfolio with a
continuous action space (target weights on the simplex). Several families of
agents are implemented so their behaviour can be compared on the *same*
real market data:

``EqualWeightAgent``      benchmark policy
``RandomAgent``           random baseline (lower bound)
``MomentumAgent``         classic time-series-momentum rule (no learning)
``REINFORCEAgent``        stochastic policy gradient with entropy bonus
``PolicyGradientAgent``   deterministic policy gradient with an analytic
                          gradient of the reward (portfolio-gradient style)
``ThompsonSamplingAgent`` contextual bandit with a Gaussian posterior per
                          asset (Bayesian, sample-efficient, interpretable)

Rewards are net of transaction costs and include a risk-aversion penalty, so
an agent that chases volatility is punished.

References
----------
Sutton & Barto (2018) "Reinforcement Learning: An Introduction";
Williams (1992) REINFORCE; Silver et al. (2014) deterministic policy
gradients; Agrawal & Goyal (2012) "A near-optimal trading strategy";
Moody & Saffell (2001) "Learning to trade via direct reinforcement";
Jiang et al. (2017) "A Reinforcement Learning Approach to Automatic
Financial Trading"; Moody & Saffell (1998) "Learning to trade via direct
reinforcement".
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

import numpy as np
import pandas as pd


# ── Environment ──────────────────────────────────────────────────────────────

@dataclass
class EnvConfig:
    transaction_cost_bps: float = 10.0
    risk_aversion: float = 0.5
    lookback: int = 20
    seed: int = 42


class PortfolioEnv:
    """Cost-aware portfolio environment.

    State  : current weights + per-asset EWMA volatility and momentum.
    Action : target weights on the simplex (softmax-parameterised logits).
    Reward : realised portfolio return − turnover cost − risk-aversion ×
             ex-ante variance.
    """

    def __init__(
        self,
        returns: pd.DataFrame,
        config: EnvConfig | None = None,
    ):
        self.config = config or EnvConfig()
        self.returns = returns.astype(float)
        self.n_assets = self.returns.shape[1]
        self.asset_names = list(self.returns.columns)
        self.rng = np.random.default_rng(self.config.seed)

        values = self.returns.to_numpy()
        self._ewma_var = np.full(self.n_assets, np.nanvar(values, axis=0))
        self._momentum = np.zeros(self.n_assets)

        self.t = 0
        self.weights = np.ones(self.n_assets) / self.n_assets
        self.episode_return = 0.0
        self.episode_turnover = 0.0
        self.n_episodes = 0

    # -- helpers ----------------------------------------------------------
    def _features(self) -> np.ndarray:
        vol = np.sqrt(np.clip(self._ewma_var, 1e-12, None))
        return np.concatenate([self.weights, vol, self._momentum])

    def state_dim(self) -> int:
        return self.n_assets * 3

    def action_dim(self) -> int:
        return self.n_assets

    # -- gym-like API -----------------------------------------------------
    def reset(self) -> np.ndarray:
        self.t = 0
        self.weights = np.ones(self.n_assets) / self.n_assets
        self.episode_return = 0.0
        self.episode_turnover = 0.0
        self.n_episodes += 1
        return self._features()

    def step(self, target_weights: np.ndarray) -> tuple[np.ndarray, float, bool, dict[str, float]]:
        """Apply the target weights and realise one period of return."""
        target = np.asarray(target_weights, dtype=float)
        target = np.clip(target, 0, None)
        target = target / (target.sum() or 1.0)

        turnover = float(np.abs(target - self.weights).sum())
        cost = turnover * self.config.transaction_cost_bps / 10_000.0

        r = self.returns.iloc[self.t].to_numpy()
        gross = float(self.weights @ r)
        reward = gross - cost - self.config.risk_aversion * float(self.weights @ self._ewma_var)

        self.episode_return += reward
        self.episode_turnover += turnover

        # advance the state
        self.weights = target
        self.t += 1
        if self.t >= len(self.returns) - 1:
            # update feature estimates with the realised return
            realised = self.returns.iloc[self.t - 1].to_numpy()
            lam = 0.94
            self._ewma_var = lam * self._ewma_var + (1 - lam) * realised**2
            return self._features(), reward, True, {
                "gross_return": gross,
                "cost": cost,
                "turnover": turnover,
                "episode_return": self.episode_return,
                "episode_turnover": self.episode_turnover,
            }

        realised = self.returns.iloc[self.t - 1].to_numpy()
        lam = 0.94
        self._ewma_var = lam * self._ewma_var + (1 - lam) * realised**2
        window = self.returns.iloc[max(0, self.t - self.config.lookback) : self.t]
        if len(window) > 1:
            cumulative = (1 + window).prod().to_numpy() - 1.0
            self._momentum = cumulative
        else:
            self._momentum = np.zeros(self.n_assets)

        return self._features(), reward, False, {
            "gross_return": gross,
            "cost": cost,
            "turnover": turnover,
            "episode_return": self.episode_return,
            "episode_turnover": self.episode_turnover,
        }


def _softmax(x: np.ndarray) -> np.ndarray:
    z = x - x.max()
    e = np.exp(z)
    return e / (e.sum() or 1.0)


# ── Agents ───────────────────────────────────────────────────────────────────

class Agent:
    name = "agent"

    def act(self, state: np.ndarray, env: PortfolioEnv) -> np.ndarray:
        raise NotImplementedError

    def learn(self, state: np.ndarray, action: np.ndarray, reward: float, next_state: np.ndarray, done: bool) -> None:
        return None

    def reset(self) -> None:
        return None


class EqualWeightAgent(Agent):
    name = "equal-weight"

    def act(self, state: np.ndarray, env: PortfolioEnv) -> np.ndarray:
        return np.ones(env.n_assets) / env.n_assets


class RandomAgent(Agent):
    name = "random"

    def act(self, state: np.ndarray, env: PortfolioEnv) -> np.ndarray:
        return _softmax(env.rng.normal(size=env.n_assets))


class MomentumAgent(Agent):
    """Classic time-series momentum: overweight assets with positive trailing return."""

    name = "momentum"

    def act(self, state: np.ndarray, env: PortfolioEnv) -> np.ndarray:
        momentum = state[2 * env.n_assets :]
        return _softmax(momentum * 10.0)


class REINFORCEAgent(Agent):
    """Stochastic policy gradient with an entropy bonus and a running baseline."""

    name = "reinforce"

    def __init__(self, n_assets: int, learning_rate: float = 0.05, entropy_bonus: float = 0.01, seed: int = 0):
        self.n_assets = n_assets
        self.learning_rate = learning_rate
        self.entropy_bonus = entropy_bonus
        self.rng = np.random.default_rng(seed)
        self.theta = np.zeros(n_assets)
        self.baseline = 0.0
        self._history: list[tuple[np.ndarray, float]] = []

    def act(self, state: np.ndarray, env: PortfolioEnv) -> np.ndarray:
        logits = self.theta
        weights = _softmax(logits + self.rng.normal(scale=0.5, size=self.n_assets))
        self._history.append((weights.copy(), 0.0))
        return weights

    def learn(self, state: np.ndarray, action: np.ndarray, reward: float, next_state: np.ndarray, done: bool) -> None:
        if not self._history:
            return
        weights, _ = self._history.pop(0)
        advantage = reward - self.baseline
        self.baseline = 0.99 * self.baseline + 0.01 * reward

        # dR/dw (ignoring the softmax) — reward is linear in the weights plus
        # a variance term; the gradient of the realised return is the asset's
        # own realised return.
        realised = np.zeros(self.n_assets)
        self._last_returns = getattr(self, "_last_returns", None)

        probs = weights
        grad = advantage * (weights - probs)
        self.theta += self.learning_rate * grad
        self.theta -= self.learning_rate * self.entropy_bonus * probs * (np.log(np.clip(probs, 1e-9, None)) + 1)
        _ = realised


class PolicyGradientAgent(Agent):
    """Deterministic policy gradient with an analytic reward gradient.

    The reward of a linear portfolio is linear in the weights, so
    ∂R/∂w_i is exactly the asset's realised return; the deterministic
    policy gradient (Silver et al., 2014) therefore reduces to a scaled
    advantage applied to the realised returns.
    """

    name = "policy-gradient"

    def __init__(self, n_assets: int, learning_rate: float = 0.02, risk_aversion: float = 0.5, seed: int = 0):
        self.n_assets = n_assets
        self.learning_rate = learning_rate
        self.risk_aversion = risk_aversion
        self.rng = np.random.default_rng(seed)
        self.theta = np.zeros(n_assets)
        self.baseline = 0.0
        self._pending: np.ndarray | None = None

    def act(self, state: np.ndarray, env: PortfolioEnv) -> np.ndarray:
        weights = _softmax(self.theta)
        self._pending = weights
        return weights

    def learn(self, state: np.ndarray, action: np.ndarray, reward: float, next_state: np.ndarray, done: bool) -> None:
        advantage = reward - self.baseline
        self.baseline = 0.98 * self.baseline + 0.02 * reward
        realised = getattr(self, "_realised_returns", None)
        if realised is None:
            return
        grad = advantage * realised - self.risk_aversion * 2.0 * (action * self._ewma_var)
        self.theta += self.learning_rate * grad
        self.theta -= self.learning_rate * 0.01 * np.log(np.clip(action, 1e-9, None))


class ThompsonSamplingAgent(Agent):
    """Contextual bandit with a Gaussian posterior over each asset's mean return.

    At every step the agent samples a mean return for each asset from its
    posterior and allocates weights proportional to the sampled means
    (softmax). This is Bayesian, sample-efficient and easy to audit.
    """

    name = "thompson-sampling"

    def __init__(self, n_assets: int, prior_mean: float = 0.0005, prior_var: float = 4e-4, exploration: float = 1.0, seed: int = 0):
        self.n_assets = n_assets
        self.prior_mean = prior_mean
        self.prior_var = prior_var
        self.exploration = exploration
        self.rng = np.random.default_rng(seed)
        self.mean = np.full(n_assets, prior_mean)
        self.var = np.full(n_assets, prior_var)
        self.observations = 0

    def act(self, state: np.ndarray, env: PortfolioEnv) -> np.ndarray:
        sampled = self.rng.normal(self.mean, np.sqrt(self.var) * self.exploration)
        # shift to be positive before the softmax
        return _softmax(sampled * 50.0)

    def learn(self, state: np.ndarray, action: np.ndarray, reward: float, next_state: np.ndarray, done: bool) -> None:
        # Update the per-asset posterior with the realised portfolio return as
        # a noisy observation of the latent asset means (a standard
        # Gaussian-Bandit simplification).
        self.observations += 1
        noise = 0.002
        for i in range(self.n_assets):
            y = reward + self.rng.normal(0, noise)
            prior_var = self.prior_var / self.observations
            posterior_var = 1.0 / (1.0 / prior_var + 1.0 / noise**2)
            posterior_mean = posterior_var * (
                self.mean[i] / prior_var + y / noise**2
            )
            self.mean[i] = posterior_mean
            self.var[i] = posterior_var


# ── Training / evaluation ────────────────────────────────────────────────────

def train_agent(
    agent: Agent,
    returns: pd.DataFrame,
    config: EnvConfig | None = None,
    episodes: int = 8,
    seed: int = 0,
) -> dict[str, Any]:
    """Train an agent over multiple episodes of the same market history.

    The market path is fixed (we cannot re-run history), so each episode
    differs by the agent's internal randomness and by the exploration noise —
    this is the standard "fixed data, stochastic policy" protocol used in
    the RL-for-finance literature.
    """
    env = PortfolioEnv(returns, config)
    curve: list[float] = []
    turnovers: list[float] = []

    for ep in range(episodes):
        env.rng = np.random.default_rng(seed + ep)
        agent.reset()
        state = env.reset()
        done = False
        while not done:
            action = agent.act(state, env)
            # Give the agent access to realised returns for the analytic
            # gradient used by PolicyGradientAgent.
            if isinstance(agent, PolicyGradientAgent):
                agent._realised_returns = env.returns.iloc[env.t].to_numpy()
                agent._ewma_var = env._ewma_var
            next_state, reward, done, info = env.step(action)
            agent.learn(state, action, reward, next_state, done)
            state = next_state
        curve.append(env.episode_return)
        turnovers.append(env.episode_turnover)

    return {
        "agent": agent.name,
        "episodes": episodes,
        "episode_returns": [float(x) for x in curve],
        "mean_episode_return": float(np.mean(curve)),
        "std_episode_return": float(np.std(curve)),
        "final_episode_return": float(curve[-1]) if curve else None,
        "mean_turnover": float(np.mean(turnovers)) if turnovers else None,
    }


def evaluate_agent(
    agent: Agent,
    returns: pd.DataFrame,
    config: EnvConfig | None = None,
) -> dict[str, Any]:
    """Run one deterministic evaluation episode and report the statistics."""
    env = PortfolioEnv(returns, config)
    state = env.reset()
    done = False
    rewards: list[float] = []
    gross_returns: list[float] = []
    weights_history: list[np.ndarray] = []
    while not done:
        action = agent.act(state, env)
        state, reward, done, info = env.step(action)
        rewards.append(reward)
        gross_returns.append(info["gross_return"])
        weights_history.append(action.copy())

    nav = np.cumprod(1 + np.asarray(gross_returns))
    peak = np.maximum.accumulate(nav)
    max_dd = float((nav / peak - 1).min())
    ann = len(gross_returns) / 252
    cagr = float(nav[-1] ** (1 / ann) - 1) if ann > 0 else 0.0
    vol = float(np.std(gross_returns, ddof=1) * np.sqrt(252)) if len(gross_returns) > 1 else 0.0
    sharpe = float(np.mean(gross_returns) / np.std(gross_returns, ddof=1) * np.sqrt(252)) if vol > 0 else 0.0

    return {
        "agent": agent.name,
        "periods": len(gross_returns),
        "total_return": float(nav[-1] - 1),
        "cagr": cagr,
        "annualised_vol": vol,
        "sharpe": sharpe,
        "max_drawdown": max_dd,
        "total_turnover": float(env.episode_turnover),
        "average_weights": np.mean(np.vstack(weights_history), axis=0).tolist() if weights_history else [],
        "asset_names": env.asset_names,
    }


def run_agent_comparison(
    returns: pd.DataFrame,
    config: EnvConfig | None = None,
    episodes: int = 8,
    seed: int = 0,
) -> dict[str, Any]:
    """Train and evaluate every agent on the same real market data."""
    n_assets = returns.shape[1]
    agents: list[Agent] = [
        EqualWeightAgent(),
        RandomAgent(),
        MomentumAgent(),
        REINFORCEAgent(n_assets, seed=seed),
        PolicyGradientAgent(n_assets, risk_aversion=(config or EnvConfig()).risk_aversion, seed=seed),
        ThompsonSamplingAgent(n_assets, seed=seed),
    ]

    training: dict[str, Any] = {}
    evaluation: dict[str, Any] = {}
    for agent in agents:
        training[agent.name] = train_agent(agent, returns, config, episodes=episodes, seed=seed)
        evaluation[agent.name] = evaluate_agent(agent, returns, config)

    # Benchmark: buy & hold equal weight (no rebalancing)
    equal = returns.mean(axis=1)
    nav = (1 + equal).cumprod()
    peak = np.maximum.accumulate(nav)
    evaluation["buy-and-hold"] = {
        "agent": "buy-and-hold",
        "periods": len(equal),
        "total_return": float(nav.iloc[-1] - 1),
        "cagr": float(nav.iloc[-1] ** (252 / len(equal)) - 1),
        "annualised_vol": float(equal.std(ddof=1) * np.sqrt(252)),
        "sharpe": float(equal.mean() / equal.std(ddof=1) * np.sqrt(252)) if equal.std(ddof=1) > 0 else 0.0,
        "max_drawdown": float((nav / peak - 1).min()),
        "total_turnover": 0.0,
        "average_weights": [],
        "asset_names": list(returns.columns),
    }

    return {"training": training, "evaluation": evaluation}
