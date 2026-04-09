"use client"

import * as React from "react"

import { Input } from "@/components/ui/input"

type NumericValue = number | string | null | undefined

type BaseNumericInputProps = Omit<
  React.ComponentProps<typeof Input>,
  "type" | "value" | "defaultValue" | "onChange" | "inputMode"
> & {
  value?: NumericValue
  onValueChange?: (value: number | "") => void
}

function toNumber(value: NumericValue): number | null {
  if (value == null || value === "") return null
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function formatInteger(value: NumericValue): string {
  const parsed = toNumber(value)
  return parsed == null ? "" : Math.round(parsed).toLocaleString("en-US")
}

function toEditableInteger(value: NumericValue): string {
  const parsed = toNumber(value)
  return parsed == null ? "" : String(Math.round(parsed))
}

function sanitizeIntegerInput(value: string): string {
  const stripped = value.replace(/[^\d-]/g, "")
  if (stripped === "") return ""
  const isNegative = stripped.startsWith("-")
  const digits = stripped.replace(/-/g, "")
  return `${isNegative ? "-" : ""}${digits}`
}

function roundToSingleDecimal(value: number): number {
  return Math.round(value * 10) / 10
}

function formatPercent(value: NumericValue): string {
  const parsed = toNumber(value)
  return parsed == null ? "" : roundToSingleDecimal(parsed).toFixed(1)
}

function toEditablePercent(value: NumericValue): string {
  const parsed = toNumber(value)
  return parsed == null ? "" : String(roundToSingleDecimal(parsed))
}

function sanitizePercentInput(value: string): string {
  const stripped = value.replace(/[^\d.]/g, "")
  const dot = stripped.indexOf(".")
  if (dot === -1) return stripped
  return `${stripped.slice(0, dot + 1)}${stripped.slice(dot + 1).replace(/\./g, "")}`
}

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100
}

function formatMoney(value: NumericValue): string {
  const parsed = toNumber(value)
  if (parsed == null) return ""
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(roundToTwoDecimals(parsed))
}

function toEditableMoney(value: NumericValue): string {
  const parsed = toNumber(value)
  if (parsed == null) return ""
  return String(roundToTwoDecimals(parsed))
}

function sanitizeMoneyInput(value: string): string {
  const stripped = value.replace(/[^\d.-]/g, "")
  if (stripped === "") return ""
  const isNegative = stripped.startsWith("-")
  const unsigned = stripped.replace(/-/g, "")
  const dot = unsigned.indexOf(".")
  const normalized =
    dot === -1
      ? unsigned
      : `${unsigned.slice(0, dot + 1)}${unsigned.slice(dot + 1).replace(/\./g, "")}`
  return `${isNegative ? "-" : ""}${normalized}`
}

export const IntegerInput = React.forwardRef<HTMLInputElement, BaseNumericInputProps>(
  ({ value, onValueChange, onBlur, onFocus, ...props }, ref) => {
    const [focused, setFocused] = React.useState(false)
    const [text, setText] = React.useState(() => formatInteger(value))

    React.useEffect(() => {
      if (!focused) setText(formatInteger(value))
    }, [focused, value])

    return (
      <Input
        {...props}
        ref={ref}
        type="text"
        inputMode="numeric"
        value={focused ? text : formatInteger(value)}
        onFocus={(e) => {
          setFocused(true)
          setText(toEditableInteger(value))
          onFocus?.(e)
        }}
        onChange={(e) => {
          const next = sanitizeIntegerInput(e.target.value)
          setText(next)
          if (next === "" || next === "-") {
            onValueChange?.("")
            return
          }
          const parsed = Number.parseInt(next, 10)
          if (Number.isFinite(parsed)) onValueChange?.(parsed)
        }}
        onBlur={(e) => {
          const next = sanitizeIntegerInput(text)
          if (next === "" || next === "-") {
            onValueChange?.("")
            setText("")
          } else {
            const parsed = Number.parseInt(next, 10)
            if (Number.isFinite(parsed)) {
              onValueChange?.(parsed)
              setText(parsed.toLocaleString("en-US"))
            }
          }
          setFocused(false)
          onBlur?.(e)
        }}
      />
    )
  },
)

IntegerInput.displayName = "IntegerInput"

export const PercentInput = React.forwardRef<HTMLInputElement, BaseNumericInputProps>(
  ({ value, onValueChange, onBlur, onFocus, ...props }, ref) => {
    const [focused, setFocused] = React.useState(false)
    const [text, setText] = React.useState(() => formatPercent(value))

    React.useEffect(() => {
      if (!focused) setText(formatPercent(value))
    }, [focused, value])

    return (
      <Input
        {...props}
        ref={ref}
        type="text"
        inputMode="decimal"
        value={focused ? text : formatPercent(value)}
        onFocus={(e) => {
          setFocused(true)
          setText(toEditablePercent(value))
          onFocus?.(e)
        }}
        onChange={(e) => {
          const next = sanitizePercentInput(e.target.value)
          setText(next)
          if (next === "" || next === ".") {
            onValueChange?.("")
            return
          }
          const parsed = Number(next)
          if (Number.isFinite(parsed)) onValueChange?.(parsed)
        }}
        onBlur={(e) => {
          const next = sanitizePercentInput(text)
          if (next === "" || next === ".") {
            onValueChange?.("")
            setText("")
          } else {
            const parsed = Number(next)
            if (Number.isFinite(parsed)) {
              const rounded = roundToSingleDecimal(parsed)
              onValueChange?.(rounded)
              setText(rounded.toFixed(1))
            }
          }
          setFocused(false)
          onBlur?.(e)
        }}
      />
    )
  },
)

PercentInput.displayName = "PercentInput"

export const DecimalMoneyInput = React.forwardRef<HTMLInputElement, BaseNumericInputProps>(
  ({ value, onValueChange, onBlur, onFocus, ...props }, ref) => {
    const [focused, setFocused] = React.useState(false)
    const [text, setText] = React.useState(() => formatMoney(value))

    React.useEffect(() => {
      if (!focused) setText(formatMoney(value))
    }, [focused, value])

    return (
      <Input
        {...props}
        ref={ref}
        type="text"
        inputMode="decimal"
        value={focused ? text : formatMoney(value)}
        onFocus={(e) => {
          setFocused(true)
          setText(toEditableMoney(value))
          onFocus?.(e)
        }}
        onChange={(e) => {
          const next = sanitizeMoneyInput(e.target.value)
          setText(next)
          if (next === "" || next === "-" || next === "." || next === "-.") {
            onValueChange?.("")
            return
          }
          const parsed = Number(next)
          if (Number.isFinite(parsed)) onValueChange?.(parsed)
        }}
        onBlur={(e) => {
          const next = sanitizeMoneyInput(text)
          if (next === "" || next === "-" || next === "." || next === "-.") {
            onValueChange?.("")
            setText("")
          } else {
            const parsed = Number(next)
            if (Number.isFinite(parsed)) {
              const rounded = roundToTwoDecimals(parsed)
              onValueChange?.(rounded)
              setText(formatMoney(rounded))
            }
          }
          setFocused(false)
          onBlur?.(e)
        }}
      />
    )
  },
)

DecimalMoneyInput.displayName = "DecimalMoneyInput"
