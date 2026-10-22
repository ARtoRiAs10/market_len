# MarketLens Research Library

Every score in MarketLens is a published model. This document records what each
strategy measures, the academic and practitioner sources it is based on, and the
caveats you should keep in mind when using it.

The same content is rendered in-app on `/dashboard/research`; the structured
version lives in `lib/strategies/research.ts`.

---

## Fundamental quality & credit

### Piotroski F-Score + DuPont Quality Screen
*Slug: `piotroski-fscore-dupont` · Category: Fundamental Quality*

**Methodology.** Nine binary tests split into profitability (ROA > 0, CFO > 0,
ΔROA > 0, CFO > ROA), leverage and liquidity (Δleverage < 0, Δcurrent ratio > 0)
and operating efficiency (Δshares issued ≤ 0, Δgross margin > 0, Δasset turnover
> 0). A DuPont overlay decomposes return on equity into margin, turnover and
leverage so a high ROE driven by leverage is not mistaken for a high ROE driven
by profitability.

**Sources**
- Piotroski, J. (2000) "Value Investing: The Use of Historical Financial Statement Information to Separate Winners from Losers", *Journal of Accounting Research* 38(1).
- DuPont, E. (1914) "The Story of the Great American Fortunes", *Moody's Magazine*.

**Caveats**
- The F-Score is computed on annual (Q4) data; interim quarters are scored on a trailing basis.
- Signals are only as timely as the reporting lag — 45 days are allowed before a quarter is tradable.

### Altman Z-Score
*Slug: `altman-zscore` · Category: Credit Risk*

**Methodology.** Altman's original five-factor discriminant model:
Z = 1.2·X1 + 1.4·X2 + 3.3·X3 + 0.6·X4 + 1.0·X5, combining working capital,
retained earnings, EBIT, equity-to-liabilities and sales-to-assets. The classic
manufacturing coefficients are used, and the score is mapped onto the safe / grey
/ distress zones.

**Sources**
- Altman, E. (1968) "Financial Ratios, Discriminant Analysis and the Prediction of Bankruptcy", *Journal of Finance* 23(4).
- Altman, E. (2005) "The Private Firm Model for Credit Scoring", working paper (Z′-Score for non-manufacturers).

**Caveats**
- The original coefficients are calibrated on 1960s manufacturers — the Z′-Score variants for private and non-manufacturing firms are not implemented.
- The equity term uses book equity, not market capitalisation, because market caps are only available for tracked companies.

### Beneish M-Score
*Slug: `beneish-mscore` · Category: Forensic Accounting*

**Methodology.** Beneish's eight-variable earnings-manipulation model (DSRI,
GMI, AQI, SGI, DEPI, SGAI, LVGI, TATA) combined with the 1999 coefficients into
the M-Score. A score above −1.78 flags a likely manipulator; the components are
reported individually so the reason for the flag is visible.

**Sources**
- Beneish, M. (1999) "The Detection of Earnings Manipulation", *Financial Analysts Journal* 55(2).

**Caveats**
- The model is designed for annual filings; quarterly inputs are annualised where the model requires it.
- M-Score is a screening tool, not proof of manipulation.

---

## Factor models

### Fama–French 5-Factor Scorecard
*Slug: `fama-french-five-factor` · Category: Factor Models*

**Methodology.** A scorecard for the five Fama–French factors — value
(book/earnings), profitability (gross profitability), investment (asset growth),
size and momentum. Each leg is scaled cross-sectionally, converted into a
z-score and combined into a composite so a company can be compared on the same
basis as the published factor portfolios.

**Sources**
- Fama, E. & French, K. (2015) "A Five-Factor Asset Pricing Model", *Journal of Financial Economics* 116(1).
- Fama, E. & French, K. (1993) "Common Risk Factors in the Returns on Stocks and Bonds", *Journal of Financial Economics* 33(1).

**Caveats**
- Factor returns cannot be replicated exactly without CRSP/Compustat factor portfolios — the scorecard is a proxy, not a factor regression.
- Size and momentum legs need a price history; they are skipped when the required history is missing.

### Quality Minus Junk (QMJ)
*Slug: `quality-minus-junk` · Category: Factor Models*

**Methodology.** The Quality Minus Junk factor: a z-scored composite of
profitability, growth, safety and payout, minus a "junk" composite of low
profitability and low payout. The spread is the sign of the factor; the score
reports both legs and the spread.

**Sources**
- Asness, C., Frazzini, A. & Pedersen, L. (2019) "Quality Minus Junk", *Review of Financial Studies* 32(2).
- Asness, C., Moskowitz, T. & Pedersen, L. (2013) "Value and Momentum Everywhere", *Journal of Finance* 68(3).

**Caveats**
- Paydown and accrual measures need several quarters of history; the score is marked as insufficient data until then.

---

## Value & momentum

### The Magic Formula
*Slug: `magic-formula` · Category: Value & Momentum*

**Methodology.** Greenblatt's Magic Formula ranks a universe twice — once by
return on capital (EBIT / invested capital) and once by earnings yield (EBIT /
enterprise value) — and buys the names with the lowest combined rank. The
implementation ranks within the tracked universe and reports both legs plus the
combined rank.

**Sources**
- Greenblatt, J. (2006) "You Can Be a Stock Market Genius", McGraw-Hill.
- Novy-Marx, R. (2013) "The Other Side of Value: The Gross Profitability Premium", *Journal of Financial Economics* 108(1).

**Caveats**
- The strategy needs a full universe to rank within — a single-company run only shows the company's own ratios.
- Enterprise value uses book debt and cash, so off-balance-sheet leverage is not captured.

### Graham Defensive Investor Checklist
*Slug: `graham-defensive-investor` · Category: Value & Momentum*

**Methodology.** Benjamin Graham's seven defensive-investor criteria: adequate
size, strong financial condition (current ratio ≥ 2), long-term earnings
stability (positive earnings in each of the past 10 years), dividend record
(uninterrupted payments), moderate P/E (≤ 15), moderate P/B (≤ 1.5) and margin
of safety. Each criterion is reported separately and the score is the number met.

**Sources**
- Graham, B. (1973) "The Intelligent Investor", 4th ed., Harper & Row.
- Graham, B. & Dodd, D. (1934) "Security Analysis", McGraw-Hill.

**Caveats**
- The ten-year earnings-stability test needs a decade of filings; the criterion is skipped when the history is shorter.
- Graham's criteria were written for the 1970s market; they are a discipline, not a timing system.

### 12−1 Month Momentum
*Slug: `momentum-12-1` · Category: Value & Momentum*

**Methodology.** Intermediate-horizon price momentum: the return over the
formation window excluding the most recent period (the 12−1 rule) plus a
short-term reversal filter, scaled by realised volatility and checked against an
earnings-quality proxy (margin expansion) so that "frog-in-the-pan" momentum is
penalised.

**Sources**
- Jegadeesh, N. & Titman, S. (1993) "Returns to Buying Winners and Selling Losers", *Journal of Finance* 48(1).
- Carhart, M. (1997) "On Persistence in Mutual Fund Performance", *Journal of Finance* 52(1).
- Moskowitz, T., Ooi, Y. & Pedersen, L. (2012) "Time Series Momentum", *Journal of Financial Economics* 104(2).
- Da, Z., Gurun, U. & Warachka, B. (2014) "Frog in the Pan: Continuous Information and Momentum", *Review of Financial Studies* 27(9).

**Caveats**
- The engine works from quarterly close prices stored on the fact table — a documented approximation of the monthly series used in the papers.
- Momentum crashes in reversals are not modelled; the reversal filter reduces but does not remove them.

---

## Valuation

### Discounted Cash Flow (FCFF) Valuation
*Slug: `dcf-valuation` · Category: Valuation*

**Methodology.** A five-year FCFF discounted cash flow:
FCFF = EBIT·(1−t) + D&A − CapEx − ΔNWC, discounted at a CAPM-based WACC
(Ke = Rf + β·ERP, plus a country risk premium), with a Gordon-growth terminal
value. The score is the implied upside to intrinsic value, penalised when the
terminal value dominates enterprise value.

**Sources**
- Damodaran, A. (2012) "Investment Valuation", 3rd ed., Wiley.
- Koller, T., Goedhart, M. & Wessels, D. (2020) "Valuation", 7th ed., Wiley.

**Caveats**
- The forecast is driven by user-set assumptions — the output is a scenario, not a fair-value estimate.
- Sensitivity is reported because small changes in WACC or terminal growth move the result a lot.

---

## Portfolio & risk analytics

These live outside the strategy registry but follow the same discipline — the
source is named in the code and the limitation is surfaced in the UI.

| Module | What it does | Sources |
|---|---|---|
| `lib/quant/risk.ts` | Volatility, drawdown, VaR/CVaR, beta/alpha with Newey–West t-stats, deflated Sharpe, block-bootstrap Sharpe CI | Lo (2002); Rockafellar & Uryasev (2002); Bailey & López de Prado (2014); Politis & White (2004) |
| `lib/quant/attribution.ts` | Multi-period Brinson–Fachler attribution with Carino linking | Brinson, Hood & Beebower (1990); Carino (1999) |
| `lib/quant/optimizer.ts` | Constrained mean–variance, risk parity, Black–Litterman, min-CVaR, efficient frontier | Markowitz (1952); Maillard et al. (2010); Black & Litterman (1990); Rockafellar & Uryasev (2002) |
| `lib/quant/valuation.ts` | FCFF DCF, WACC build-up, terminal value and sensitivity | Damodaran (2012); Koller et al. (2020) |
| `lib/quant/stats.ts` | OLS with HAC standard errors, Ledoit–Wolf covariance, deflated Sharpe | Ledoit & Wolf (2004); Newey & West (1987) |
| `lib/quant/backtest.ts` | Quarterly walk-forward backtester with transaction costs and lagging | Piotroski (2000); Bailey et al. (2014) |
| `project/ml/quantlab` | Research lab: ADF/KPSS, GARCH, ARIMA, Hurst, variance ratios, RL portfolio agents | Dickey & Fuller (1979); Bollerslev (1986); Box & Jenkins (2015); Lo (1991) |
