import { SITE_SESSION_MAX_AGE_SEC } from "./constants"

function base64urlEncode(bytes: Uint8Array): string {
  let bin = ""
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  const b64 = btoa(bin)
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function base64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4))
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  )
}

export async function createSessionToken(authSecret: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SITE_SESSION_MAX_AGE_SEC
  const payload = JSON.stringify({ exp })
  const payloadBytes = new TextEncoder().encode(payload)
  const key = await importHmacKey(authSecret)
  const sig = await crypto.subtle.sign("HMAC", key, payloadBytes)
  return `${base64urlEncode(payloadBytes)}.${base64urlEncode(new Uint8Array(sig))}`
}

export async function verifySessionToken(
  token: string,
  authSecret: string,
): Promise<boolean> {
  const parts = token.split(".")
  if (parts.length !== 2) return false
  const [payloadB64, sigB64] = parts
  if (!payloadB64 || !sigB64) return false

  let payloadBytes: Uint8Array
  let sigBytes: Uint8Array
  try {
    payloadBytes = base64urlDecode(payloadB64)
    sigBytes = base64urlDecode(sigB64)
  } catch {
    return false
  }

  let exp: number
  try {
    const p = JSON.parse(new TextDecoder().decode(payloadBytes)) as { exp?: unknown }
    if (typeof p.exp !== "number") return false
    exp = p.exp
  } catch {
    return false
  }

  if (exp < Math.floor(Date.now() / 1000)) return false

  const key = await importHmacKey(authSecret)
  const sigCopy = new Uint8Array(sigBytes)
  const payloadCopy = new Uint8Array(payloadBytes)
  return crypto.subtle.verify("HMAC", key, sigCopy, payloadCopy)
}
