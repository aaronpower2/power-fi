import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"

import * as schema from "./schema"

const globalForDb = globalThis as unknown as {
  pool: Pool | undefined
}

function getConnectionString(): string | undefined {
  return process.env.DATABASE_URL
}

function poolOptions(connectionString: string): ConstructorParameters<typeof Pool>[0] {
  // Vercel runs many short-lived Node processes; use a small pool and a host’s
  // serverless-friendly URL (e.g. Supabase transaction pooler, port 6543).
  const serverless = Boolean(process.env.VERCEL)
  return {
    connectionString,
    max: serverless ? 1 : 10,
    idleTimeoutMillis: serverless ? 20_000 : 30_000,
    connectionTimeoutMillis: 10_000,
  }
}

export function getPool(): Pool | null {
  const url = getConnectionString()
  if (!url) return null
  if (!globalForDb.pool) {
    globalForDb.pool = new Pool(poolOptions(url))
  }
  return globalForDb.pool
}

export function getDb() {
  const pool = getPool()
  if (!pool) return null
  return drizzle(pool, { schema })
}
