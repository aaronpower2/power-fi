"use client"

import { InfoTooltip } from "@/components/info-tooltip"
import { cn } from "@/lib/utils"

export function PageHeader({
  title,
  description,
  action,
  controls,
  className,
}: {
  title: string
  description?: string
  /** Primary actions aligned with the title row (e.g. “Add”, export). */
  action?: React.ReactNode
  /** Filters, search, period pickers, and other page-level controls — rendered in a floating bar below the title. */
  controls?: React.ReactNode
  className?: string
}) {
  return (
    <header className={cn("sticky top-0 z-30 shrink-0", className)}>
      {/* Solid backing for the whole sticky region (title + gap + toolbar) so nothing shows through */}
      <div className="bg-background flex flex-col gap-3 pb-3">
        <div className="w-full">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h1 className="font-heading text-foreground text-2xl font-semibold tracking-tight">
                  {title}
                </h1>
                {description ? <InfoTooltip>{description}</InfoTooltip> : null}
              </div>
            </div>
            {action ? <div className="shrink-0">{action}</div> : null}
          </div>
        </div>

        {controls != null ? (
          <div
            className={cn(
              "flex flex-wrap items-center gap-2 sm:gap-3",
              "rounded-xl border border-border/80 bg-background px-3 py-2.5",
            )}
            data-slot="page-controls"
          >
            {controls}
          </div>
        ) : null}
      </div>
    </header>
  )
}
