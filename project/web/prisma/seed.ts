/**
 * MarketLens — Complete Seed Script
 * Run: npx tsx prisma/seed.ts
 *
 * Creates:
 *   - Plan limits (FREE / PRO / ENTERPRISE)
 *   - Admin user: admin@marketlens.dev / Admin1234  (PRO plan)
 *   - Demo user:  demo@marketlens.dev / Demo1234    (FREE plan)
 *   - 10 seed companies × 12 quarters each
 *   - 3 strategy registry rows
 *   - 5 index watchlists
 *   - Sample alert + analyst note for admin
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { getSeedCompanyList, generateMockCompanyProfile, generateMockQuarters } from "../lib/mock-data";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱  Seeding MarketLens database…\n");

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
  const adminHash = await bcrypt.hash("Admin1234", 12);
  const demoHash  = await bcrypt.hash("Demo1234", 12);

  const admin = await prisma.user.upsert({
    where: { email: "admin@marketlens.dev" },
    create: {
      email: "admin@marketlens.dev", name: "Demo Admin",
      passwordHash: adminHash, role: "ADMIN", emailVerified: new Date(),
      subscription: { create: { plan: "PRO", status: "ACTIVE" } },
    },
    update: {},
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
  console.log("  ✓ Users (admin@marketlens.dev/Admin1234 + demo@marketlens.dev/Demo1234)");

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

  // ── 4. Strategy registry ──────────────────────────────────────────────────
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
  ];
  for (const s of strategies) {
    await prisma.strategy.upsert({ where: { slug: s.slug }, create: { ...s, isActive: true }, update: {} });
  }
  console.log("  ✓ 3 strategies registered");

  // ── 5. Index watchlists ───────────────────────────────────────────────────
  const indexLists = [
    { name: "S&P 500 — Technology",  description: "Large-cap US technology sector", region: "US", tickers: ["AAPL","MSFT","NVDA","GOOGL","META","AVGO","ORCL","AMD","CSCO","INTC"] },
    { name: "S&P 500 — Healthcare",  description: "Large-cap US healthcare sector", region: "US", tickers: ["JNJ","UNH","LLY","ABBV","PFE","MRK","TMO","ABT","DHR","BMY"] },
    { name: "S&P 500 — Financials",  description: "Large-cap US financial sector",  region: "US", tickers: ["JPM","V","MA","BAC","WFC","GS","MS","BLK","SCHW","AXP"] },
    { name: "NIFTY 50 — Select",     description: "Top Indian large-cap stocks",    region: "IN", tickers: ["RELIANCE","TCS","HDFCBANK","INFY","ICICIBANK","HINDUNILVR","ITC","SBIN","BHARTIARTL","BAJFINANCE"] },
    { name: "FTSE 100 — Select",     description: "Top UK large-cap stocks",        region: "UK", tickers: ["SHEL","AZN","HSBA","ULVR","BP","RIO","GSK","BATS","LSEG","BHP"] },
  ];
  for (const l of indexLists) {
    await prisma.indexWatchlist.upsert({ where: { name: l.name }, create: l, update: {} });
  }
  console.log("  ✓ 5 index watchlists");

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

  console.log("\n✅  Seed complete!\n");
  console.log("  Admin:  admin@marketlens.dev  / Admin1234  (PRO plan)");
  console.log("  Demo:   demo@marketlens.dev   / Demo1234   (FREE plan)\n");
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
