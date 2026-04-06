/** HttpOnly cookie holding a signed session token (not the raw password). */
export const SITE_SESSION_COOKIE = "power_fi_site_session"

/** Align cookie max-age with payload `exp` in `token.ts`. */
export const SITE_SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30
