"""
Deterministic mock financial data generator.
Uses a seeded PRNG so the same ticker always yields the same quarterly history.
This is the default provider – no external API keys required.
"""
from __future__ import annotations
import math
from datetime import date, timedelta
from typing import Any

class MockProvider:
    name = "MOCK"

    def _seed(self, ticker: str) -> int:
        h = 0
        for ch in (ticker + ":fin"):
            h = (31 * h + ord(ch)) & 0xFFFFFFFF
        return h

    def _rng(self, seed: int):
        """Mulberry32 PRNG – same output as the TypeScript version in web/lib/mock-data.ts"""
        s = seed
        def rand():
            nonlocal s
            s = (s + 0x6D2B79F5) & 0xFFFFFFFF
            t = (s ^ (s >> 15)) & 0xFFFFFFFF
            t = (t * (1 | s)) & 0xFFFFFFFF
            t = (t ^ (t >> 7)) & 0xFFFFFFFF
            t = (t * (61 | t)) & 0xFFFFFFFF
            t = (t ^ t >> 14) & 0xFFFFFFFF
            return t / 4294967296
        return rand

    def _quarter_end(self, year: int, quarter: int) -> date:
        month = quarter * 3
        # last day of that month
        next_month = date(year, month, 1) + timedelta(days=32)
        return date(next_month.year, next_month.month, 1) - timedelta(days=1)

    def fetch_quarters(self, ticker: str, count: int = 12) -> list[dict[str, Any]]:
        rnd = self._rng(self._seed(ticker))

        today = date.today()
        cur_year = today.year
        cur_q = (today.month - 1) // 3 + 1

        # walk back `count` quarters from today to find start
        for _ in range(count):
            cur_q -= 1
            if cur_q == 0:
                cur_q = 4
                cur_year -= 1

        base_revenue  = 40_000_000 + rnd() * 200_000_000
        base_assets   = base_revenue * (1.6 + rnd() * 0.8)
        shares        = 20_000_000 + rnd() * 150_000_000
        cash          = base_assets * 0.12
        lt_debt       = base_assets * (0.15 + rnd() * 0.2)
        growth_drift  = 0.01 + rnd() * 0.025
        margin_base   = 0.08 + rnd() * 0.18

        quarters = []
        for i in range(count):
            cur_q += 1
            if cur_q > 4:
                cur_q = 1
                cur_year += 1

            noise       = (rnd() - 0.5) * 0.06
            rough       = -0.08 if rnd() < 0.12 else 0.0
            growth      = growth_drift + noise + rough

            base_revenue  = max(base_revenue * (1 + growth), 1_000_000)
            cos           = base_revenue * (0.45 + rnd() * 0.15)
            gp            = base_revenue - cos
            opex          = gp * (0.45 + rnd() * 0.2)
            op_inc        = gp - opex
            net_margin    = max(margin_base + noise, -0.05)
            net_inc       = base_revenue * net_margin
            ebitda        = op_inc * (1.15 + rnd() * 0.1)
            eps           = net_inc / shares

            base_assets   = base_assets * (1 + growth * 0.6)
            equity        = base_assets * (0.35 + rnd() * 0.15)
            liabilities   = base_assets - equity
            cur_assets    = base_assets * (0.3  + rnd() * 0.1)
            cur_liab      = liabilities * (0.35 + rnd() * 0.1)
            inventory     = cur_assets * (0.15 + rnd() * 0.1)
            receivables   = cur_assets * (0.2  + rnd() * 0.1)

            cash    = max(cash * (1 + growth * 0.4) + net_inc * 0.2, base_assets * 0.03)
            lt_debt = max(lt_debt * (1 + (rnd() - 0.55) * 0.08), 0)
            total_debt = lt_debt + cur_liab * 0.2

            ocf  = net_inc * (1.05 + rnd() * 0.25)
            capex = base_revenue * (0.03 + rnd() * 0.05)
            fcf  = ocf - capex
            divs = net_inc * (0.1 + rnd() * 0.2) if rnd() > 0.4 else 0.0
            shares = shares * (1 + rnd() * 0.01) if rnd() > 0.85 else shares

            price  = max(8 + rnd() * 180 + i * rnd() * 0.8, 0.5)
            volume = 200_000 + rnd() * 4_000_000

            # pre-compute ratio columns (the Transform step will redo these,
            # but having them here means MOCK runs without the Transform step)
            gm  = gp / base_revenue if base_revenue else None
            nm  = net_inc / base_revenue if base_revenue else None
            roa = net_inc / base_assets if base_assets else None
            roe = net_inc / equity if equity else None
            cr  = cur_assets / cur_liab if cur_liab else None

            quarters.append(dict(
                fiscal_year=cur_year,
                fiscal_quarter=cur_q,
                period_end_date=self._quarter_end(cur_year, cur_q).isoformat(),
                revenue=round(base_revenue, 2),
                cost_of_revenue=round(cos, 2),
                gross_profit=round(gp, 2),
                operating_expense=round(opex, 2),
                operating_income=round(op_inc, 2),
                net_income=round(net_inc, 2),
                ebitda=round(ebitda, 2),
                eps=round(eps, 4),
                shares_outstanding=round(shares, 2),
                total_assets=round(base_assets, 2),
                total_liabilities=round(liabilities, 2),
                total_equity=round(equity, 2),
                current_assets=round(cur_assets, 2),
                current_liabilities=round(cur_liab, 2),
                cash=round(cash, 2),
                total_debt=round(total_debt, 2),
                long_term_debt=round(lt_debt, 2),
                inventory=round(inventory, 2),
                receivables=round(receivables, 2),
                operating_cash_flow=round(ocf, 2),
                capex=round(capex, 2),
                free_cash_flow=round(fcf, 2),
                dividends_paid=round(divs, 2),
                close_price=round(price, 2),
                volume_avg=round(volume, 2),
                gross_margin=round(gm, 6) if gm is not None else None,
                operating_margin=round(op_inc / base_revenue, 6) if base_revenue else None,
                net_margin=round(nm, 6) if nm is not None else None,
                roa=round(roa, 6) if roa is not None else None,
                roe=round(roe, 6) if roe is not None else None,
                current_ratio=round(cr, 6) if cr is not None else None,
            ))

        return quarters

    def fetch_profile(self, ticker: str) -> dict[str, Any]:
        SECTOR_MAP = {
            0: ("Technology", "Software"),
            1: ("Healthcare", "Biotechnology"),
            2: ("Financials", "Banking"),
            3: ("Consumer Discretionary", "E-Commerce"),
            4: ("Industrials", "Logistics"),
            5: ("Energy", "Renewables"),
        }
        rnd = self._rng(self._seed(ticker + ":profile"))
        idx = int(rnd() * 6)
        sector, industry = SECTOR_MAP[idx]
        return dict(
            ticker=ticker,
            name=f"{ticker} Holdings Inc.",
            sector=sector,
            industry=industry,
            exchange="NASDAQ" if rnd() > 0.5 else "NYSE",
            country="US",
            description=f"{ticker} operates in the {industry} segment of the {sector} sector.",
            employee_count=int(500 + rnd() * 50_000),
        )
