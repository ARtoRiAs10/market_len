"""
Alpha Vantage provider stub.
Set MARKET_DATA_PROVIDER=ALPHA_VANTAGE and ALPHA_VANTAGE_API_KEY in api/.env to activate.
Implement the TODOs to map Alpha Vantage quarterly JSON onto the common record shape.
"""
from __future__ import annotations
from typing import Any
from .mock_provider import MockProvider

_mock = MockProvider()

class AlphaVantageProvider:
    name = "ALPHA_VANTAGE"

    def fetch_quarters(self, ticker: str, count: int = 12) -> list[dict[str, Any]]:
        # TODO: call https://www.alphavantage.co/query?function=INCOME_STATEMENT&symbol={ticker}&apikey=...
        #       + BALANCE_SHEET + CASH_FLOW, zip quarterlyReports, map to common record shape
        print(f"[alpha_vantage] not yet implemented, falling back to mock for {ticker}")
        return _mock.fetch_quarters(ticker, count)

    def fetch_profile(self, ticker: str) -> dict[str, Any]:
        # TODO: https://www.alphavantage.co/query?function=OVERVIEW&symbol={ticker}&apikey=...
        print(f"[alpha_vantage] profile not implemented, falling back to mock for {ticker}")
        return _mock.fetch_profile(ticker)
