import { getDb } from "@/lib/db"
import { syncFrankfurterLatest } from "@/lib/currency/sync"

/**
 * Daily FX sync for cron / external schedulers.
 * Set CRON_SECRET in env; call with header: Authorization: Bearer <CRON_SECRET>
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) {
    return Response.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 })
  }

  const auth = request.headers.get("authorization")
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : null
  const q = new URL(request.url).searchParams.get("secret")
  const token = bearer ?? q
  if (token !== secret) {
    return new Response("Unauthorized", { status: 401 })
  }

  const db = getDb()
  if (!db) {
    return Response.json({ ok: false, error: "Database not configured" }, { status: 503 })
  }

  const result = await syncFrankfurterLatest(db)
  if (!result.ok) {
    return Response.json({ ok: false, error: result.error }, { status: 502 })
  }

  return Response.json({
    ok: true,
    asOfDate: result.asOfDate,
    rowCount: result.rowCount,
  })
}
