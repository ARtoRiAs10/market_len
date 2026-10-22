# MarketLens v3 📊

> Full-stack financial analysis SaaS — Next.js 14, FastAPI, Neon Postgres, Stripe, OpenRouter AI.

---

## Quick Start

### Step 1 — Get external services ready (15 min)

| Service | What for | Free tier? |
|---------|---------|-----------|
| [Neon](https://console.neon.tech) | Serverless Postgres | ✅ Yes |
| [Stripe](https://dashboard.stripe.com) | Subscriptions | ✅ Test mode |
| [OpenRouter](https://openrouter.ai) | AI Analyst (200+ models) | ✅ Pay-per-use |
| [Resend](https://resend.com) | Weekly digest email | ✅ 3k/mo free |

---

## What's inside

### `project/web` — Next.js 14 app (App Router, Prisma, Tailwind, Recharts)

| Area | Highlights |
|---|---|
| **Strategies** | 9 registered engines — Piotroski F-Score + DuPont, Altman Z, Beneish M-Score, Fama–French 5-factor, Quality Minus Junk, Magic Formula, Graham Defensive, 12−1 Momentum, FCFF DCF. Add one in `lib/strategies/` and register it in `lib/strategies/registry.ts`. |
| **Research library** | `/dashboard/research` — the methodology, academic sources and caveats behind every strategy (`lib/strategies/research.ts`, mirrored in `project/web/docs/RESEARCH-LIBRARY.md`). |
| **Portfolios** | `/dashboard/portfolios` — holdings, allocation, sector exposure, risk contribution, correlation matrix, Brinson attribution, equity/drawdown curves, price sync and a constrained optimiser (max Sharpe, min-variance, risk parity, inverse vol, Black–Litterman) with the efficient frontier. |
| **Factor exposure** | `/dashboard/factors` — cross-sectional percentiles for value, profitability, investment, size, momentum, quality, accruals and low volatility. |
| **Backtesting** | Cost-aware walk-forward engine with a reporting lag, alpha/beta, deflated Sharpe probability and a block-bootstrap Sharpe CI. |
| **Quant engine** | `lib/quant/` — statistics (OLS/HAC, Ledoit–Wolf, deflated Sharpe), risk (VaR/CVaR, drawdown, beta/alpha), valuation (DCF), optimiser, factors, attribution, backtester. |
| **Data** | Pluggable providers (MOCK / Alpha Vantage / FMP) → `PriceBar` fact table → portfolios, strategies and risk analytics. |

### `project/api` — FastAPI ETL microservice

Extract → transform → validate → load pipeline with the same market-data
providers; the Next.js app drives it from `/dashboard/etl`.

### `project/ml` — QuantLab research lab

Stationarity/ARIMA/GARCH, Ledoit–Wolf mean–variance, risk parity,
Black–Litterman, min-CVaR, RL portfolio agents and a real-data research
pipeline. See `project/ml/README.md`.

### Deployment

`project/web` (Next.js) deploys to Vercel; `project/api` (FastAPI ETL) needs a
long-running Python host. Full walkthrough — database, environment variables,
Stripe webhooks, custom domain — in
[`project/web/docs/DEPLOYMENT.md`](project/web/docs/DEPLOYMENT.md).

---

## Development

```bash
# web
cd project/web
npm install
cp .env.example .env          # fill in DATABASE_URL, NEXTAUTH_SECRET, …
npx prisma db push
npm run db:seed               # users, companies, price bars, strategies, a demo portfolio
npm run dev

# quant engine smoke test (no database needed)
npm run smoke

# research lab
cd ../ml
pip install -r requirements.txt
python -m pytest tests -q
python -m quantlab.pipeline --tickers AAPL MSFT NVDA --period 3y
```
