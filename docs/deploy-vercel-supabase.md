# Deploy: Vercel + Supabase (Postgres)

This app only needs Postgres via `DATABASE_URL`. Supabase works the same way as any other Postgres host.

## 1. Supabase project

1. Sign up at [supabase.com](https://supabase.com) and open the [dashboard](https://supabase.com/dashboard).
2. **New project** → choose org, name, database password, and region (pick one close to you and to Vercel if you can).
3. Wait until the project finishes provisioning.

## 2. Connection strings

1. In the project: **Project Settings** (gear) → **Database**.
2. Under **Connection string**, choose the **URI** tab.
3. Copy the password into the URI when the dashboard prompts you.

Use two URLs from the same page:

| Where | What to use |
|--------|----------------|
| **Vercel (production)** | **Transaction pooler** (sometimes labeled “Transaction mode” / port **6543**). Better for serverless: fewer direct connections to Postgres. |
| **Local `pnpm db:migrate`** | **Direct connection** (port **5432**) is the most reliable for migrations. If that fails, try the same pooler URI you use on Vercel. |

Append `?sslmode=require` if your client or docs require it (many Supabase URIs already include compatible SSL settings).

## 3. Vercel

1. Import the Git repo in [Vercel](https://vercel.com) if you have not already.
2. **Settings → Environment Variables** → add **`DATABASE_URL`** with the **transaction pooler** URI for Production (and Preview/Development if you want).

## 4. Schema (first time)

With **`DATABASE_URL`** set to your Supabase DB (direct URI is fine for this step):

```bash
pnpm db:migrate
```

Optional:

```bash
pnpm db:seed
```

Redeploy on Vercel after migrations if the app deployed without a valid `DATABASE_URL` first.

## 5. Troubleshooting

- **IPv6 / connection errors from local machine:** Supabase’s direct host is IPv6-only on some plans. Use the **pooler** URI from the dashboard, enable the **IPv4 add-on** (paid) if Supabase offers it for your project, or run migrations from a network that supports IPv6.
- **`DbHandler` / auth errors:** Ensure the URI user and password match **Database** settings and that you did not truncate the password.
