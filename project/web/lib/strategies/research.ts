/**
 * Strategy research library
 * =========================
 * The methodology behind every strategy in the registry, with the academic
 * and practitioner sources each one is based on.
 *
 * The same content is rendered on `/dashboard/research` and mirrored in
 * `docs/RESEARCH-LIBRARY.md` — keep the two in sync when a strategy changes.
 */

export interface StrategyReference {
  /** Full citation, e.g. "Piotroski, J. (2000) Journal of Accounting Research 38(1)." */
  citation: string;
  /** Optional link to the source. */
  url?: string;
}

export interface StrategyResearch {
  /** Registry slug this entry documents. */
  slug: string;
  /** One-paragraph description of what the strategy measures. */
  methodology: string;
  /** The academic / practitioner sources behind it. */
  references: StrategyReference[];
  /** Known limitations of the implementation. */
  caveats: string[];
}

export const STRATEGY_RESEARCH: StrategyResearch[] = [
  {
    slug: "piotroski-fscore-dupont",
    methodology:
      "Nine binary tests split into profitability (ROA > 0, CFO > 0, ΔROA > 0, CFO > ROA), leverage and liquidity (Δleverage < 0, Δcurrent ratio > 0) and operating efficiency (Δshares issued ≤ 0, Δgross margin > 0, Δasset turnover > 0). A DuPont overlay decomposes return on equity into margin, turnover and leverage so a high ROE driven by leverage is not mistaken for a high ROE driven by profitability.",
    references: [
      { citation: "Piotroski, J. (2000) 'Value Investing: The Use of Historical Financial Statement Information to Separate Winners from Losers', Journal of Accounting Research 38(1)." },
      { citation: "DuPont, E. (1914) 'The Story of the Great American Fortunes', Moody's Magazine." },
    ],
    caveats: [
      "The F-Score is computed on annual (Q4) data; interim quarters are scored on a trailing basis.",
      "Signals are only as timely as the reporting lag — 45 days are allowed before a quarter is tradable.",
    ],
  },
  {
    slug: "altman-zscore",
    methodology:
      "Altman's original five-factor discriminant model: Z = 1.2·X1 + 1.4·X2 + 3.3·X3 + 0.6·X4 + 1.0·X5, combining working capital, retained earnings, EBIT, equity-to-liabilities and sales-to-assets. The classic manufacturing coefficients are used, and the score is mapped onto the safe / grey / distress zones.",
    references: [
      { citation: "Altman, E. (1968) 'Financial Ratios, Discriminant Analysis and the Prediction of Bankruptcy', Journal of Finance 23(4)." },
      { citation: "Altman, E. (2005) 'The Private Firm Model for Credit Scoring', working paper (Z′-Score for non-manufacturers)." },
    ],
    caveats: [
      "The original coefficients are calibrated on 1960s manufacturers — the Z′-Score variants for private and non-manufacturing firms are not implemented.",
      "The equity term uses book equity, not market capitalisation, because market caps are only available for tracked companies.",
    ],
  },
  {
    slug: "beneish-mscore",
    methodology:
      "Beneish's eight-variable earnings-manipulation model (DSRI, GMI, AQI, SGI, DEPI, SGAI, LVGI, TATA) combined with the 1999 coefficients into the M-Score. A score above −1.78 flags a likely manipulator; the components are reported individually so the reason for the flag is visible.",
    references: [
      { citation: "Beneish, M. (1999) 'The Detection of Earnings Manipulation', Financial Analysts Journal 55(2)." },
    ],
    caveats: [
      "The model is designed for annual filings; quarterly inputs are annualised where the model requires it.",
      "M-Score is a screening tool, not proof of manipulation.",
    ],
  },
  {
    slug: "fama-french-five-factor",
    methodology:
      "A scorecard for the five Fama–French factors — value (book/earnings), profitability (gross profitability), investment (asset growth), size and momentum. Each leg is scaled cross-sectionally, converted into a z-score and combined into a composite so a company can be compared on the same basis as the published factor portfolios.",
    references: [
      { citation: "Fama, E. & French, K. (2015) 'A Five-Factor Asset Pricing Model', Journal of Financial Economics 116(1)." },
      { citation: "Fama, E. & French, K. (1993) 'Common Risk Factors in the Returns on Stocks and Bonds', Journal of Financial Economics 33(1)." },
    ],
    caveats: [
      "Factor returns cannot be replicated exactly without CRSP/Compustat factor portfolios — the scorecard is a proxy, not a factor regression.",
      "Size and momentum legs need a price history; they are skipped when the required history is missing.",
    ],
  },
  {
    slug: "quality-minus-junk",
    methodology:
      "The Quality Minus Junk (QMJ) factor: a z-scored composite of profitability, growth, safety and payout, minus a 'junk' composite of low profitability and low payout. The spread is the sign of the factor; the score reports both legs and the spread.",
    references: [
      { citation: "Asness, C., Frazzini, A. & Pedersen, L. (2019) 'Quality Minus Junk', Review of Financial Studies 32(2)." },
      { citation: "Asness, C., Moskowitz, T. & Pedersen, L. (2013) 'Value and Momentum Everywhere', Journal of Finance 68(3)." },
    ],
    caveats: [
      "Paydown and accrual measures need several quarters of history; the score is marked as insufficient data until then.",
    ],
  },
  {
    slug: "magic-formula",
    methodology:
      "Greenblatt's Magic Formula ranks a universe twice — once by return on capital (EBIT / invested capital) and once by earnings yield (EBIT / enterprise value) — and buys the names with the lowest combined rank. The implementation ranks within the tracked universe and reports both legs plus the combined rank.",
    references: [
      { citation: "Greenblatt, J. (2006) 'You Can Be a Stock Market Genius', McGraw-Hill." },
      { citation: "Novy-Marx, R. (2013) 'The Other Side of Value: The Gross Profitability Premium', Journal of Financial Economics 108(1)." },
    ],
    caveats: [
      "The strategy needs a full universe to rank within — a single-company run only shows the company's own ratios.",
      "Enterprise value uses book debt and cash, so off-balance-sheet leverage is not captured.",
    ],
  },
  {
    slug: "graham-defensive-investor",
    methodology:
      "Benjamin Graham's seven defensive-investor criteria: adequate size, strong financial condition (current ratio ≥ 2), long-term earnings stability (positive earnings in each of the past 10 years), dividend record (uninterrupted payments), moderate P/E (≤ 15), moderate P/B (≤ 1.5) and margin of safety. Each criterion is reported separately and the score is the number met.",
    references: [
      { citation: "Graham, B. (1973) 'The Intelligent Investor', 4th ed., Harper & Row." },
      { citation: "Graham, B. & Dodd, D. (1934) 'Security Analysis', McGraw-Hill." },
    ],
    caveats: [
      "The ten-year earnings-stability test needs a decade of filings; the criterion is skipped when the history is shorter.",
      "Graham's criteria were written for the 1970s market; they are a discipline, not a timing system.",
    ],
  },
  {
    slug: "momentum-12-1",
    methodology:
      "Intermediate-horizon price momentum: the return over the formation window excluding the most recent period (the 12−1 rule) plus a short-term reversal filter, scaled by realised volatility and checked against an earnings-quality proxy (margin expansion) so that 'frog-in-the-pan' momentum is penalised.",
    references: [
      { citation: "Jegadeesh, N. & Titman, S. (1993) 'Returns to Buying Winners and Selling Losers', Journal of Finance 48(1)." },
      { citation: "Carhart, M. (1997) 'On Persistence in Mutual Fund Performance', Journal of Finance 52(1)." },
      { citation: "Moskowitz, T., Ooi, Y. & Pedersen, L. (2012) 'Time Series Momentum', Journal of Financial Economics 104(2)." },
      { citation: "Da, Z., Gurun, U. & Warachka, B. (2014) 'Frog in the Pan: Continuous Information and Momentum', Review of Financial Studies 27(9)." },
    ],
    caveats: [
      "The engine works from quarterly close prices stored on the fact table — a documented approximation of the monthly series used in the papers.",
      "Momentum crashes in reversals are not modelled; the reversal filter reduces but does not remove them.",
    ],
  },
  {
    slug: "dcf-valuation",
    methodology:
      "A five-year FCFF discounted cash flow: FCFF = EBIT·(1−t) + D&A − CapEx − ΔNWC, discounted at a CAPM-based WACC (Ke = Rf + β·ERP, plus a country risk premium), with a Gordon-growth terminal value. The score is the implied upside to intrinsic value, penalised when the terminal value dominates enterprise value.",
    references: [
      { citation: "Damodaran, A. (2012) 'Investment Valuation', 3rd ed., Wiley." },
      { citation: "Koller, T., Goedhart, M. & Wessels, D. (2020) 'Valuation', 7th ed., Wiley." },
    ],
    caveats: [
      "The forecast is driven by user-set assumptions — the output is a scenario, not a fair-value estimate.",
      "Sensitivity is reported because small changes in WACC or terminal growth move the result a lot.",
    ],
  },
];

const BY_SLUG = new Map(STRATEGY_RESEARCH.map((r) => [r.slug, r]));

export function getStrategyResearch(slug: string): StrategyResearch | undefined {
  return BY_SLUG.get(slug);
}
