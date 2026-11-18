/**
 * Point-in-time market snapshot data.
 *
 * The app bundles real public constituent/market-cap data so it is useful even
 * when the optional live market-data provider is not configured. Facts are not
 * copyrightable; source links are kept for attribution and verification.
 *
 * Retrieved: 2026-11-18 (UTC)
 *   NIFTY 50:       https://en.wikipedia.org/wiki/NIFTY_50
 *   BSE SENSEX:     https://en.wikipedia.org/wiki/BSE_SENSEX
 *   Global top 10:  https://companiesmarketcap.com/
 *
 * Global list excludes private companies (e.g. SpaceX) and uses the top 10
 * publicly listed companies by market cap.
 */

export interface NiftyConstituent {
  name: string;
  symbol: string;
  sector: string;
}

export interface SensexConstituent {
  name: string;
  symbol: string;
  sector: string;
  bseCode: string;
}

export interface GlobalCompanySnapshot {
  rank: number;
  name: string;
  ticker: string;
  marketCap: string;
  country: string;
}

export const MARKET_SNAPSHOT_META = {
  retrievedAt: "2026-11-18",
  sources: {
    nifty50: "https://en.wikipedia.org/wiki/NIFTY_50",
    sensex: "https://en.wikipedia.org/wiki/BSE_SENSEX",
    globalTop10: "https://companiesmarketcap.com/",
  },
} as const;

export const NIFTY_50_CONSTITUENTS: NiftyConstituent[] = [
  { name: "Adani Enterprises", symbol: "ADANIENT", sector: "Metals & Mining" },
  { name: "Adani Ports & SEZ", symbol: "ADANIPORTS", sector: "Services" },
  { name: "Apollo Hospitals", symbol: "APOLLOHOSP", sector: "Healthcare" },
  { name: "Asian Paints", symbol: "ASIANPAINT", sector: "Consumer Durables" },
  { name: "Axis Bank", symbol: "AXISBANK", sector: "Financial Services" },
  { name: "Bajaj Auto", symbol: "BAJAJ-AUTO", sector: "Automobile and Auto Components" },
  { name: "Bajaj Finance", symbol: "BAJFINANCE", sector: "Financial Services" },
  { name: "Bajaj Finserv", symbol: "BAJAJFINSV", sector: "Financial Services" },
  { name: "Bharat Electronics", symbol: "BEL", sector: "Capital Goods" },
  { name: "Bharti Airtel", symbol: "BHARTIARTL", sector: "Telecommunication" },
  { name: "BSE", symbol: "BSE", sector: "Financial Services" },
  { name: "Cipla", symbol: "CIPLA", sector: "Healthcare" },
  { name: "Coal India", symbol: "COALINDIA", sector: "Oil, Gas & Consumable Fuels" },
  { name: "Dr. Reddy's Laboratories", symbol: "DRREDDY", sector: "Healthcare" },
  { name: "Eicher Motors", symbol: "EICHERMOT", sector: "Automobile and Auto Components" },
  { name: "Eternal", symbol: "ETERNAL", sector: "Consumer Services" },
  { name: "Grasim Industries", symbol: "GRASIM", sector: "Construction Materials" },
  { name: "HCLTech", symbol: "HCLTECH", sector: "Information Technology" },
  { name: "HDFC Bank", symbol: "HDFCBANK", sector: "Financial Services" },
  { name: "HDFC Life", symbol: "HDFCLIFE", sector: "Financial Services" },
  { name: "Hindalco Industries", symbol: "HINDALCO", sector: "Metals & Mining" },
  { name: "Hindustan Unilever", symbol: "HINDUNILVR", sector: "Fast Moving Consumer Goods" },
  { name: "ICICI Bank", symbol: "ICICIBANK", sector: "Financial Services" },
  { name: "IndiGo", symbol: "INDIGO", sector: "Services" },
  { name: "Infosys", symbol: "INFY", sector: "Information Technology" },
  { name: "ITC", symbol: "ITC", sector: "Fast Moving Consumer Goods" },
  { name: "Jio Financial Services", symbol: "JIOFIN", sector: "Financial Services" },
  { name: "JSW Steel", symbol: "JSWSTEEL", sector: "Metals & Mining" },
  { name: "Kotak Mahindra Bank", symbol: "KOTAKBANK", sector: "Financial Services" },
  { name: "Larsen & Toubro", symbol: "LT", sector: "Construction" },
  { name: "Mahindra & Mahindra", symbol: "M&M", sector: "Automobile and Auto Components" },
  { name: "Maruti Suzuki", symbol: "MARUTI", sector: "Automobile and Auto Components" },
  { name: "Max Healthcare", symbol: "MAXHEALTH", sector: "Healthcare" },
  { name: "Nestlé India", symbol: "NESTLEIND", sector: "Fast Moving Consumer Goods" },
  { name: "NTPC", symbol: "NTPC", sector: "Power" },
  { name: "Oil and Natural Gas Corporation", symbol: "ONGC", sector: "Oil, Gas & Consumable Fuels" },
  { name: "Power Grid", symbol: "POWERGRID", sector: "Power" },
  { name: "Reliance Industries", symbol: "RELIANCE", sector: "Oil, Gas & Consumable Fuels" },
  { name: "SBI Life Insurance Company", symbol: "SBILIFE", sector: "Financial Services" },
  { name: "Shriram Finance", symbol: "SHRIRAMFIN", sector: "Financial Services" },
  { name: "State Bank of India", symbol: "SBIN", sector: "Financial Services" },
  { name: "Sun Pharma", symbol: "SUNPHARMA", sector: "Healthcare" },
  { name: "Tata Consultancy Services", symbol: "TCS", sector: "Information Technology" },
  { name: "Tata Consumer Products", symbol: "TATACONSUM", sector: "Fast Moving Consumer Goods" },
  { name: "Tata Motors Passenger Vehicles", symbol: "TMPV", sector: "Automobile and Auto Components" },
  { name: "Tata Steel", symbol: "TATASTEEL", sector: "Metals & Mining" },
  { name: "Tech Mahindra", symbol: "TECHM", sector: "Information Technology" },
  { name: "Titan Company", symbol: "TITAN", sector: "Consumer Durables" },
  { name: "Trent", symbol: "TRENT", sector: "Consumer Services" },
  { name: "UltraTech Cement", symbol: "ULTRACEMCO", sector: "Construction Materials" },
];

export const SENSEX_CONSTITUENTS: SensexConstituent[] = [
  { name: "Adani Ports & SEZ", symbol: "ADANIPORTS", sector: "Ports", bseCode: "532921" },
  { name: "Asian Paints", symbol: "ASIANPAINT", sector: "Consumer Durables", bseCode: "500820" },
  { name: "Axis Bank", symbol: "AXISBANK", sector: "Banks", bseCode: "532215" },
  { name: "Bajaj Finance", symbol: "BAJFINANCE", sector: "Finance", bseCode: "500034" },
  { name: "Bajaj Finserv", symbol: "BAJAJFINSV", sector: "Finance", bseCode: "532978" },
  { name: "Bharat Electronics", symbol: "BEL", sector: "Aerospace & Defence", bseCode: "500049" },
  { name: "Bharti Airtel", symbol: "BHARTIARTL", sector: "Telecommunication", bseCode: "532454" },
  { name: "Eternal", symbol: "ETERNAL", sector: "Retailing", bseCode: "543320" },
  { name: "HCLTech", symbol: "HCLTECH", sector: "IT", bseCode: "532281" },
  { name: "HDFC Bank", symbol: "HDFCBANK", sector: "Banks", bseCode: "500180" },
  { name: "Hindustan Unilever", symbol: "HINDUNILVR", sector: "FMCG", bseCode: "500696" },
  { name: "ICICI Bank", symbol: "ICICIBANK", sector: "Banks", bseCode: "532174" },
  { name: "IndiGo", symbol: "INDIGO", sector: "Airlines", bseCode: "539448" },
  { name: "Infosys", symbol: "INFY", sector: "IT", bseCode: "500209" },
  { name: "ITC", symbol: "ITC", sector: "FMCG", bseCode: "500875" },
  { name: "Kotak Mahindra Bank", symbol: "KOTAKBANK", sector: "Banks", bseCode: "500247" },
  { name: "Larsen & Toubro", symbol: "LT", sector: "Construction", bseCode: "500510" },
  { name: "Mahindra & Mahindra", symbol: "M&M", sector: "Automobiles", bseCode: "500520" },
  { name: "Maruti Suzuki", symbol: "MARUTI", sector: "Automobiles", bseCode: "532500" },
  { name: "NTPC", symbol: "NTPC", sector: "Power", bseCode: "532555" },
  { name: "Power Grid", symbol: "POWERGRID", sector: "Power", bseCode: "532898" },
  { name: "Reliance Industries", symbol: "RELIANCE", sector: "Petroleum", bseCode: "500325" },
  { name: "State Bank of India", symbol: "SBIN", sector: "Banks", bseCode: "500112" },
  { name: "Sun Pharma", symbol: "SUNPHARMA", sector: "Pharmaceuticals", bseCode: "524715" },
  { name: "Tata Consultancy Services", symbol: "TCS", sector: "IT", bseCode: "532540" },
  { name: "Tata Steel", symbol: "TATASTEEL", sector: "Metals", bseCode: "500470" },
  { name: "Tech Mahindra", symbol: "TECHM", sector: "IT", bseCode: "532755" },
  { name: "Titan Company", symbol: "TITAN", sector: "Consumer Durables", bseCode: "500114" },
  { name: "Trent", symbol: "TRENT", sector: "Retailing", bseCode: "500251" },
  { name: "UltraTech Cement", symbol: "ULTRACEMCO", sector: "Cement", bseCode: "532538" },
];

export const GLOBAL_TOP_10: GlobalCompanySnapshot[] = [
  { rank: 1, name: "Apple", ticker: "AAPL", marketCap: "$ 5.125 T", country: "USA" },
  { rank: 2, name: "Microsoft", ticker: "MSFT", marketCap: "$ 3.750 T", country: "USA" },
  { rank: 3, name: "NVIDIA", ticker: "NVDA", marketCap: "$ 3.695 T", country: "USA" },
  { rank: 4, name: "Alphabet (Google)", ticker: "GOOG", marketCap: "$ 3.434 T", country: "USA" },
  { rank: 5, name: "Amazon", ticker: "AMZN", marketCap: "$ 2.850 T", country: "USA" },
  { rank: 7, name: "TSMC", ticker: "TSM", marketCap: "$ 1.880 T", country: "Taiwan" },
  { rank: 8, name: "Saudi Aramco", ticker: "2222.SR", marketCap: "$ 1.705 T", country: "Saudi Arabia" },
  { rank: 9, name: "Broadcom", ticker: "AVGO", marketCap: "$ 1.691 T", country: "USA" },
  { rank: 10, name: "Meta Platforms (Facebook)", ticker: "META", marketCap: "$ 1.569 T", country: "USA" },
  { rank: 11, name: "Tesla", ticker: "TSLA", marketCap: "$ 1.505 T", country: "USA" },
];

export interface SnapshotCompanyLookup {
  name: string;
  sector: string;
  country: string;
  exchange: string;
}

/**
 * Look up a ticker in the bundled snapshots. Used by the watchlist importer so
 * importing NIFTY 50 / SENSEX / global leaders does not depend on a live API.
 */
export function findSnapshotCompany(ticker: string): SnapshotCompanyLookup | null {
  const upper = ticker.toUpperCase().trim();
  const nifty = NIFTY_50_CONSTITUENTS.find((c) => c.symbol.toUpperCase() === upper);
  if (nifty) return { name: nifty.name, sector: nifty.sector, country: "India", exchange: "NSE" };
  const sensex = SENSEX_CONSTITUENTS.find((c) => c.symbol.toUpperCase() === upper);
  if (sensex) return { name: sensex.name, sector: sensex.sector, country: "India", exchange: "BSE" };
  const global = GLOBAL_TOP_10.find((c) => c.ticker.toUpperCase() === upper);
  if (global) return { name: global.name, sector: "Global", country: global.country, exchange: "GLOBAL" };
  return null;
}
