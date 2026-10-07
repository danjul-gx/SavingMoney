/** Reject open-redirect vectors: must be a relative path, no protocol, no double-slash, no auth loops. */
export function isSafeRedirect(target: string): boolean {
  if (!target || !target.startsWith('/')) return false
  if (target.startsWith('//')) return false
  if (target.startsWith('/login') || target.startsWith('/signup')) return false
  // Block encoded protocol-relative (%2F%2F) or backslash tricks
  try {
    const decoded = decodeURIComponent(target)
    if (decoded.startsWith('//') || decoded.includes(':\\') || decoded.includes('://')) return false
  } catch {
    return false // malformed encoding
  }
  return true
}

/**
 * Resolves the application base URL with strict priority:
 * 1. Configured NEXT_PUBLIC_SITE_URL (trimmed, trailing slashes removed)
 * 2. In browser environments: window.location.origin
 * 3. Empty string if indeterminate (e.g. build time/server environment without env set)
 */
export function getSiteUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (envUrl) {
    return envUrl.replace(/\/+$/, '')
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin.replace(/\/+$/, '')
  }
  return ''
}

/**
 * Resolves the explicit Supabase auth confirmation callback URL.
 * Conceptually: configured site origin + '/auth/callback'
 */
export function getAuthCallbackUrl(): string {
  const siteUrl = getSiteUrl()
  return siteUrl ? `${siteUrl}/auth/callback` : '/auth/callback'
}
