export type AssetLinkToManage = {
  /** External URL to open the platform (broker, bank, etc.). */
  url?: string
  /** Short label shown in the UI (e.g. “Vanguard”, “IBKR”). */
  label?: string
  /** Where credentials live (e.g. “1Password vault X”, “hardware key”) — not stored encrypted. */
  credentialsHint?: string
}

export type AssetMeta = {
  linkToManage?: AssetLinkToManage
}

export function parseAssetMeta(raw: unknown): AssetMeta {
  if (!raw || typeof raw !== "object") return {}
  const o = raw as Record<string, unknown>
  const lm = o.linkToManage
  if (!lm || typeof lm !== "object") return {}
  const L = lm as Record<string, unknown>
  const url = typeof L.url === "string" ? L.url.trim() : undefined
  const label = typeof L.label === "string" ? L.label.trim() : undefined
  const credentialsHint =
    typeof L.credentialsHint === "string" ? L.credentialsHint.trim() : undefined
  if (!url && !label && !credentialsHint) return {}
  return {
    linkToManage: {
      ...(url ? { url } : {}),
      ...(label ? { label } : {}),
      ...(credentialsHint ? { credentialsHint } : {}),
    },
  }
}
