"""
Configuration for QuantLab.

Every value can be overridden with an environment variable so the lab can be
pointed at a different cache directory or API key without editing code.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

# ── Paths ────────────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parents[2]
CACHE_DIR = Path(os.getenv("QUANTLAB_CACHE_DIR", PROJECT_ROOT / "ml" / ".cache"))
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# ── HTTP ─────────────────────────────────────────────────────────────────────
USER_AGENT = os.getenv(
    "QUANTLAB_USER_AGENT",
    # SEC's bot filter rejects some User-Agent shapes (a URL inside the
    # string is a common trigger) — keep the "Name contact@domain" form.
    "MarketLens Research admin@marketlens.dev",
)
REQUEST_TIMEOUT = float(os.getenv("QUANTLAB_HTTP_TIMEOUT", "30"))
# SEC asks for <= 10 requests/second; we stay well below that.
REQUEST_DELAY_SECONDS = float(os.getenv("QUANTLAB_REQUEST_DELAY", "0.35"))

# ── Endpoints ────────────────────────────────────────────────────────────────
SEC_TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers.json"
SEC_COMPANY_FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
SEC_COMPANY_CONCEPT_URL = (
    "https://data.sec.gov/api/xbrl/companyconcept/CIK{cik}/{taxonomy}/{tag}.json"
)
NASDAQ_QUOTE_URL = "https://api.nasdaq.com/api/quote/{symbol}/info?assetclass=stocks"
NASDAQ_CHART_URL = (
    "https://api.nasdaq.com/api/quote/{symbol}/chart?assetclass=stocks"
    "&fromdate={start}&todate={end}"
)
NASDAQ_SCREENER_URL = "https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit={limit}"
NASDAQ_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nasdaq.com/",
}
YAHOO_CHART_URL = (
    "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
    "?range={range}&interval={interval}&includeAdjustedClose=true"
)
FRED_CSV_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}"
FRED_SERIES = {
    "DGS10": "10-Year Treasury Constant Maturity Rate (risk-free proxy)",
    "DGS3MO": "3-Month Treasury Bill Secondary Market Rate (cash proxy)",
    "T10Y2Y": "10Y minus 2Y Treasury spread (curve / recession signal)",
    "VIXCLS": "CBOE Volatility Index",
}

# ── Research defaults ────────────────────────────────────────────────────────
@dataclass(frozen=True)
class ResearchConfig:
    """Parameters used across the research pipeline."""

    risk_free_rate: float = float(os.getenv("QUANTLAB_RF", "0.042"))
    benchmark: str = os.getenv("QUANTLAB_BENCHMARK", "SPY")
    trading_days: int = 252
    transaction_cost_bps: float = float(os.getenv("QUANTLAB_COST_BPS", "10"))
    slippage_bps: float = float(os.getenv("QUANTLAB_SLIPPAGE_BPS", "5"))
    min_history_days: int = 120
    #: Universe of liquid large caps used when no explicit universe is given.
    default_universe: tuple[str, ...] = field(
        default_factory=lambda: (
            "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "BRK-B",
            "JPM", "V", "UNH", "XOM", "JNJ", "WMT", "PG", "MA", "HD", "CVX",
            "ABBV", "PEP", "KO", "MRK", "ADBE", "CRM", "AMD", "NFLX", "COST",
            "ORCL", "BAC", "TMO",
        )
    )


CONFIG = ResearchConfig()

#: Convenience alias used across the notebooks.
TICKER_TO_CIK_CACHE = CACHE_DIR / "sec_ticker_to_cik.json"
