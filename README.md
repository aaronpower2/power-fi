# Power FI

Personal finance dashboard for net worth, cash flow, and financial-independence (FI) planning. You define a goal (FI date, withdrawal rate, lifestyle funding), track assets and liabilities in multiple currencies, run a monthly budget with optional bank/statement imports, and see whether projected savings can meet the goal.

Built with **Next.js 16**, **React 19**, **Drizzle ORM**, **PostgreSQL**, and **shadcn/ui**.

## What’s in the app

| Area | Route | Purpose |
|------|--------|---------|
| FI Summary | `/summary` | Goal status, net worth, months to FI, required portfolio, projection chart; reporting currency and active goal via query params. |
| Net Worth | `/net-worth` | Assets (categories, growth assumptions, per-asset currency, FI projection toggles), liabilities, allocation strategies and targets. |
| Cash Flow | `/cash-flow` | Income and expense lines, recurring rules, month finalize, surplus → investable allocation, transaction import workflow. |
| Goal | `/goal` | FI goal, withdrawal rate, lifestyle lines, currency; ties to budget categories where relevant. |

`/budget` and `/portfolio` redirect to `/cash-flow` and `/net-worth` for old bookmarks.

**Multi-currency:** balances and flows can be stored per line in ISO 4217 currencies; the UI can summarize in a chosen reporting currency using stored FX rates (Frankfurter/ECB). The dashboard layout refreshes FX on load; you can also sync via script or cron (see below).

**Single workspace:** one shared Postgres database (no per-user rows). Optional **front-door** access: set `SITE_PASSWORD` and `SITE_AUTH_SECRET` to require a shared password before any page (except `/login` and `/api/cron/*`). Anyone with the password sees the same data—fine for a household; rotate the password if it leaks.

## Prerequisites

- **Node.js** ≥ 20.9
- **PostgreSQL** (local or hosted)
- **pnpm** (lockfile is `pnpm-lock.yaml`)

## Setup

1. **Install dependencies**

   ```bash
   pnpm install
   ```

2. **Configure environment**

   Create `.env` and/or `.env.local` in the **project root** (next to `package.json`), not under `app/`. CLI tools (`db:migrate`, `db:seed`, `fx:sync`) load the same files via `lib/load-env.ts`.

   See **Environment variables** below.

3. **Create the database** (if it does not exist), then run migrations:

   ```bash
   pnpm db:migrate
   ```

4. **Optional seed data**

   ```bash
   pnpm db:seed
   ```

5. **Run the dev server**

   ```bash
   pnpm dev
   ```

   Open [http://localhost:3000](http://localhost:3000) (redirects to `/summary`).

If `DATABASE_URL` is unset, the app may still run but database-backed pages will not have a connection.

## Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | Yes (for real data) | PostgreSQL connection string. On Vercel/serverless hosts, pool size is tuned automatically when `VERCEL` is set. |
| `SITE_PASSWORD` | No | If set (with `SITE_AUTH_SECRET`), visitors must enter this shared password once per browser session (HttpOnly signed cookie). Omit locally if you prefer no gate. |
| `SITE_AUTH_SECRET` | With `SITE_PASSWORD` | Long random string used to sign the session cookie (e.g. `openssl rand -hex 32`). |
| `CRON_SECRET` | For scheduled FX | Protects `GET /api/cron/fx` (`Authorization: Bearer …` or `?secret=`). |
| `ANTHROPIC_API_KEY` | For AI-assisted import matching | Transaction import categorization/matching. |
| `ANTHROPIC_MODEL` | No | Defaults to a Sonnet model; see `lib/anthropic/import-matcher.ts`. |
| `ANTHROPIC_MATCH_MAX_OUTPUT_TOKENS` | No | Cap model output for matching. |
| `ANTHROPIC_MATCH_CONCURRENCY` | No | Parallel match requests. |
| `DEFAULT_IMPORT_CURRENCY` | No | Fallback currency for imports. |
| `IMPORT_FEW_SHOT_LIMIT` | No | Few-shot examples limit for matching. |
| `IMPORT_FILES_DIR` | No | Uploaded import files directory; default `.data/imports`. |

Copy `.env.example` when present for a starting template.

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Next.js dev server (Turbopack). |
| `pnpm build` / `pnpm start` | Production build and server. |
| `pnpm lint` / `pnpm typecheck` / `pnpm format` | Quality checks. |
| `pnpm test` | Node test runner on `lib/**/*.test.ts`. |
| `pnpm db:generate` | Generate Drizzle migrations from `lib/db/schema.ts`. |
| `pnpm db:migrate` | Apply migrations in `drizzle/`. |
| `pnpm db:push` | Push schema (Drizzle Kit; dev workflows). |
| `pnpm db:studio` | Drizzle Studio. |
| `pnpm db:seed` | Seed sample data. |
| `pnpm db:clear` | Clear database (destructive; review script before use). |
| `pnpm fx:sync` | Pull latest FX rates into `fx_rates` (Frankfurter). |

## UI components (shadcn)

This project uses [shadcn/ui](https://ui.shadcn.com/). To add a component:

```bash
pnpm dlx shadcn@latest add button
```

Components live under `components/ui/`.

## License

Private project (`"private": true` in `package.json`).
