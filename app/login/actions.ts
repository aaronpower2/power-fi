"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { SITE_SESSION_COOKIE, SITE_SESSION_MAX_AGE_SEC } from "@/lib/site-auth/constants"
import { createSessionToken } from "@/lib/site-auth/token"

function timingSafeEqualUtf8(a: string, b: string): boolean {
  const ae = new TextEncoder().encode(a)
  const be = new TextEncoder().encode(b)
  if (ae.length !== be.length) return false
  let r = 0
  for (let i = 0; i < ae.length; i++) r |= ae[i]! ^ be[i]!
  return r === 0
}

function safeNextPath(raw: string): string {
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/summary"
  return raw
}

export async function loginAction(
  _prev: { error?: string } | null,
  formData: FormData,
): Promise<{ error?: string }> {
  const sitePassword = process.env.SITE_PASSWORD?.trim()
  const authSecret = process.env.SITE_AUTH_SECRET?.trim()

  if (!sitePassword || !authSecret) {
    return { error: "Site access is not configured." }
  }

  const password = String(formData.get("password") ?? "")
  const next = safeNextPath(String(formData.get("next") ?? "/summary"))

  if (!timingSafeEqualUtf8(password, sitePassword)) {
    return { error: "Incorrect password." }
  }

  const token = await createSessionToken(authSecret)
  const cookieStore = await cookies()
  cookieStore.set(SITE_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SITE_SESSION_MAX_AGE_SEC,
  })

  redirect(next)
}

export async function signOut() {
  const cookieStore = await cookies()
  cookieStore.delete(SITE_SESSION_COOKIE)
  redirect("/login")
}
