import { syncFxOnDashboardLoad } from "@/lib/currency/sync"
import { getDb } from "@/lib/db"
import { DashboardShell } from "@/components/dashboard-shell"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const db = getDb()
  if (db) {
    await syncFxOnDashboardLoad(db)
  }
  return <DashboardShell>{children}</DashboardShell>
}
