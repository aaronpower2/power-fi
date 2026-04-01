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
    <header
      className={cn(
        "sticky top-0 z-30 flex shrink-0 flex-col gap-3",
        className,
      )}
    >
      {/* Full-width title row — not part of the floating toolbar; masks scrolling content */}
      <div
        className={cn(
          "w-full bg-background/95 pb-3 backdrop-blur-md dark:bg-background/95",
          "supports-backdrop-filter:bg-background/88 dark:supports-backdrop-filter:bg-background/88",
        )}
      >
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
            "rounded-xl border border-border/80 bg-background/85 px-3 py-2.5 shadow-md",
            "ring-1 ring-black/5 backdrop-blur-md dark:bg-background/80 dark:ring-white/10",
            "supports-backdrop-filter:bg-background/72 dark:supports-backdrop-filter:bg-background/60",
          )}
          data-slot="page-controls"
        >
          {controls}
        </div>
      ) : null}
    </header>
  )
}
