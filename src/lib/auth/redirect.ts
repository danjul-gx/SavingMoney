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
