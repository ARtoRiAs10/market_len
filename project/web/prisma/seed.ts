/**
 * MarketLens — Complete Seed Script
 * Run: npx tsx prisma/seed.ts
 *
 * Creates:
 *   - Plan limits (FREE / PRO / ENTERPRISE)
 *   - Admin user: admin@marketlens.dev / Admin1234  (PRO plan)
 *   - Demo user:  demo@marketlens.dev / Demo1234    (FREE plan)
 *   - 10 seed companies × 12 quarters each
 *   - Daily price bars for those companies + an SPY benchmark series
 *   - Every strategy in the registry
 *   - 5 index watchlists
 *   - A demo portfolio for the admin user
 *   - Sample alert + analyst note for admin
 */
import bcrypt from "bcryptjs";
import { prisma } from "../lib/db";
import {
  getSeedCompanyList,
  generateMockCompanyProfile,
  generateMockQuarters,
  generateMockDailyBars,
} from "../lib/mock-data";
import {
  NIFTY_50_CONSTITUENTS,
  SENSEX_CONSTITUENTS,
  GLOBAL_TOP_10,
  MARKET_SNAPSHOT_META,
} from "../lib/market-data/snapshot";

async function main() {
  console.log("🌱  Seeding MarketLens database…\n");

  const adminEmail = (process.env.SEED_ADMIN_EMAIL || "admin@marketlens.dev").toLowerCase().trim();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || "Admin1234";
  const adminName = process.env.SEED_ADMIN_NAME || "Demo Admin";

  // ── 1. Plan limits ────────────────────────────────────────────────────────
  const planData = [
    { plan: "FREE" as const,       maxWatchlistItems: 5,     maxStrategyRunsDay: 3,    maxEtlJobsDay: 1,    maxCompaniesTracked: 10,    historicalQuarters: 4,   apiAccess: false },
    { plan: "PRO" as const,        maxWatchlistItems: 100,   maxStrategyRunsDay: 100,  maxEtlJobsDay: 25,   maxCompaniesTracked: 500,   historicalQuarters: 40,  apiAccess: true  },
    { plan: "ENTERPRISE" as const, maxWatchlistItems: 10000, maxStrategyRunsDay: 10000,maxEtlJobsDay: 1000, maxCompaniesTracked: 10000, historicalQuarters: 200, apiAccess: true  },
  ];
  for (const p of planData) {
    await prisma.planLimit.upsert({ where: { plan: p.plan }, create: p, update: p });
  }
  console.log("  ✓ Plan limits");

  // ── 2. Users ──────────────────────────────────────────────────────────────
  const adminHash = await bcrypt.hash(adminPassword, 12);
  const demoHash  = await bcrypt.hash("Demo1234", 12);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    create: {
      email: adminEmail, name: adminName,
      passwordHash: adminHash, role: "ADMIN", emailVerified: new Date(),
      subscription: { create: { plan: "PRO", status: "ACTIVE" } },
    },
    update: { name: adminName, passwordHash: adminHash, role: "ADMIN" },
  });
  await prisma.subscription.upsert({
    where: { userId: admin.id },
    create: { userId: admin.id, plan: "PRO", status: "ACTIVE" },
    update: { plan: "PRO", status: "ACTIVE" },
  });

  const demo = await prisma.user.upsert({
    where: { email: "demo@marketlens.dev" },
    create: {
      email: "demo@marketlens.dev", name: "Demo User",
      passwordHash: demoHash, role: "USER", emailVerified: new Date(),
      subscription: { create: { plan: "FREE", status: "ACTIVE" } },
    },
    update: {},
  });
  console.log(`  ✓ Users (${adminEmail}/${adminPassword} + demo@marketlens.dev/Demo1234)`);

  // ── 3. Seed companies ─────────────────────────────────────────────────────
  const seedList = getSeedCompanyList();
  const companyIds: { ticker: string; id: string }[] = [];

  for (const { ticker } of seedList) {
    const profile  = generateMockCompanyProfile(ticker);
    const quarters = generateMockQuarters(ticker, 12);

    const company = await prisma.company.upsert({
      where: { ticker },
      create: {
        ticker, name: profile.name, sector: profile.sector, industry: profile.industry,
        exchange: profile.exchange, country: profile.country, description: profile.description,
        employeeCount: profile.employeeCount, source: "MOCK",
      },
      update: {},
    });
    companyIds.push({ ticker, id: company.id });

    for (const q of quarters) {
      await prisma.financialQuarter.upsert({
        where: { companyId_fiscalYear_fiscalQuarter: { companyId: company.id, fiscalYear: q.fiscalYear, fiscalQuarter: q.fiscalQuarter } },
        create: {
          companyId: company.id, fiscalYear: q.fiscalYear, fiscalQuarter: q.fiscalQuarter,
          periodEndDate: q.periodEndDate, revenue: q.revenue, costOfRevenue: q.costOfRevenue,
          grossProfit: q.grossProfit, operatingExpense: q.operatingExpense, operatingIncome: q.operatingIncome,
          netIncome: q.netIncome, ebitda: q.ebitda, eps: q.eps, sharesOutstanding: q.sharesOutstanding,
          totalAssets: q.totalAssets, totalLiabilities: q.totalLiabilities, totalEquity: q.totalEquity,
          currentAssets: q.currentAssets, currentLiabilities: q.currentLiabilities, cash: q.cash,
          totalDebt: q.totalDebt, longTermDebt: q.longTermDebt, inventory: q.inventory,
          receivables: q.receivables, operatingCashFlow: q.operatingCashFlow, capex: q.capex,
          freeCashFlow: q.freeCashFlow, dividendsPaid: q.dividendsPaid,
          closePrice: q.closePrice, volumeAvg: q.volumeAvg,
        },
        update: {},
      });
    }

    // Add first 5 to admin watchlist, first 2 to demo watchlist
    const idx = seedList.findIndex(c => c.ticker === ticker);
    if (idx < 5) {
      await prisma.watchlistItem.upsert({
        where: { userId_companyId: { userId: admin.id, companyId: company.id } },
        create: { userId: admin.id, companyId: company.id }, update: {},
      });
    }
    if (idx < 2) {
      await prisma.watchlistItem.upsert({
        where: { userId_companyId: { userId: demo.id, companyId: company.id } },
        create: { userId: demo.id, companyId: company.id }, update: {},
      });
    }
  }
  console.log(`  ✓ ${seedList.length} companies × 12 quarters (admin watching 5, demo watching 2)`);

  // ── 3b. Real market universe (NIFTY 50, SENSEX, global leaders) ──────────
  // These are real public constituents/market-cap snapshots. We create the
  // companies and deterministic mock financials so every watchlist ticker can
  // be opened and used with the strategy engine immediately.
  const universe = new Map<string, { name: string; sector: string; country: string; exchange: string }>();
  for (const c of NIFTY_50_CONSTITUENTS) {
    universe.set(c.symbol, { name: c.name, sector: c.sector, country: "India", exchange: "NSE" });
  }
  for (const c of SENSEX_CONSTITUENTS) {
    if (!universe.has(c.symbol)) {
      universe.set(c.symbol, { name: c.name, sector: c.sector, country: "India", exchange: "BSE" });
    }
  }
  for (const c of GLOBAL_TOP_10) {
    if (!universe.has(c.ticker)) {
      universe.set(c.ticker, { name: c.name, sector: "Global", country: c.country, exchange: "GLOBAL" });
    }
  }

  const universeIds: { ticker: string; id: string }[] = [];
  for (const [ticker, info] of universe) {
    const company = await prisma.company.upsert({
      where: { ticker },
      create: {
        ticker,
        name: info.name,
        sector: info.sector,
        industry: info.sector,
        exchange: info.exchange,
        country: info.country,
        description: `${info.name} (${ticker}) — constituent snapshot from ${MARKET_SNAPSHOT_META.retrievedAt}.`,
        source: "SNAPSHOT",
      },
      update: {},
    });
    universeIds.push({ ticker, id: company.id });

    for (const q of generateMockQuarters(ticker, 12)) {
      await prisma.financialQuarter.upsert({
        where: { companyId_fiscalYear_fiscalQuarter: { companyId: company.id, fiscalYear: q.fiscalYear, fiscalQuarter: q.fiscalQuarter } },
        create: {
          companyId: company.id, fiscalYear: q.fiscalYear, fiscalQuarter: q.fiscalQuarter,
          periodEndDate: q.periodEndDate, revenue: q.revenue, costOfRevenue: q.costOfRevenue,
          grossProfit: q.grossProfit, operatingExpense: q.operatingExpense, operatingIncome: q.operatingIncome,
          netIncome: q.netIncome, ebitda: q.ebitda, eps: q.eps, sharesOutstanding: q.sharesOutstanding,
          totalAssets: q.totalAssets, totalLiabilities: q.totalLiabilities, totalEquity: q.totalEquity,
          currentAssets: q.currentAssets, currentLiabilities: q.currentLiabilities, cash: q.cash,
          totalDebt: q.totalDebt, longTermDebt: q.longTermDebt, inventory: q.inventory,
          receivables: q.receivables, operatingCashFlow: q.operatingCashFlow, capex: q.capex,
          freeCashFlow: q.freeCashFlow, dividendsPaid: q.dividendsPaid,
          closePrice: q.closePrice, volumeAvg: q.volumeAvg,
        },
        update: {},
      });
    }
  }
  console.log(`  ✓ ${universeIds.length} real market-universe companies (NIFTY 50 + SENSEX + global top 10)`);

  // ── 4. Daily price bars (portfolio + risk analytics) ─────────────────────
  const priceTickers = [...seedList.map((c) => c.ticker), "SPY"];
  const barRows = priceTickers.flatMap((ticker) =>
    generateMockDailyBars(ticker, 500).map((b) => ({
      ticker,
      date: b.date,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      adjClose: b.adjClose,
      volume: b.volume,
      source: "MOCK" as const,
    }))
  );
  await prisma.priceBar.createMany({ data: barRows, skipDuplicates: true });
  console.log(`  ✓ ${barRows.length} daily price bars (${priceTickers.length} tickers incl. SPY)`);

  // ── 5. Strategy registry ──────────────────────────────────────────────────
  const strategies = [
    {
      slug: "piotroski-fscore-dupont",
      name: "Piotroski F-Score + DuPont Quality Screen",
      category: "Fundamental Quality",
      summary: "9-point fundamental quality screen layered with DuPont ROE decomposition.",
      methodology: "Evaluates 9 binary criteria (profitability, leverage, efficiency) and decomposes ROE into net margin × asset turnover × equity multiplier.",
      icon: "ClipboardCheck", sortOrder: 1, isPremium: false,
    },
    {
      slug: "altman-zscore",
      name: "Altman Z-Score",
      category: "Credit Risk",
      summary: "5-variable credit risk model predicting bankruptcy probability within 2 years.",
      methodology: "Z = 1.2·X1 + 1.4·X2 + 3.3·X3 + 0.6·X4 + 1.0·X5. Safe>2.99, Grey 1.81-2.99, Distress<1.81.",
      icon: "AlertTriangle", sortOrder: 2, isPremium: false,
    },
    {
      slug: "beneish-mscore",
      name: "Beneish M-Score",
      category: "Forensic Accounting",
      summary: "8-variable forensic model detecting earnings manipulation. Flagged Enron pre-collapse.",
      methodology: "8 indices: DSRI, GMI, AQI, SGI, DEPI, SGAI, LVGI, TATA. M>-2.22 signals possible manipulation.",
      icon: "Search", sortOrder: 3, isPremium: false,
    },
    {
      slug: "fama-french-five-factor",
      name: "Fama–French 5-Factor Scorecard",
      category: "Factor Models",
      summary: "Value, profitability, investment, size and momentum legs combined into one cross-sectional score.",
      methodology: "Each leg is scaled cross-sectionally and z-scored, then combined into the five-factor composite.",
      icon: "Layers", sortOrder: 4, isPremium: false,
    },
    {
      slug: "quality-minus-junk",
      name: "Quality Minus Junk (QMJ)",
      category: "Factor Models",
      summary: "Profitability, growth, safety and payout composite minus the matching junk composite.",
      methodology: "QMJ = z(profitability, growth, safety, payout) − z(low profitability, low payout).",
      icon: "ShieldCheck", sortOrder: 5, isPremium: false,
    },
    {
      slug: "magic-formula",
      name: "The Magic Formula",
      category: "Value & Momentum",
      summary: "Greenblatt's combined rank of return on capital and earnings yield.",
      methodology: "Rank by ROIC and by earnings yield, sum the ranks and buy the lowest combined rank.",
      icon: "Wand2", sortOrder: 6, isPremium: false,
    },
    {
      slug: "graham-defensive-investor",
      name: "Graham Defensive Investor Checklist",
      category: "Value & Momentum",
      summary: "Benjamin Graham's seven defensive-investor criteria, scored 0–7.",
      methodology: "Size, financial condition, earnings stability, dividend record, P/E, P/B and margin of safety.",
      icon: "BookOpen", sortOrder: 7, isPremium: false,
    },
    {
      slug: "momentum-12-1",
      name: "12−1 Month Momentum",
      category: "Value & Momentum",
      summary: "Intermediate-horizon momentum with a short-term reversal filter and volatility scaling.",
      methodology: "Formation-window return skipping the most recent period, scaled by realised volatility, with an earnings-quality check.",
      icon: "TrendingUp", sortOrder: 8, isPremium: false,
    },
    {
      slug: "dcf-valuation",
      name: "Discounted Cash Flow (FCFF) Valuation",
      category: "Valuation",
      summary: "Five-year FCFF DCF with CAPM-based WACC and a Gordon terminal value.",
      methodology: "FCFF = EBIT·(1−t) + D&A − CapEx − ΔNWC, discounted at WACC; score is the implied upside.",
      icon: "Calculator", sortOrder: 9, isPremium: false,
    },
  ];
  for (const s of strategies) {
    await prisma.strategy.upsert({ where: { slug: s.slug }, create: { ...s, isActive: true }, update: {} });
  }
  console.log("  ✓ 9 strategies registered");

  // ── 5. Index watchlists ───────────────────────────────────────────────────
  const indexLists = [
    { name: "NIFTY 50", description: `50 constituents from the NIFTY 50 index (snapshot ${MARKET_SNAPSHOT_META.retrievedAt}; source: Wikipedia).`, region: "IN", tickers: NIFTY_50_CONSTITUENTS.map(c => c.symbol) },
    { name: "BSE SENSEX", description: `30 constituents from the BSE SENSEX (snapshot ${MARKET_SNAPSHOT_META.retrievedAt}; source: Wikipedia).`, region: "IN", tickers: SENSEX_CONSTITUENTS.map(c => c.symbol) },
    { name: "Global Top 10 (Public)", description: `Top 10 publicly listed companies by market cap (snapshot ${MARKET_SNAPSHOT_META.retrievedAt}; source: companiesmarketcap.com). Private companies excluded.`, region: "GLOBAL", tickers: GLOBAL_TOP_10.map(c => c.ticker) },
    { name: "S&P 500 — Technology",  description: "Large-cap US technology sector", region: "US", tickers: ["AAPL","MSFT","NVDA","GOOGL","META","AVGO","ORCL","AMD","CSCO","INTC"] },
    { name: "S&P 500 — Healthcare",  description: "Large-cap US healthcare sector", region: "US", tickers: ["JNJ","UNH","LLY","ABBV","PFE","MRK","TMO","ABT","DHR","BMY"] },
    { name: "S&P 500 — Financials",  description: "Large-cap US financial sector",  region: "US", tickers: ["JPM","V","MA","BAC","WFC","GS","MS","BLK","SCHW","AXP"] },
    { name: "FTSE 100 — Select",     description: "Top UK large-cap stocks",        region: "UK", tickers: ["SHEL","AZN","HSBA","ULVR","BP","RIO","GSK","BATS","LSEG","BHP"] },
  ];
  // Remove the old curated list now that the full NIFTY 50 is bundled.
  await prisma.indexWatchlist.deleteMany({ where: { name: "NIFTY 50 — Select" } });
  for (const l of indexLists) {
    await prisma.indexWatchlist.upsert({ where: { name: l.name }, create: l, update: { description: l.description, region: l.region, tickers: l.tickers } });
  }
  console.log(`  ✓ ${indexLists.length} index watchlists (NIFTY 50, SENSEX, global top 10, sector lists)`);

  // ── 6. Sample analyst note for admin ─────────────────────────────────────
  const firstCompany = companyIds[0];
  if (firstCompany) {
    await prisma.analystNote.upsert({
      where: { id: "seed-note-1" } as any,
      create: {
        id: "seed-note-1",
        userId: admin.id,
        companyId: firstCompany.id,
        content: `Sample note for ${firstCompany.ticker}: Q2 FY2024 included a one-time restructuring charge of ~$12M. Adjust EBITDA upward when comparing YoY.`,
        pinned: true,
      },
      update: {},
    }).catch(() => {}); // ignore if id field conflict
    // If upsert by id fails, just create
    const noteCount = await prisma.analystNote.count({ where: { userId: admin.id } });
    if (noteCount === 0) {
      await prisma.analystNote.create({
        data: {
          userId: admin.id, companyId: firstCompany.id,
          content: `Sample note for ${firstCompany.ticker}: Q2 FY2024 included a one-time restructuring charge. Adjust EBITDA when comparing YoY.`,
          pinned: true,
        },
      });
    }
  }
  console.log("  ✓ Sample analyst note");

  // ── 7. Sample score alert for admin ──────────────────────────────────────
  if (firstCompany) {
    const alertCount = await prisma.scoreAlert.count({ where: { userId: admin.id } });
    if (alertCount === 0) {
      await prisma.scoreAlert.create({
        data: {
          userId: admin.id, companyId: firstCompany.id,
          strategySlug: "piotroski-fscore-dupont",
          condition: "SCORE_BELOW", threshold: 50,
          notifyEmail: true,
        },
      });
    }
  }
  console.log("  ✓ Sample score alert");

  // ── 8. Demo portfolio for the admin user ─────────────────────────────────
  const portfolioCount = await prisma.portfolio.count({ where: { userId: admin.id } });
  if (portfolioCount === 0 && companyIds.length >= 5) {
    const holdings = companyIds.slice(0, 5);
    const shares = holdings.map((_, i) => 100 * (i + 1));
    await prisma.portfolio.create({
      data: {
        userId: admin.id,
        name: "Core Growth",
        description: "Seeded portfolio used to demonstrate allocation, risk and attribution analytics.",
        baseCurrency: "USD",
        benchmarkTicker: "SPY",
        cashBalance: 25000,
        isDefault: true,
        positions: {
          create: holdings.map((h, i) => ({
            ticker: h.ticker,
            companyId: h.id,
            shares: shares[i],
          })),
        },
      },
    });
  }
  console.log("  ✓ Demo portfolio (Core Growth)");

  console.log("\n✅  Seed complete!\n");
  console.log(`  Admin:  ${admin.email}  / ${adminPassword}  (ADMIN, PRO plan)`);
  console.log(`  userId: ${admin.id}`);
  console.log("  Demo:   demo@marketlens.dev   / Demo1234   (FREE plan)\n");
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
