import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

import { SITE_SESSION_COOKIE } from "@/lib/site-auth/constants"
import { verifySessionToken } from "@/lib/site-auth/token"

function isPublicPath(pathname: string): boolean {
  if (pathname.startsWith("/login")) return true
  if (pathname.startsWith("/_next")) return true
  if (pathname === "/favicon.ico") return true
  if (pathname.startsWith("/api/cron")) return true
  return false
}

export async function middleware(request: NextRequest) {
  const sitePassword = process.env.SITE_PASSWORD?.trim()
  if (!sitePassword) {
    return NextResponse.next()
  }

  const authSecret = process.env.SITE_AUTH_SECRET?.trim()
  const { pathname } = request.nextUrl

  if (!authSecret) {
    if (pathname.startsWith("/login")) {
      return NextResponse.next()
    }
    return new NextResponse(
      "SITE_AUTH_SECRET is required when SITE_PASSWORD is set. Add it in your host environment.",
      { status: 503 },
    )
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next()
  }

  const cookie = request.cookies.get(SITE_SESSION_COOKIE)?.value
  if (!cookie || !(await verifySessionToken(cookie, authSecret))) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    url.searchParams.set("next", `${pathname}${request.nextUrl.search}`)
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
}
