import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSafeRedirect } from '@/lib/auth/redirect'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next')

  // Resolve target application destination safely: default to root /
  const destination = next && isSafeRedirect(next) ? next : '/'

  if (code) {
    try {
      const supabase = await createClient()
      const { error } = await supabase.auth.exchangeCodeForSession(code)

      if (!error) {
        return NextResponse.redirect(new URL(destination, origin))
      }

      console.error('Auth callback exchangeCodeForSession error:', error.message)
    } catch (err) {
      console.error('Unexpected auth callback error:', err)
    }
  }

  // If code is missing or exchange failed, redirect safely to login with error parameter
  const loginUrl = new URL('/login', origin)
  loginUrl.searchParams.set('error', 'auth_callback_failed')
  return NextResponse.redirect(loginUrl)
}
