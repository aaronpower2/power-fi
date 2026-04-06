"use client"

import { InfoTooltip } from "@/components/info-tooltip"
import { cn } from "@/lib/utils"

const contentMaxWidthClass = {
  "3xl": "max-w-3xl",
  "5xl": "max-w-5xl",
} as const

export function PageHeader({
  title,
  description,
  action,
  controls,
  className,
  /** Match the page shell (`max-w-5xl` vs `max-w-3xl` on the goal page). */
  contentMaxWidth = "5xl",
}: {
  title: string
  description?: string
  /** Primary actions aligned with the title row (e.g. “Add”, export). */
  action?: React.ReactNode
  /** Filters, search, period pickers, and other page-level controls — rendered in a floating bar below the title. */
  controls?: React.ReactNode
  className?: string
  contentMaxWidth?: keyof typeof contentMaxWidthClass
}) {
  return (
    <header
      className={cn(
        "sticky top-0 z-30 isolate shrink-0",
        className,
      )}
    >
      {/* Full-bleed background; inner column aligns with page content */}
      <div className="bg-background ml-[calc((100%-100cqw)/2)] w-[100cqw] max-w-none min-w-0 shrink-0 pb-3">
        <div
          className={cn(
            "mx-auto flex w-full min-w-0 flex-col gap-3",
            contentMaxWidthClass[contentMaxWidth],
          )}
        >
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
                "shadow-[0_3px_20px_-7px_rgb(0_0_0/0.13)] dark:shadow-[0_3px_20px_-7px_rgb(0_0_0/0.6)]",
              )}
              data-slot="page-controls"
            >
              {controls}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}
