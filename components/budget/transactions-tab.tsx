import { FileSearch } from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export function TransactionsTab() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">
              <FileSearch className="size-5" aria-hidden />
            </div>
            <div className="min-w-0 space-y-1">
              <CardTitle className="text-base">Bank & card statements</CardTitle>
              <CardDescription>
                Upload CSV or PDF exports from your bank, then search and filter transactions here. Upload and
                search are not wired up yet—this tab is the home for that workflow.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          <p>
            Next steps: statement upload, parsing, and a queryable ledger tied to your budget month or custom
            ranges.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
