import { MockCompanyProfile, MockQuarterRecord, generateMockCompanyProfile, generateMockQuarters } from "@/lib/mock-data";
import { getEnv } from "@/lib/env";

/**
 * Pluggable market-data provider interface.
 *
 * MOCK is the default and requires no API key. To go live:
 *   1. Set MARKET_DATA_PROVIDER=ALPHA_VANTAGE (or FMP) in .env
 *   2. Set ALPHA_VANTAGE_API_KEY (or FMP_API_KEY)
 *   3. Implement the two TODOs in fetchFromAlphaVantage / fetchFromFmp below
 *      mapping the provider's response shape onto MockQuarterRecord /
 *      MockCompanyProfile (kept generically named since both mock and real
 *      data share the same shape consumed by the ETL pipeline).
 */

export interface MarketDataProvider {
  name: string;
  fetchProfile(ticker: string): Promise<MockCompanyProfile>;
  fetchQuarters(ticker: string, count: number): Promise<MockQuarterRecord[]>;
}

const mockProvider: MarketDataProvider = {
  name: "MOCK",
  async fetchProfile(ticker) {
    return generateMockCompanyProfile(ticker);
  },
  async fetchQuarters(ticker, count) {
    return generateMockQuarters(ticker, count);
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
    // TODO: call https://www.alphavantage.co/query?function=OVERVIEW&symbol=...
    // and map { Sector, Industry, Exchange, Country, Description, ... } onto
    // MockCompanyProfile. Left as a clearly-marked extension point.
    console.warn("[providers] Alpha Vantage profile fetch not yet implemented, using mock");
    return generateMockCompanyProfile(ticker);
  },
  async fetchQuarters(ticker, count) {
    const env = getEnv();
    if (!env.ALPHA_VANTAGE_API_KEY) {
      console.warn("[providers] ALPHA_VANTAGE_API_KEY missing, falling back to mock financials");
      return generateMockQuarters(ticker, count);
    }
    // TODO: call INCOME_STATEMENT / BALANCE_SHEET / CASH_FLOW endpoints
    // (quarterlyReports arrays) and zip them into MockQuarterRecord[].
    console.warn("[providers] Alpha Vantage financials fetch not yet implemented, using mock");
    return generateMockQuarters(ticker, count);
  },
};

const fmpProvider: MarketDataProvider = {
  name: "FMP",
  async fetchProfile(ticker) {
    const env = getEnv();
    if (!env.FMP_API_KEY) {
      console.warn("[providers] FMP_API_KEY missing, falling back to mock profile");
      return generateMockCompanyProfile(ticker);
    }
    // TODO: call https://financialmodelingprep.com/api/v3/profile/{ticker}
    console.warn("[providers] FMP profile fetch not yet implemented, using mock");
    return generateMockCompanyProfile(ticker);
  },
  async fetchQuarters(ticker, count) {
    const env = getEnv();
    if (!env.FMP_API_KEY) {
      console.warn("[providers] FMP_API_KEY missing, falling back to mock financials");
      return generateMockQuarters(ticker, count);
    }
    // TODO: call /api/v3/income-statement/{ticker}?period=quarter etc.
    console.warn("[providers] FMP financials fetch not yet implemented, using mock");
    return generateMockQuarters(ticker, count);
  },
};

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
