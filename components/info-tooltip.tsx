"use client"

import type { ReactNode } from "react"
import { HelpCircle } from "lucide-react"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export function InfoTooltip({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            "text-muted-foreground hover:text-foreground inline-flex size-6 shrink-0 items-center justify-center rounded-md",
            className,
          )}
          aria-label="Details"
        >
          <HelpCircle className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-pretty">
        {children}
      </TooltipContent>
    </Tooltip>
  )
}

/** Use inside CardHeader: wrap CardTitle + optional info icon row. */
export function CardHeaderTitleRow({
  title,
  titleClassName,
  info,
}: {
  title: ReactNode
  titleClassName?: string
  info: ReactNode
}) {
  return (
    <div className="flex items-center gap-1.5">
      <div className={cn("min-w-0 flex-1", titleClassName)}>{title}</div>
      <InfoTooltip>{info}</InfoTooltip>
    </div>
  )
}
