"""
Financial Modeling Prep (FMP) provider stub.
Set MARKET_DATA_PROVIDER=FMP and FMP_API_KEY in api/.env to activate.
"""
from __future__ import annotations
from typing import Any
from .mock_provider import MockProvider

_mock = MockProvider()

class FMPProvider:
    name = "FMP"

    def fetch_quarters(self, ticker: str, count: int = 12) -> list[dict[str, Any]]:
        # TODO: https://financialmodelingprep.com/api/v3/income-statement/{ticker}?period=quarter&limit={count}&apikey=...
        print(f"[fmp] not yet implemented, falling back to mock for {ticker}")
        return _mock.fetch_quarters(ticker, count)

    def fetch_profile(self, ticker: str) -> dict[str, Any]:
        # TODO: https://financialmodelingprep.com/api/v3/profile/{ticker}?apikey=...
        print(f"[fmp] profile not implemented, falling back to mock for {ticker}")
        return _mock.fetch_profile(ticker)
