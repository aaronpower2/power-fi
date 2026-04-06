import { z } from "zod"

/** Canonical buckets for assets (DB enum `asset_category`). */
export const ASSET_CATEGORY_VALUES = [
  "investment",
  "cash",
  "real_estate_primary",
  "real_estate_rental",
  "vehicle",
  "depreciating_other",
  "other",
] as const

export type AssetCategory = (typeof ASSET_CATEGORY_VALUES)[number]

export const assetCategorySchema = z.enum(ASSET_CATEGORY_VALUES)

export const ASSET_CATEGORY_LABELS: Record<AssetCategory, string> = {
  investment: "Investments (ETFs, brokerage, pension)",
  cash: "Cash & equivalents",
  real_estate_primary: "Real estate (primary home)",
  real_estate_rental: "Real estate (rental / investment property)",
  vehicle: "Vehicle",
  depreciating_other: "Depreciating (appliances, gear, other)",
  other: "Other",
}

/** Compact section titles for grouped tables (full labels stay in forms). */
export const ASSET_CATEGORY_GROUP_HEADINGS: Record<AssetCategory, string> = {
  investment: "Investments",
  cash: "Cash",
  real_estate_primary: "Primary home",
  real_estate_rental: "Rental property",
  vehicle: "Vehicles",
  depreciating_other: "Depreciating",
  other: "Other",
}

/** Default FI projection inclusion when picking a category (user can override in UI). */
export function defaultIncludeInFi(category: AssetCategory): boolean {
  switch (category) {
    case "investment":
    case "cash":
    case "real_estate_rental":
      return true
    case "real_estate_primary":
    case "vehicle":
    case "depreciating_other":
    case "other":
      return false
    default:
      return false
  }
}

/** Map legacy free-text asset_type to category for migrations / imports. */
export function inferAssetCategoryFromLegacyAssetType(assetType: string): AssetCategory {
  const t = assetType.trim().toLowerCase()
  if (t === "cash") return "cash"
  if (t === "equity" || t.includes("stock") || t.includes("etf") || t.includes("bond"))
    return "investment"
  if (t.includes("vehicle") || t.includes("car") || t === "auto") return "vehicle"
  if (t.includes("rental") || t.includes("investment property")) return "real_estate_rental"
  if (t.includes("real estate") || t.includes("home") || t.includes("primary"))
    return "real_estate_primary"
  if (t.includes("depreciat") || t.includes("appliance")) return "depreciating_other"
  return "other"
}
