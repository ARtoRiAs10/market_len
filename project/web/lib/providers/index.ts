import {
  MockCompanyProfile,
  MockQuarterRecord,
  generateMockCompanyProfile,
  generateMockQuarters,
  generateMockDailyBars,
} from "@/lib/mock-data";
import { getEnv } from "@/lib/env";

/**
 * Pluggable market-data provider interface.
 *
 * MOCK is the default and requires no API key. To go live set
 * MARKET_DATA_PROVIDER=ALPHA_VANTAGE (or FMP) in .env plus the matching API
 * key. Both live providers are fully implemented:
 *
 *   Alpha Vantage — OVERVIEW, INCOME_STATEMENT, BALANCE_SHEET, CASH_FLOW,
 *                   TIME_SERIES_DAILY_ADJUSTED
 *   FMP          — /profile, /income-statement, /balance-sheet-statement,
 *                   /cash-flow-statement, /historical-price-full
 *
 * Every provider returns the same shapes (MockCompanyProfile /
 * MockQuarterRecord / MockPriceBar) so the ETL pipeline and the UI never
 * need to know which source is active.
 */

export interface MockPriceBar {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  adjClose: number;
  volume: number;
}

export interface MarketDataProvider {
  name: string;
  fetchProfile(ticker: string): Promise<MockCompanyProfile>;
  fetchQuarters(ticker: string, count: number): Promise<MockQuarterRecord[]>;
  fetchDailyBars(ticker: string, days: number): Promise<MockPriceBar[]>;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Alpha Vantage rate limit: 5 requests/minute on the free tier. */
const ALPHA_VANTAGE_BASE = "https://www.alphavantage.co/query";

async function alphaVantageQuery(
  functionName: string,
  params: Record<string, string>,
  apiKey: string
): Promise<any> {
  const url = new URL(ALPHA_VANTAGE_BASE);
  url.searchParams.set("function", functionName);
  url.searchParams.set("apikey", apiKey);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`Alpha Vantage ${functionName} failed: ${res.status}`);
  const json = await res.json();
  if (json?.Note || json?.Information) {
    throw new Error(`Alpha Vantage rate limit reached: ${json.Note || json.Information}`);
  }
  if (json?.["Error Message"]) throw new Error(`Alpha Vantage error: ${json["Error Message"]}`);
  return json;
}

const mockProvider: MarketDataProvider = {
  name: "MOCK",
  async fetchProfile(ticker) {
    return generateMockCompanyProfile(ticker);
  },
  async fetchQuarters(ticker, count) {
    return generateMockQuarters(ticker, count);
  },
  async fetchDailyBars(ticker, days) {
    return generateMockDailyBars(ticker, days);
  },
};

const alphaVantageProvider: MarketDataProvider = {
  name: "ALPHA_VANTAGE",

  async fetchProfile(ticker) {
    const env = getEnv();
    if (!env.ALPHA_VANTAGE_API_KEY) {
      console.warn("[providers] ALPHA_VANTAGE_API_KEY missing, falling back to mock profile");
      return generateMockCompanyProfile(ticker);
    }
    try {
      const data = await alphaVantageQuery(
        "OVERVIEW",
        { symbol: ticker.toUpperCase() },
        env.ALPHA_VANTAGE_API_KEY
      );
      return {
        ticker: ticker.toUpperCase(),
        name: data.Name ?? `${ticker} Holdings Inc.`,
        sector: data.Sector ?? "Unknown",
        industry: data.Industry ?? "Unknown",
        exchange: data.Exchange ?? "US",
        country: data.Country ?? "US",
        description: data.Description ?? "",
        employeeCount: num(data.Employees) ?? 0,
      };
    } catch (err) {
      console.warn("[providers] Alpha Vantage profile failed:", err);
      return generateMockCompanyProfile(ticker);
    }
  },

  async fetchQuarters(ticker, count) {
    const env = getEnv();
    if (!env.ALPHA_VANTAGE_API_KEY) {
      console.warn("[providers] ALPHA_VANTAGE_API_KEY missing, falling back to mock financials");
      return generateMockQuarters(ticker, count);
    }

    const symbol = ticker.toUpperCase();
    const key = env.ALPHA_VANTAGE_API_KEY;

    try {
      const [income, balance, cashflow] = await Promise.all([
        alphaVantageQuery("INCOME_STATEMENT", { symbol }, key),
        alphaVantageQuery("BALANCE_SHEET", { symbol }, key),
        alphaVantageQuery("CASH_FLOW", { symbol }, key),
      ]);

      const incomeQ = income?.quarterlyReports ?? [];
      const balanceQ = balance?.quarterlyReports ?? [];
      const cashQ = cashflow?.quarterlyReports ?? [];

      // Index the balance-sheet and cash-flow quarters by (year, month) so the
      // three statements can be zipped even when reporting dates differ.
      const keyOf = (d: string) => (d ?? "").slice(0, 7); // YYYY-MM
      const balanceMap = new Map<string, any>(
        balanceQ.map((r: any) => [keyOf(r.fiscalDate), r] as [string, any])
      );
      const cashMap = new Map<string, any>(
        cashQ.map((r: any) => [keyOf(r.fiscalDate), r] as [string, any])
      );

      const records: MockQuarterRecord[] = [];

      for (const inc of incomeQ) {
        const month = keyOf(inc.fiscalDate);
        const bal = balanceMap.get(month);
        const cf = cashMap.get(month);
        if (!bal && !cf) continue;

        const revenue = num(inc.totalRevenue) ?? 0;
        const grossProfit = num(inc.grossProfit) ?? null;
        const costOfRevenue =
          grossProfit !== null ? revenue - grossProfit : num(inc.costOfRevenue);
        const operatingIncome = num(inc.operatingIncome);
        const netIncome = num(inc.netIncome);
        const ebitda = num(inc.ebitda);
        const eps = num(inc.eps);
        const shares = num(inc.sharesOutstanding) ?? num(inc.commonStockSharesOutstanding);

        const totalAssets = num(bal?.totalAssets);
        const totalLiabilities = num(bal?.totalLiabilities);
        const totalEquity = num(bal?.totalStockholderEquity) ?? num(bal?.totalShareholdersEquity);
        const currentAssets = num(bal?.totalCurrentAssets);
        const currentLiabilities = num(bal?.totalCurrentLiabilities);
        const cash = num(bal?.cashAndCashEquivalents);
        const longTermDebt = num(bal?.longTermDebt);
        const shortTermDebt = num(bal?.shortTermDebt) ?? 0;
        const inventory = num(bal?.inventory);
        const receivables = num(bal?.accountsReceivable) ?? num(bal?.receivables);

        const ocf = num(cf?.operatingCashFlow);
        const capex = num(cf?.capitalExpenditures);
        const dividends = num(cf?.dividendsPaid);
        const fcf = ocf !== null && capex !== null ? ocf - Math.abs(capex) : null;

        const fiscalDate = new Date(inc.fiscalDate);
        if (Number.isNaN(fiscalDate.getTime())) continue;

        records.push({
          fiscalYear: fiscalDate.getUTCFullYear(),
          fiscalQuarter: Math.floor(fiscalDate.getUTCMonth() / 3) + 1,
          periodEndDate: fiscalDate,
          revenue,
          costOfRevenue: costOfRevenue ?? 0,
          grossProfit: grossProfit ?? 0,
          operatingExpense:
            grossProfit !== null && operatingIncome !== null ? grossProfit - operatingIncome : 0,
          operatingIncome: operatingIncome ?? 0,
          netIncome: netIncome ?? 0,
          ebitda: ebitda ?? 0,
          eps: eps ?? 0,
          sharesOutstanding: shares ?? 0,
          totalAssets: totalAssets ?? 0,
          totalLiabilities: totalLiabilities ?? 0,
          totalEquity: totalEquity ?? 0,
          currentAssets: currentAssets ?? 0,
          currentLiabilities: currentLiabilities ?? 0,
          cash: cash ?? 0,
          totalDebt: (longTermDebt ?? 0) + shortTermDebt,
          longTermDebt: longTermDebt ?? 0,
          inventory: inventory ?? 0,
          receivables: receivables ?? 0,
          operatingCashFlow: ocf ?? 0,
          capex: capex !== null ? Math.abs(capex) : 0,
          freeCashFlow: fcf ?? 0,
          dividendsPaid: dividends !== null ? Math.abs(dividends) : 0,
          closePrice: 0, // filled in from the daily price series
          volumeAvg: 0,
        });
      }

      if (records.length === 0) {
        console.warn("[providers] Alpha Vantage returned no quarterly reports, using mock");
        return generateMockQuarters(ticker, count);
      }

      records.sort((a, b) =>
        a.fiscalYear - b.fiscalYear || a.fiscalQuarter - b.fiscalQuarter
      );
      const trimmed = records.slice(-count);
      await attachClosingPrices(alphaVantageProvider, ticker, trimmed);
      return trimmed;
    } catch (err) {
      console.warn("[providers] Alpha Vantage financials failed:", err);
      return generateMockQuarters(ticker, count);
    }
  },

  async fetchDailyBars(ticker, days) {
    const env = getEnv();
    if (!env.ALPHA_VANTAGE_API_KEY) {
      console.warn("[providers] ALPHA_VANTAGE_API_KEY missing, falling back to mock prices");
      return generateMockDailyBars(ticker, days);
    }
    try {
      const data = await alphaVantageQuery(
        "TIME_SERIES_DAILY_ADJUSTED",
        { symbol: ticker.toUpperCase(), outputsize: "full" },
        env.ALPHA_VANTAGE_API_KEY
      );
      const series = data?.["Time Series (Daily)"];
      if (!series) return generateMockDailyBars(ticker, days);
      const bars = Object.entries(series)
        .map(([date, row]: [string, any]) => ({
          date: new Date(date),
          open: Number(row["1. open"]),
          high: Number(row["2. high"]),
          low: Number(row["3. low"]),
          close: Number(row["4. close"]),
          adjClose: Number(row["5. adjusted close"] ?? row["4. close"]),
          volume: Number(row["6. volume"] ?? 0),
        }))
        .filter((b) => !Number.isNaN(b.date.getTime()))
        .sort((a, b) => a.date.getTime() - b.date.getTime());
      return bars.slice(-days);
    } catch (err) {
      console.warn("[providers] Alpha Vantage daily bars failed:", err);
      return generateMockDailyBars(ticker, days);
    }
  },
};

const FMP_BASE = "https://financialmodelingprep.com/api/v3";

async function fmpGet(path: string, apiKey: string): Promise<any> {
  const url = `${FMP_BASE}${path}${path.includes("?") ? "&" : "?"}apikey=${apiKey}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`FMP ${path} failed: ${res.status}`);
  const json = await res.json();
  if (Array.isArray(json) && json.length === 0) return [];
  if (json && typeof json === "object" && json["Error Message"]) {
    throw new Error(`FMP error: ${json["Error Message"]}`);
  }
  return json;
}

const fmpProvider: MarketDataProvider = {
  name: "FMP",

  async fetchProfile(ticker) {
    const env = getEnv();
    if (!env.FMP_API_KEY) {
      console.warn("[providers] FMP_API_KEY missing, falling back to mock profile");
      return generateMockCompanyProfile(ticker);
    }
    try {
      const data = await fmpGet(`/profile/${ticker.toUpperCase()}`, env.FMP_API_KEY);
      return {
        ticker: ticker.toUpperCase(),
        name: data.companyName ?? `${ticker} Holdings Inc.`,
        sector: data.sector ?? "Unknown",
        industry: data.industry ?? "Unknown",
        exchange: data.exchange ?? "US",
        country: data.country ?? "US",
        description: data.description ?? "",
        employeeCount: num(data.fullTimeEmployees) ?? 0,
      };
    } catch (err) {
      console.warn("[providers] FMP profile failed:", err);
      return generateMockCompanyProfile(ticker);
    }
  },

  async fetchQuarters(ticker, count) {
    const env = getEnv();
    if (!env.FMP_API_KEY) {
      console.warn("[providers] FMP_API_KEY missing, falling back to mock financials");
      return generateMockQuarters(ticker, count);
    }
    const symbol = ticker.toUpperCase();
    const key = env.FMP_API_KEY;
    try {
      const [income, balance, cashflow] = await Promise.all([
        fmpGet(`/income-statement/${symbol}?period=quarter&limit=${Math.max(count, 8)}`, key),
        fmpGet(`/balance-sheet-statement/${symbol}?period=quarter&limit=${Math.max(count, 8)}`, key),
        fmpGet(`/cash-flow-statement/${symbol}?period=quarter&limit=${Math.max(count, 8)}`, key),
      ]);

      const records: MockQuarterRecord[] = [];
      for (const inc of income ?? []) {
        const dateStr = inc.date ?? inc["fillingDate"];
        const d = dateStr ? new Date(dateStr) : null;
        if (!d || Number.isNaN(d.getTime())) continue;

        const revenue = num(inc.revenue) ?? 0;
        const grossProfit = num(inc.grossProfit);
        const costOfRevenue = num(inc.costOfRevenue);
        const operatingIncome = num(inc.operatingIncome);
        const netIncome = num(inc.netIncome);
        const ebitda = num(inc.ebitda);
        const eps = num(inc.eps);
        const shares = num(inc.weightedAverageShsOut) ?? num(inc.sharesOutstanding);

        records.push({
          fiscalYear: d.getUTCFullYear(),
          fiscalQuarter: Math.floor(d.getUTCMonth() / 3) + 1,
          periodEndDate: d,
          revenue,
          costOfRevenue: costOfRevenue ?? (grossProfit !== null ? revenue - grossProfit : 0),
          grossProfit: grossProfit ?? 0,
          operatingExpense:
            grossProfit !== null && operatingIncome !== null ? grossProfit - operatingIncome : 0,
          operatingIncome: operatingIncome ?? 0,
          netIncome: netIncome ?? 0,
          ebitda: ebitda ?? 0,
          eps: eps ?? 0,
          sharesOutstanding: shares ?? 0,
          totalAssets: num(inc.totalAssets) ?? 0,
          totalLiabilities: num(inc.totalLiabilities) ?? 0,
          totalEquity: num(inc.totalStockholdersEquity) ?? 0,
          currentAssets: num(inc.totalCurrentAssets) ?? 0,
          currentLiabilities: num(inc.totalCurrentLiabilities) ?? 0,
          cash: num(inc.cashAndCashEquivalents) ?? 0,
          totalDebt: num(inc.totalDebt) ?? 0,
          longTermDebt: num(inc.longTermDebt) ?? 0,
          inventory: num(inc.inventory) ?? 0,
          receivables: num(inc.receivables) ?? 0,
          operatingCashFlow: num(inc?.operatingCashFlow) ?? 0,
          capex: num(inc?.capitalExpenditure) ?? 0,
          freeCashFlow: num(inc?.freeCashFlow) ?? 0,
          dividendsPaid: num(inc?.dividendsPaid) ?? 0,
          closePrice: 0,
          volumeAvg: 0,
        });
      }

      // FMP returns balance-sheet and cash-flow series in a separate array;
      // merge them by fiscal year/quarter.
      const mergeIndex = (arr: any[]) =>
        new Map(
          (arr ?? []).map((r: any) => {
            const d = new Date(r.date);
            return [
              `${d.getUTCFullYear()}Q${Math.floor(d.getUTCMonth() / 3) + 1}`,
              r,
            ] as [string, any];
          })
        );
      const balMap = mergeIndex(balance);
      const cfMap = mergeIndex(cashflow);

      for (const rec of records) {
        const k = `${rec.fiscalYear}Q${rec.fiscalQuarter}`;
        const bal = balMap.get(k);
        const cf = cfMap.get(k);
        if (bal) {
          rec.totalAssets = num(bal.totalAssets) ?? rec.totalAssets;
          rec.totalLiabilities = num(bal.totalLiabilities) ?? rec.totalLiabilities;
          rec.totalEquity = num(bal.totalStockholdersEquity) ?? rec.totalEquity;
          rec.currentAssets = num(bal.totalCurrentAssets) ?? rec.currentAssets;
          rec.currentLiabilities = num(bal.totalCurrentLiabilities) ?? rec.currentLiabilities;
          rec.cash = num(bal.cashAndCashEquivalents) ?? rec.cash;
          rec.longTermDebt = num(bal.longTermDebt) ?? rec.longTermDebt;
          rec.totalDebt = num(bal.totalDebt) ?? rec.totalDebt;
          rec.inventory = num(bal.inventory) ?? rec.inventory;
          rec.receivables = num(bal.receivables) ?? rec.receivables;
        }
        if (cf) {
          rec.operatingCashFlow = num(cf.operatingCashFlow) ?? rec.operatingCashFlow;
          rec.capex = num(cf.capitalExpenditure) ?? rec.capex;
          rec.freeCashFlow = num(cf.freeCashFlow) ?? rec.freeCashFlow;
          rec.dividendsPaid = num(cf.dividendsPaid) ?? rec.dividendsPaid;
        }
      }

      if (records.length === 0) {
        console.warn("[providers] FMP returned no quarterly statements, using mock");
        return generateMockQuarters(ticker, count);
      }

      records.sort((a, b) => a.fiscalYear - b.fiscalYear || a.fiscalQuarter - b.fiscalQuarter);
      const trimmed = records.slice(-count);
      await attachClosingPrices(fmpProvider, ticker, trimmed);
      return trimmed;
    } catch (err) {
      console.warn("[providers] FMP financials failed:", err);
      return generateMockQuarters(ticker, count);
    }
  },

  async fetchDailyBars(ticker, days) {
    const env = getEnv();
    if (!env.FMP_API_KEY) {
      console.warn("[providers] FMP_API_KEY missing, falling back to mock prices");
      return generateMockDailyBars(ticker, days);
    }
    try {
      const data = await fmpGet(
        `/historical-price-full/${ticker.toUpperCase()}?serietype=line&from=${new Date(
          Date.now() - days * 2 * 86_400_000
        ).toISOString().slice(0, 10)}`,
        env.FMP_API_KEY
      );
      const bars = (data?.historical ?? [])
        .map((r: any) => ({
          date: new Date(r.date),
          open: Number(r.open),
          high: Number(r.high),
          low: Number(r.low),
          close: Number(r.close),
          adjClose: Number(r.adjClose ?? r.close),
          volume: Number(r.volume ?? 0),
        }))
        .filter((b: MockPriceBar) => !Number.isNaN(b.date.getTime()))
        .sort((a: MockPriceBar, b: MockPriceBar) => a.date.getTime() - b.date.getTime());
      return bars.slice(-days);
    } catch (err) {
      console.warn("[providers] FMP daily bars failed:", err);
      return generateMockDailyBars(ticker, days);
    }
  },
};

/**
 * Attach the quarter-end closing price to each quarterly record so the
 * strategies that need a market value (Altman X4, Magic Formula, Value)
 * have one without a second round trip.
 */
async function attachClosingPrices(
  provider: MarketDataProvider,
  ticker: string,
  records: MockQuarterRecord[]
): Promise<void> {
  try {
    const bars = await provider.fetchDailyBars(ticker, 800);
    if (bars.length === 0) return;
    for (const rec of records) {
      const target = rec.periodEndDate.getTime();
      let best: MockPriceBar | null = null;
      for (const bar of bars) {
        if (bar.date.getTime() <= target) best = bar;
        else break;
      }
      if (best) {
        rec.closePrice = best.close;
        rec.volumeAvg = best.volume;
      }
    }
  } catch {
    /* price enrichment is best-effort */
  }
}

export function getMarketDataProvider(override?: string): MarketDataProvider {
  const env = getEnv();
  const choice = override ?? env.MARKET_DATA_PROVIDER ?? "MOCK";
  switch (choice) {
    case "ALPHA_VANTAGE":
      return alphaVantageProvider;
    case "FMP":
      return fmpProvider;
    default:
      return mockProvider;
  }
}

export { mockProvider, alphaVantageProvider, fmpProvider };
