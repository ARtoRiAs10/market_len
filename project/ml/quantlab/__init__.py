"""
QuantLab — MarketLens research & production quant engine.

Modules
-------
``data_sources``  Real market data ingestion (SEC EDGAR XBRL, Nasdaq, Yahoo
                  Finance daily bars, FRED macro series) with on-disk caching
                  and polite rate limiting.
``timeseries``    Stationarity tests, ARIMA/GARCH models, forecast validation,
                  Hurst exponent, variance-ratio and regime diagnostics.
``portfolio``     Mean–variance with Ledoit–Wolf shrinkage, risk parity,
                  Black–Litterman, CVaR minimisation, efficient frontier.
``metrics``       Institutional performance/risk statistics (Sharpe, Sortino,
                  Calmar, VaR/CVaR, drawdown, Deflated Sharpe Ratio).
``backtest``      Walk-forward, cost-aware strategy backtesting.
``rl``            Reinforcement-learning portfolio agents (contextual bandit,
                  Thompson sampling, Q-learning, policy gradient) with a
                  cost-aware trading environment.
``pipeline``      End-to-end real-data research pipeline producing a JSON
                  research report.

The FastAPI ETL microservice that serves the Next.js app lives in the
sibling ``project/api`` package; it consumes the same providers.
"""

__version__ = "1.0.0"

__all__ = [
    "config",
    "data_sources",
    "timeseries",
    "portfolio",
    "metrics",
    "backtest",
    "rl",
    "pipeline",
]
