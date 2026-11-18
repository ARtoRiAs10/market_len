# Deploying MarketLens to Vercel

The repository is a monorepo:

```
project/web   → Next.js 14 app        → deploy to Vercel
project/api   → FastAPI ETL service   → deploy to Fly.io / Render / Railway
project/ml    → QuantLab research lab → runs offline, not deployed
```

Vercel hosts **only the Next.js app**. The FastAPI ETL microservice needs a
long-running Python host (see the end of this document).

---

## 1. Database (Neon Postgres)

1. Create a project at [console.neon.tech](https://console.neon.tech).
2. Copy the **pooled** connection string → `DATABASE_URL`
   (ends with `?sslmode=require&pgbouncer=true`).
3. Copy the **direct** connection string → `DIRECT_URL`.
4. Apply the schema to the production database:

```bash
cd project/web
# put the Neon URLs in .env (or export them)
npx prisma db push          # creates all tables (Portfolio, PriceBar, …)
npm run db:seed             # optional: demo users, companies, price bars, a portfolio
```

> The project ships `prisma/schema.prisma` without a migration history, so
> `prisma db push` is the supported way to evolve the schema. If you later
> switch to `prisma migrate`, run `npm run db:migrate` locally and
> `npx prisma migrate deploy` in CI.

---

## 2. Import the project into Vercel

```bash
npm i -g vercel
cd project/web
vercel            # preview deployment
vercel --prod     # production deployment
```

Or via the dashboard: **Add New → Project → Import** the Git repository, then
set:

| Setting | Value |
|---|---|
| Framework preset | Next.js (auto-detected) |
| **Root directory** | `project/web` |
| Install command | `npm install` (default) |
| Build command | `npm run build` (default — runs `prisma generate && next build`) |
| Output directory | `.next` (default) |
| Node version | 20.x (`NODE_VERSION` env var or `engines` in package.json) |

The root directory **must** be `project/web` — the repository root has no
`package.json`, so Vercel cannot detect the framework otherwise.

`project/web/vercel.json` pins the Next.js framework, uses `npm ci`, and gives
the API routes a 60-second function budget. The build script runs
`prisma generate && next build`.

`postinstall: prisma generate` runs automatically, so the Prisma client is
always in sync with the schema.

---

## 3. Environment variables

Add these in **Project → Settings → Environment Variables**.

### Required

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Neon pooled URL |
| `DIRECT_URL` | Neon direct URL |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |

`NEXTAUTH_URL` is optional on Vercel: the app automatically uses Vercel's
`VERCEL_URL` when it is not set. Set it if you use a custom domain.

### Optional

| Variable | Notes |
|---|---|
| `NEXTAUTH_URL` | `https://your-app.vercel.app` (or your custom domain) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth login |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Razorpay billing |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay webhook signing secret |
| `RAZORPAY_PLAN_PRO_MONTHLY` | Razorpay plan ID |
| `RAZORPAY_PLAN_PRO_YEARLY` | Razorpay plan ID |
| `RAZORPAY_PLAN_ENTERPRISE_MONTHLY` | Razorpay plan ID (optional) |
| `OPENROUTER_API_KEY` | AI Analyst (200+ models) |
| `ANTHROPIC_API_KEY` | alternative AI provider |
| `RESEND_API_KEY` / `EMAIL_FROM` | weekly digest email |
| `MARKET_DATA_PROVIDER` | `MOCK` (default), `ALPHA_VANTAGE` or `FMP` |
| `ALPHA_VANTAGE_API_KEY` / `FMP_API_KEY` | needed for the live providers |
| `ETL_SERVICE_URL` / `ETL_SERVICE_API_KEY` | only if you deploy the FastAPI service (below) |

**Razorpay is optional.** If you leave the Razorpay variables blank, the rest
of the app runs normally and the billing endpoints return `503` with a clear
message instead of crashing. The legacy Stripe fields/routes are kept but are
not used by the billing UI.

`lib/env.ts` validates the required set lazily and prints exactly which
variables are missing, so a misconfiguration shows up immediately in the
Vercel function logs.

---

## 4. Post-deploy steps

1. **Auth callback** — add the Vercel domain to your Google OAuth client's
   authorised redirect URIs:
   `https://your-app.vercel.app/api/auth/callback/google`.
2. **Razorpay webhook** — point it at
   `https://your-app.vercel.app/api/razorpay/webhook`
   and copy the signing secret into `RAZORPAY_WEBHOOK_SECRET`.

   Razorpay billing setup:
   1. Create three subscription plans in Razorpay Dashboard → Subscriptions → Plans
      (Pro monthly, Pro yearly, optional Enterprise monthly).
   2. Copy the plan IDs into `RAZORPAY_PLAN_PRO_MONTHLY`,
      `RAZORPAY_PLAN_PRO_YEARLY`, and `RAZORPAY_PLAN_ENTERPRISE_MONTHLY`.
   3. Copy the Key ID / Key Secret into `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`.
   4. Add the webhook URL above and select the subscription events.

   If the Razorpay variables are blank, the app still works and the billing
   buttons return a clear "Razorpay is not configured" message.
3. **Seed the database** (optional):
   ```bash
   cd project/web
   vercel env pull .env.production
   npx tsx prisma/seed.ts        # demo users, companies, price bars, portfolio
   ```

   To create only the test admin login (no demo data), run:

   ```bash
   npm run db:admin
   ```

   Defaults: `admin@marketlens.dev` / `Admin1234` (role `ADMIN`, PRO plan).
   Override with `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME`
   and `SEED_ADMIN_PLAN`. The script resets the password on every run, so it
   is safe to re-run after a fresh database deploy.
4. **Custom domain** — Project → Settings → Domains → Add
   `marketlens.example.com`; update `NEXTAUTH_URL` to match and redeploy.

---

## 5. The FastAPI ETL microservice (optional)

The ETL page (`/dashboard/etl`) drives the Python service in `project/api`.
Everything else in the app works without it, because the web app has its own
market-data providers and the mock provider is the default.

Deploy it to any Python host, e.g. Fly.io:

```bash
cd project/api
fly launch --no-deploy --name marketlens-etl
fly deploy
fly secrets set API_KEY=… CORS_ORIGINS='["https://your-app.vercel.app"]' MARKET_DATA_PROVIDER=MOCK
```

Then set in Vercel: `ETL_SERVICE_URL=https://marketlens-etl.fly.dev` and
`ETL_SERVICE_API_KEY` to the same `API_KEY`.

The service calls back into the app at
`https://your-app.vercel.app/api/etl/{jobId}/callback` — that URL is derived
from the request, so no extra configuration is needed, but the app's
`/api/etl/[jobId]/callback` route must be reachable from the public internet.

---

## 6. Local verification before pushing

```bash
cd project/web
npx tsc --noEmit          # type check
npm run build             # production build
npm run smoke             # quant engine sanity check (no DB needed)
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| *"No projects found"* / framework not detected | Set the Root Directory to `project/web`. |
| `DATABASE_URL is not set` at runtime | Add the env var in Vercel (Production + Preview) and redeploy. |
| Prisma "table does not exist" | Run `npx prisma db push` against the production database. |
| Auth redirect loops | `NEXTAUTH_URL` must match the deployed origin exactly, including `https://` and no trailing slash. |
| `Invalid environment variables` in the logs | `lib/env.ts` lists the missing keys — add them and redeploy. |
| Build timeout | The build takes ~1–2 min (`prisma generate` + `next build`); on the Hobby plan, upgrade to Pro for a larger build budget. |
| `AI Analyst returns 502` | `OPENROUTER_API_KEY` is missing (the route returns a clear 502 when it is not set). |
| `Build fails in next/font` | Fonts are now self-hosted from `public/fonts`; if you added a Google Font, remove it or vendor the `.woff2` files. |
