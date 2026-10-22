import { DataSource } from "@prisma/client";

/**
 * Deterministic mock market-data generator.
 *
 * This is the default data source so the project runs end-to-end with zero
 * external API keys. Swap `MARKET_DATA_PROVIDER=ALPHA_VANTAGE` or `FMP` in
 * .env (plus an API key) to use lib/providers/* instead - see
 * lib/providers/index.ts for the pluggable interface this mirrors.
 */

export interface MockCompanyProfile {
  ticker: string;
  name: string;
  sector: string;
  industry: string;
  exchange: string;
  country: string;
  description: string;
  employeeCount: number;
}

const SECTORS = [
  { sector: "Technology", industries: ["Software", "Semiconductors", "Cloud Infrastructure"] },
  { sector: "Healthcare", industries: ["Biotechnology", "Medical Devices", "Pharmaceuticals"] },
  { sector: "Financials", industries: ["Banking", "Insurance", "Asset Management"] },
  { sector: "Consumer Discretionary", industries: ["E-Commerce", "Retail", "Automotive"] },
  { sector: "Industrials", industries: ["Aerospace", "Logistics", "Manufacturing"] },
  { sector: "Energy", industries: ["Oil & Gas", "Renewables", "Utilities"] },
];

const SEED_COMPANIES: { ticker: string; name: string }[] = [
  { ticker: "NEXG", name: "Nexgen Robotics Corp." },
  { ticker: "AURA", name: "Aurora Biosciences Inc." },
  { ticker: "VTLX", name: "Vertex Logistics Group" },
  { ticker: "FNCL", name: "Fincline Capital Holdings" },
  { ticker: "SOLR", name: "Solera Renewable Energy" },
  { ticker: "QTMC", name: "Quantum Cloud Systems" },
  { ticker: "MDFR", name: "Medifore Devices Ltd." },
  { ticker: "RTLX", name: "Retalix Commerce Co." },
  { ticker: "PXAI", name: "Praxis Industrial AI" },
  { ticker: "BNKW", name: "Bankwell Financial Group" },
];

// Simple seeded PRNG (mulberry32) so the same ticker always yields the same
// "history" — useful for demos and tests.
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStringToSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(31, h) + s.charCodeAt(i);
  }
  return h >>> 0;
}

export function getSeedCompanyList() {
  return SEED_COMPANIES;
}

export function generateMockCompanyProfile(ticker: string): MockCompanyProfile {
  const rnd = mulberry32(hashStringToSeed(ticker));
  const sectorEntry = SECTORS[Math.floor(rnd() * SECTORS.length)];
  const industry = sectorEntry.industries[Math.floor(rnd() * sectorEntry.industries.length)];
  const known = SEED_COMPANIES.find((c) => c.ticker === ticker);

  return {
    ticker,
    name: known?.name ?? `${ticker} Holdings Inc.`,
    sector: sectorEntry.sector,
    industry,
    exchange: rnd() > 0.5 ? "NASDAQ" : "NYSE",
    country: "US",
    description: `${known?.name ?? ticker} operates in the ${industry} segment of the ${sectorEntry.sector} sector, providing products and services to enterprise and institutional customers.`,
    employeeCount: Math.floor(500 + rnd() * 50_000),
  };
}

export interface MockQuarterRecord {
  fiscalYear: number;
  fiscalQuarter: number;
  periodEndDate: Date;
  revenue: number;
  costOfRevenue: number;
  grossProfit: number;
  operatingExpense: number;
  operatingIncome: number;
  netIncome: number;
  ebitda: number;
  eps: number;
  sharesOutstanding: number;
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  currentAssets: number;
  currentLiabilities: number;
  cash: number;
  totalDebt: number;
  longTermDebt: number;
  inventory: number;
  receivables: number;
  operatingCashFlow: number;
  capex: number;
  freeCashFlow: number;
  dividendsPaid: number;
  closePrice: number;
  volumeAvg: number;
}

/**
 * Generates `count` quarters of plausible, internally-consistent financial
 * data, oldest first, with a gentle growth trend plus noise and an
 * occasional "rough quarter" so strategies have real signal to find.
 */
export function generateMockQuarters(ticker: string, count = 12): MockQuarterRecord[] {
  const rnd = mulberry32(hashStringToSeed(ticker + ":financials"));
  const quarters: MockQuarterRecord[] = [];

  const now = new Date();
  let cursorYear = now.getFullYear();
  let cursorQuarter = Math.floor(now.getMonth() / 3) + 1;

  // walk backwards `count` quarters to find the starting point
  for (let i = 0; i < count; i++) {
    cursorQuarter -= 1;
    if (cursorQuarter === 0) {
      cursorQuarter = 4;
      cursorYear -= 1;
    }
  }

  let baseRevenue = 40_000_000 + rnd() * 200_000_000;
  let baseAssets = baseRevenue * (1.6 + rnd() * 0.8);
  let sharesOutstanding = 20_000_000 + rnd() * 150_000_000;
  let cash = baseAssets * 0.12;
  let longTermDebt = baseAssets * (0.15 + rnd() * 0.2);

  const growthDrift = 0.01 + rnd() * 0.025; // ~1-3.5% QoQ growth on average
  const marginBase = 0.08 + rnd() * 0.18; // 8-26% net margin baseline

  for (let i = 0; i < count; i++) {
    cursorQuarter += 1;
    if (cursorQuarter > 4) {
      cursorQuarter = 1;
      cursorYear += 1;
    }

    const noise = (rnd() - 0.5) * 0.06;
    const roughQuarter = rnd() < 0.12 ? -0.08 : 0; // occasional bad quarter
    const growth = growthDrift + noise + roughQuarter;

    baseRevenue = Math.max(baseRevenue * (1 + growth), 1_000_000);
    const costOfRevenue = baseRevenue * (0.45 + rnd() * 0.15);
    const grossProfit = baseRevenue - costOfRevenue;
    const operatingExpense = grossProfit * (0.45 + rnd() * 0.2);
    const operatingIncome = grossProfit - operatingExpense;
    const interestAndTax = operatingIncome * (0.22 + rnd() * 0.06);
    const netMargin = Math.max(marginBase + noise, -0.05);
    const netIncome = baseRevenue * netMargin;
    const ebitda = operatingIncome * (1.15 + rnd() * 0.1);
    const eps = netIncome / sharesOutstanding;

    baseAssets = baseAssets * (1 + growth * 0.6);
    const totalEquity = baseAssets * (0.35 + rnd() * 0.15);
    const totalLiabilities = baseAssets - totalEquity;
    const currentAssets = baseAssets * (0.3 + rnd() * 0.1);
    const currentLiabilities = totalLiabilities * (0.35 + rnd() * 0.1);
    const inventory = currentAssets * (0.15 + rnd() * 0.1);
    const receivables = currentAssets * (0.2 + rnd() * 0.1);

    cash = Math.max(cash * (1 + growth * 0.4) + netIncome * 0.2, baseAssets * 0.03);
    longTermDebt = Math.max(longTermDebt * (1 + (rnd() - 0.55) * 0.08), 0);
    const totalDebt = longTermDebt + currentLiabilities * 0.2;

    const operatingCashFlow = netIncome * (1.05 + rnd() * 0.25);
    const capex = baseRevenue * (0.03 + rnd() * 0.05);
    const freeCashFlow = operatingCashFlow - capex;
    const dividendsPaid = rnd() > 0.4 ? netIncome * (0.1 + rnd() * 0.2) : 0;

    sharesOutstanding = sharesOutstanding * (rnd() > 0.85 ? 1 + rnd() * 0.01 : 1);

    const closePrice = 8 + rnd() * 180 + i * (rnd() * 0.8);
    const volumeAvg = 200_000 + rnd() * 4_000_000;

    quarters.push({
      fiscalYear: cursorYear,
      fiscalQuarter: cursorQuarter,
      periodEndDate: quarterEndDate(cursorYear, cursorQuarter),
      revenue: round2(baseRevenue),
      costOfRevenue: round2(costOfRevenue),
      grossProfit: round2(grossProfit),
      operatingExpense: round2(operatingExpense),
      operatingIncome: round2(operatingIncome),
      netIncome: round2(netIncome),
      ebitda: round2(ebitda),
      eps: Number(eps.toFixed(4)),
      sharesOutstanding: round2(sharesOutstanding),
      totalAssets: round2(baseAssets),
      totalLiabilities: round2(totalLiabilities),
      totalEquity: round2(totalEquity),
      currentAssets: round2(currentAssets),
      currentLiabilities: round2(currentLiabilities),
      cash: round2(cash),
      totalDebt: round2(totalDebt),
      longTermDebt: round2(longTermDebt),
      inventory: round2(inventory),
      receivables: round2(receivables),
      operatingCashFlow: round2(operatingCashFlow),
      capex: round2(capex),
      freeCashFlow: round2(freeCashFlow),
      dividendsPaid: round2(dividendsPaid),
      closePrice: Number(closePrice.toFixed(2)),
      volumeAvg: round2(volumeAvg),
    });

    void interestAndTax; // retained for readability/future use; not persisted directly
  }

  return quarters;
}

function quarterEndDate(year: number, quarter: number): Date {
  const monthEnd = quarter * 3; // 3, 6, 9, 12
  return new Date(Date.UTC(year, monthEnd, 0)); // day 0 of next month = last day of monthEnd
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const DEFAULT_SOURCE: DataSource = "MOCK";

export interface MockPriceBar {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  adjClose: number;
  volume: number;
}

/**
 * Deterministic daily price series (OHLCV) for a ticker.
 *
 * Used by the mock data provider so the risk, momentum and portfolio engines
 * have a genuine daily series to work with when no market-data API key is
 * configured. The series is a seeded geometric random walk with mild
 * momentum, mean reversion and volatility clustering so that the risk
 * statistics (Sharpe, drawdown, VaR) behave realistically.
 */
export function generateMockDailyBars(ticker: string, days = 500): MockPriceBar[] {
  const rnd = mulberry32(hashStringToSeed(ticker + ":prices"));
  const bars: MockPriceBar[] = [];

  const startPrice = 20 + rnd() * 280;
  const drift = (rnd() - 0.45) * 0.0009;          // ±0.09% per day
  const baseVol = 0.008 + rnd() * 0.016;          // 0.8%–2.4% daily vol
  let price = startPrice;
  let vol = baseVol;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today.getTime() - i * 86_400_000);
    // Skip weekends to look like a real trading calendar.
    if (date.getUTCDay() === 0 || date.getUTCDay() === 6) continue;

    // GARCH-like volatility clustering
    const shock = (rnd() - 0.5) * 2;
    vol = 0.9 * vol + 0.1 * baseVol + 0.02 * baseVol * Math.abs(shock);

    const ret = drift + shock * vol;
    const open = price * (1 + (rnd() - 0.5) * 0.002);
    price = Math.max(0.5, price * (1 + ret));
    const close = price;
    const high = Math.max(open, close) * (1 + rnd() * 0.004);
    const low = Math.min(open, close) * (1 - rnd() * 0.004);
    const volume = Math.round(200_000 + rnd() * 8_000_000);

    bars.push({
      date,
      open: Number(open.toFixed(4)),
      high: Number(high.toFixed(4)),
      low: Number(low.toFixed(4)),
      close: Number(close.toFixed(4)),
      adjClose: Number(close.toFixed(4)),
      volume,
    });
  }

  return bars;
}

/**
 * Re-scale a daily bar series so that the close on `targetDate` matches
 * `targetPrice` (used to keep the daily series consistent with the quarterly
 * close prices stored on the fact table).
 */
export function alignBarSeries(
  bars: MockPriceBar[],
  targetDate: Date,
  targetPrice: number
): MockPriceBar[] {
  const target = targetDate.getTime();
  let index = bars.findIndex((b) => b.date.getTime() >= target);
  if (index < 0) index = bars.length - 1;
  const anchor = bars[index];
  if (!anchor || anchor.close <= 0) return bars;
  const factor = targetPrice / anchor.close;
  return bars.map((b, i) => {
    const scale = i >= index ? factor : 1;
    return {
      ...b,
      open: Number((b.open * scale).toFixed(4)),
      high: Number((b.high * scale).toFixed(4)),
      low: Number((b.low * scale).toFixed(4)),
      close: Number((b.close * scale).toFixed(4)),
      adjClose: Number((b.adjClose * scale).toFixed(4)),
    };
  });
}
