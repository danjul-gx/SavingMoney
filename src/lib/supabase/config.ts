export const FALLBACK_SUPABASE_URL = 'https://placeholder.supabase.co'
export const FALLBACK_SUPABASE_ANON_KEY = 'placeholder-anon-key'

/**
 * Resolves Supabase configuration with strict preference for valid environment variables.
 * Valid non-empty environment variables always take precedence over fallback values.
 */
export function getSupabaseConfig(): { url: string; anonKey: string; isFallback: boolean } {
  const envUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const envKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()

  const url = envUrl && envUrl.length > 0 ? envUrl : FALLBACK_SUPABASE_URL
  const anonKey = envKey && envKey.length > 0 ? envKey : FALLBACK_SUPABASE_ANON_KEY

  return {
    url,
    anonKey,
    isFallback: url === FALLBACK_SUPABASE_URL || anonKey === FALLBACK_SUPABASE_ANON_KEY,
  }
}
