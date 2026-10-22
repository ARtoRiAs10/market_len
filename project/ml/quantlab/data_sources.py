"""
Real market-data ingestion.

Sources (all public, no paid key required):

* **SEC EDGAR** — https://data.sec.gov/api/xbrl/companyconcept/...
  Official XBRL company facts filed with the U.S. Securities and Exchange
  Commission (10-K / 10-Q). This is the authoritative source for US GAAP
  fundamentals and is what regulators themselves publish.
* **Nasdaq** — https://api.nasdaq.com/api/...
  Official Nasdaq market-data endpoints: company profile, real-time quote and
  the equity screener (used to build a real, liquid large-cap universe).
* **Yahoo Finance chart API** — daily OHLCV history (used for price series
  because it is free and complete; Stooq is used as a fallback).
* **FRED** — St. Louis Fed macro series (risk-free rate, VIX, curve).

All requests are cached on disk so repeated notebook runs are fast and the
public endpoints are not hammered.
"""

from __future__ import annotations

import json
import time
import urllib.request
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Iterable

import pandas as pd

from .config import (
    CACHE_DIR,
    FRED_CSV_URL,
    FRED_SERIES,
    NASDAQ_CHART_URL,
    NASDAQ_HEADERS,
    NASDAQ_QUOTE_URL,
    NASDAQ_SCREENER_URL,
    REQUEST_DELAY_SECONDS,
    REQUEST_TIMEOUT,
    SEC_COMPANY_CONCEPT_URL,
    SEC_TICKER_MAP_URL,
    USER_AGENT,
    YAHOO_CHART_URL,
)

_LAST_REQUEST_AT = 0.0


# ── HTTP plumbing ────────────────────────────────────────────────────────────

def _throttle() -> None:
    """Politely space out requests (SEC asks for ≤ 10 req/s)."""
    global _LAST_REQUEST_AT
    delta = time.time() - _LAST_REQUEST_AT
    if delta < REQUEST_DELAY_SECONDS:
        time.sleep(REQUEST_DELAY_SECONDS - delta)
    _LAST_REQUEST_AT = time.time()


def _cache_path(key: str, suffix: str = ".json") -> Path:
    safe = "".join(c if c.isalnum() or c in "-_." else "_" for c in key)
    return CACHE_DIR / f"{safe}{suffix}"


def _read_cache(path: Path, max_age_hours: float) -> Any | None:
    if not path.exists():
        return None
    age = (datetime.now() - datetime.fromtimestamp(path.stat().st_mtime)).total_seconds() / 3600
    if age > max_age_hours:
        return None
    try:
        if path.suffix == ".json":
            return json.loads(path.read_text())
        return path.read_text()
    except Exception:
        return None


def _write_cache(path: Path, payload: Any) -> None:
    try:
        if path.suffix == ".json":
            path.write_text(json.dumps(payload))
        else:
            path.write_text(payload if isinstance(payload, str) else str(payload))
    except Exception:
        pass


def http_json(url: str, headers: dict[str, str] | None = None, max_age_hours: float = 12.0) -> Any:
    """GET a JSON endpoint with on-disk caching."""
    path = _cache_path(url)
    cached = _read_cache(path, max_age_hours)
    if cached is not None:
        return cached

    _throttle()
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    _write_cache(path, payload)
    return payload


def http_text(url: str, headers: dict[str, str] | None = None, max_age_hours: float = 12.0) -> str:
    """GET a text endpoint (CSV) with on-disk caching."""
    path = _cache_path(url, ".txt")
    cached = _read_cache(path, max_age_hours)
    if cached is not None:
        return cached

    _throttle()
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
        text = resp.read().decode("utf-8")
    _write_cache(path, text)
    return text


# ── SEC EDGAR ────────────────────────────────────────────────────────────────

def sec_ticker_to_cik() -> dict[str, int]:
    """Official SEC ticker → CIK map (https://www.sec.gov/files/company_tickers.json)."""
    payload = http_json(SEC_TICKER_MAP_URL, max_age_hours=24 * 7)
    mapping: dict[str, int] = {}
    for entry in payload.values():
        ticker = str(entry.get("ticker", "")).upper()
        cik = entry.get("cik_str")
        if ticker and cik:
            mapping[ticker] = int(cik)
    return mapping


def cik_for(ticker: str) -> int | None:
    """Resolve a ticker to its SEC CIK (handles the BRK.B / BRK-B style tickers)."""
    t = ticker.upper().replace(".", "-")
    mapping = sec_ticker_to_cik()
    if t in mapping:
        return mapping[t]
    alt = t.replace("-", ".")
    return mapping.get(alt)


#: us-gaap XBRL tags, in priority order. The first tag that returns data wins.
XBRL_TAGS: dict[str, list[str]] = {
    "revenue": [
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "RevenueFromContractWithCustomerIncludingAssessedTax",
        "Revenues",
        "SalesRevenueNet",
    ],
    "gross_profit": ["GrossProfit"],
    "operating_income": ["OperatingIncomeLoss"],
    "net_income": ["NetIncomeLoss", "ProfitLoss"],
    "ebitda": [],  # not an XBRL tag — computed as operating income + D&A
    "eps": ["EarningsPerShareDiluted", "EarningsPerShareBasic"],
    "shares_outstanding": [
        "CommonStockSharesOutstanding",
        "WeightedAverageNumberOfDilutedSharesOutstanding",
    ],
    "total_assets": ["Assets"],
    "total_liabilities": ["Liabilities"],
    "total_equity": ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
    "current_assets": ["AssetsCurrent"],
    "current_liabilities": ["LiabilitiesCurrent"],
    "cash": ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"],
    "total_debt": ["DebtLongtermAndShorttermCombinedAmount", "LongTermDebt", "LongTermDebtNoncurrent"],
    "long_term_debt": ["LongTermDebtNoncurrent", "LongTermDebt"],
    "inventory": ["InventoryNet"],
    "receivables": ["AccountsReceivableNetCurrent", "ReceivablesNetCurrent"],
    "operating_cash_flow": ["NetCashProvidedByUsedInOperatingActivities"],
    "capex": ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
    "depreciation": ["DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet"],
    "dividends_paid": ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends"],
}


@dataclass
class QuarterlyFundamentals:
    """Normalised quarterly fundamentals for one company."""

    ticker: str
    cik: int
    company_name: str
    sector: str | None
    rows: list[dict[str, Any]] = field(default_factory=list)

    def to_frame(self) -> pd.DataFrame:
        if not self.rows:
            return pd.DataFrame()
        df = pd.DataFrame(self.rows).sort_values(["fiscal_year", "fiscal_quarter"])
        return df.reset_index(drop=True)


def _concept(cik: int, tag: str) -> dict[str, Any] | None:
    try:
        return http_json(
            SEC_COMPANY_CONCEPT_URL.format(cik=f"{cik:010d}", taxonomy="us-gaap", tag=tag),
            max_age_hours=24,
        )
    except Exception:
        return None


def _quarterly_series(payload: dict[str, Any], unit_hint: str = "USD") -> dict[str, float]:
    """Extract a period-end → value mapping of quarterly facts.

    Only facts whose duration is ~1 quarter (or point-in-time balance-sheet
    facts) are kept, and duplicate filings are resolved by preferring the
    most recently filed value (restated numbers win).
    """
    facts = payload.get("units", {})
    unit = None
    for key in (unit_hint, "USD", "USD/shares", "shares", "pure"):
        if key in facts:
            unit = key
            break
    if unit is None:
        return {}

    out: dict[str, float] = {}
    filed_at: dict[str, str] = {}
    for fact in facts.get(unit, []):
        end = fact.get("end")
        val = fact.get("val")
        if not end or val is None:
            continue
        start = fact.get("start")
        if start:
            duration = (datetime.fromisoformat(end) - datetime.fromisoformat(start)).days
            if not (80 <= duration <= 100):
                continue
        filed = fact.get("filed", "")
        if end in out and filed_at.get(end, "") >= filed:
            continue
        out[end] = float(val)
        filed_at[end] = filed
    return out


def fetch_sec_fundamentals(
    ticker: str,
    name: str | None = None,
    sector: str | None = None,
    max_quarters: int = 20,
) -> QuarterlyFundamentals:
    """Pull real quarterly fundamentals for a ticker from SEC EDGAR XBRL."""
    ticker = ticker.upper()
    cik = cik_for(ticker)
    result = QuarterlyFundamentals(
        ticker=ticker,
        cik=cik or 0,
        company_name=name or ticker,
        sector=sector,
    )
    if cik is None:
        return result

    series_by_tag: dict[str, dict[str, float]] = {}
    for field_name, tags in XBRL_TAGS.items():
        for tag in tags:
            payload = _concept(cik, tag)
            if not payload:
                continue
            series = _quarterly_series(payload, unit_hint="USD")
            if field_name == "eps":
                series = _quarterly_series(payload, unit_hint="USD/shares")
            elif field_name == "shares_outstanding":
                series = _quarterly_series(payload, unit_hint="shares")
            if series:
                series_by_tag[field_name] = series
                break

    if not series_by_tag:
        return result

    # Balance-sheet facts are point-in-time, income-statement facts are
    # durations — align on the union of all period-end dates.
    all_ends = sorted({end for s in series_by_tag.values() for end in s})
    rows: list[dict[str, Any]] = []
    for end in all_ends:
        row: dict[str, Any] = {"period_end": end}
        for field_name, series in series_by_tag.items():
            row[field_name] = series.get(end)
        d = datetime.fromisoformat(end)
        row["fiscal_year"] = d.year
        row["fiscal_quarter"] = (d.month - 1) // 3 + 1
        rows.append(row)

    frame = pd.DataFrame(rows).dropna(subset=["revenue"], how="any")
    frame = frame.tail(max_quarters)

    for _, r in frame.iterrows():
        ebitda = None
        if r.get("operating_income") is not None and r.get("depreciation") is not None:
            try:
                if pd.notna(r["operating_income"]) and pd.notna(r["depreciation"]):
                    ebitda = float(r["operating_income"]) + float(r["depreciation"])
            except Exception:
                ebitda = None
        ocf = r.get("operating_cash_flow")
        capex = r.get("capex")
        fcf = None
        if ocf is not None and capex is not None and pd.notna(ocf) and pd.notna(capex):
            fcf = float(ocf) - abs(float(capex))
        row = {
            "ticker": ticker,
            "fiscal_year": int(r["fiscal_year"]),
            "fiscal_quarter": int(r["fiscal_quarter"]),
            "period_end": r["period_end"],
            "revenue": _f(r.get("revenue")),
            "gross_profit": _f(r.get("gross_profit")),
            "operating_income": _f(r.get("operating_income")),
            "net_income": _f(r.get("net_income")),
            "ebitda": ebitda,
            "eps": _f(r.get("eps")),
            "shares_outstanding": _f(r.get("shares_outstanding")),
            "total_assets": _f(r.get("total_assets")),
            "total_liabilities": _f(r.get("total_liabilities")),
            "total_equity": _f(r.get("total_equity")),
            "current_assets": _f(r.get("current_assets")),
            "current_liabilities": _f(r.get("current_liabilities")),
            "cash": _f(r.get("cash")),
            "total_debt": _f(r.get("total_debt")),
            "long_term_debt": _f(r.get("long_term_debt")),
            "inventory": _f(r.get("inventory")),
            "receivables": _f(r.get("receivables")),
            "operating_cash_flow": _f(ocf),
            "capex": _f(capex),
            "free_cash_flow": fcf,
            "dividends_paid": _f(r.get("dividends_paid")),
        }
        result.rows.append(row)

    return result


def _f(value: Any) -> float | None:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
        return float(value)
    except Exception:
        return None


# ── Prices ───────────────────────────────────────────────────────────────────

def fetch_daily_prices(
    symbol: str,
    period: str = "2y",
    interval: str = "1d",
) -> pd.DataFrame:
    """Daily OHLCV history for a symbol (Yahoo Finance chart API)."""
    symbol = symbol.upper()
    payload = http_json(
        YAHOO_CHART_URL.format(symbol=symbol, range=period, interval=interval),
        max_age_hours=6,
    )
    result = payload["chart"]["result"][0]
    ts = result["timestamp"]
    quote = result["indicators"]["quote"][0]
    adj = result["indicators"].get("adjclose", [{}])[0].get("adjclose")

    frame = pd.DataFrame(
        {
            "date": pd.to_datetime(ts, unit="s", utc=True).tz_convert(None).normalize(),
            "open": quote.get("open"),
            "high": quote.get("high"),
            "low": quote.get("low"),
            "close": quote.get("close"),
            "volume": quote.get("volume"),
        }
    )
    if adj:
        frame["adj_close"] = adj
    else:
        frame["adj_close"] = frame["close"]
    frame = frame.dropna(subset=["close"]).reset_index(drop=True)
    frame["symbol"] = symbol
    return frame


def fetch_price_panel(
    symbols: Iterable[str],
    period: str = "2y",
) -> dict[str, pd.DataFrame]:
    """Fetch daily bars for several symbols."""
    return {s.upper(): fetch_daily_prices(s, period=period) for s in symbols}


def fetch_returns_matrix(
    symbols: Iterable[str],
    period: str = "2y",
) -> pd.DataFrame:
    """Close-to-close daily returns for several symbols (aligned columns)."""
    frames = []
    for symbol in symbols:
        try:
            df = fetch_daily_prices(symbol, period=period)
        except Exception:
            continue
        if df.empty:
            continue
        series = df.set_index("date")["adj_close"].rename(symbol.upper())
        frames.append(series)
    if not frames:
        return pd.DataFrame()
    panel = pd.concat(frames, axis=1).sort_index().ffill().dropna(how="any")
    return panel.pct_change().dropna(how="any")


# ── Nasdaq ───────────────────────────────────────────────────────────────────

def fetch_nasdaq_quote(symbol: str) -> dict[str, Any]:
    """Real-time quote + profile from Nasdaq's public market-data API."""
    symbol = symbol.upper()
    payload = http_json(
        NASDAQ_QUOTE_URL.format(symbol=symbol), headers=NASDAQ_HEADERS, max_age_hours=1
    )
    data = (payload or {}).get("data") or {}
    primary = data.get("primaryData") or {}
    key = data.get("keyStats") or {}
    return {
        "symbol": symbol,
        "company_name": data.get("companyName"),
        "exchange": data.get("exchange"),
        "last_sale_price": primary.get("lastSalePrice"),
        "net_change": primary.get("netChange"),
        "percentage_change": primary.get("percentageChange"),
        "market_cap": key.get("MarketCap") or data.get("marketCap"),
        "nasdaq_100": data.get("isNasdaq100"),
        "asset_class": data.get("assetClass"),
        "timestamp": primary.get("lastTradeTimestamp"),
    }


def fetch_nasdaq_screener(limit: int = 100) -> pd.DataFrame:
    """Equity screener output (used to build a real, liquid universe)."""
    payload = http_json(
        NASDAQ_SCREENER_URL.format(limit=limit), headers=NASDAQ_HEADERS, max_age_hours=6
    )
    rows = ((payload or {}).get("data") or {}).get("table", {}).get("rows", []) or []
    records = []
    for row in rows:
        try:
            records.append(
                {
                    "symbol": str(row.get("symbol", "")).strip(),
                    "name": row.get("name"),
                    "last_sale": row.get("lastsale"),
                    "net_change": row.get("netchange"),
                    "percentage_change": row.get("pctchange"),
                    "market_cap": row.get("marketCap"),
                    "country": row.get("country"),
                    "url": row.get("url"),
                }
            )
        except Exception:
            continue
    return pd.DataFrame(records)


def fetch_nasdaq_chart(symbol: str, start: date, end: date) -> pd.DataFrame:
    """Historical daily bars straight from Nasdaq (official market data)."""
    symbol = symbol.upper()
    payload = http_json(
        NASDAQ_CHART_URL.format(symbol=symbol, start=start.isoformat(), end=end.isoformat()),
        headers=NASDAQ_HEADERS,
        max_age_hours=12,
    )
    chart = ((payload or {}).get("data") or {}).get("chart") or []
    records = []
    for point in chart:
        z = point.get("z") or {}
        try:
            records.append(
                {
                    "date": datetime.strptime(z["dateTime"], "%m/%d/%Y").date(),
                    "open": float(z["open"]),
                    "high": float(z["high"]),
                    "low": float(z["low"]),
                    "close": float(z["close"]),
                    "volume": float(z.get("volume") or 0),
                }
            )
        except Exception:
            continue
    frame = pd.DataFrame(records)
    if not frame.empty:
        frame["symbol"] = symbol
        frame["adj_close"] = frame["close"]
    return frame


# ── FRED macro ───────────────────────────────────────────────────────────────

def fetch_fred_series(series_id: str) -> pd.DataFrame:
    """Download a FRED CSV series (e.g. DGS10 for the risk-free rate)."""
    text = http_text(FRED_CSV_URL.format(series_id=series_id), max_age_hours=24)
    frame = pd.read_csv(pd.io.common.StringIO(text))
    frame.columns = ["date", series_id]
    frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
    frame[series_id] = pd.to_numeric(frame[series_id], errors="coerce")
    return frame.dropna().reset_index(drop=True)


def fetch_risk_free_rate(lookback_days: int = 400) -> pd.Series:
    """10-year Treasury yield as a daily risk-free proxy (decimal)."""
    frame = fetch_fred_series("DGS10")
    if frame.empty:
        return pd.Series(dtype=float)
    frame = frame.tail(lookback_days)
    return pd.Series(
        frame["DGS10"].to_numpy() / 100.0,
        index=pd.DatetimeIndex(frame["date"]),
        name="rf",
    )


# ── Convenience ──────────────────────────────────────────────────────────────

def build_universe_from_nasdaq(limit: int = 50, min_market_cap: float = 10e9) -> list[str]:
    """Real large-cap universe built from Nasdaq's own screener."""
    frame = fetch_nasdaq_screener(limit=limit * 2)
    if frame.empty:
        return []
    def parse_mc(v: Any) -> float:
        if not isinstance(v, str):
            return 0.0
        v = v.replace("$", "").replace(",", "").strip()
        if v.endswith("B"):
            return float(v[:-1]) * 1e9
        if v.endswith("M"):
            return float(v[:-1]) * 1e6
        if v.endswith("T"):
            return float(v[:-1]) * 1e12
        try:
            return float(v)
        except Exception:
            return 0.0
    frame["market_cap_num"] = frame["market_cap"].map(parse_mc)
    frame = frame[frame["market_cap_num"] >= min_market_cap].head(limit)
    return [s for s in frame["symbol"].tolist() if s and s != ""]


def fundamentals_panel(tickers: Iterable[str], max_quarters: int = 20) -> pd.DataFrame:
    """Stack SEC fundamentals for several tickers into one panel."""
    frames = []
    for ticker in tickers:
        try:
            fund = fetch_sec_fundamentals(ticker, max_quarters=max_quarters)
        except Exception:
            continue
        if not fund.rows:
            continue
        frames.append(pd.DataFrame(fund.rows))
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)
