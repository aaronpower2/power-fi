import { z } from "zod"

/** Curated list for dropdowns (ISO 4217 codes Frankfurter typically supports) */
export const SUPPORTED_CURRENCIES = [
  "AED",
  "AUD",
  "CAD",
  "CHF",
  "CNY",
  "DKK",
  "EUR",
  "GBP",
  "HKD",
  "INR",
  "JPY",
  "KRW",
  "NOK",
  "NZD",
  "SEK",
  "SGD",
  "USD",
  "ZAR",
] as const

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number]

export const supportedCurrencySchema = z.enum(SUPPORTED_CURRENCIES)

export const FX_BASE_CURRENCY = "EUR" as const
