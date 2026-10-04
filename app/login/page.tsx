'use client'

import { useState, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

import { Wallet, AlertTriangle } from 'lucide-react'
import { ThemeToggle } from '@/lib/theme/ThemeToggle'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get('redirectTo') || '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (isLoading) return

    setErrorMsg(null)

    // Client-side validation
    if (!email.trim() || !password) {
      setErrorMsg('Email dan password wajib diisi.')
      return
    }

    setIsLoading(true)

    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })

      if (error) {
        if (error.message.toLowerCase().includes('invalid login credentials')) {
          setErrorMsg('Email atau password salah.')
        } else {
          setErrorMsg(error.message)
        }
        setIsLoading(false)
        return
      }

      // Success -> navigate to target destination or home
      router.push(redirectTo.startsWith('/') ? redirectTo : '/')
      router.refresh()
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Terjadi kesalahan saat masuk.')
      setIsLoading(false)
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-8 safe-x">
      <div className="relative w-full max-w-sm rounded-3xl bg-surface border border-border p-6 shadow-sm flex flex-col gap-6">
        <div className="absolute right-4 top-4">
          <ThemeToggle />
        </div>
        {/* Header */}
        <div className="flex flex-col items-center text-center gap-2">

          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20">
            <Wallet size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-text-base">Masuk ke Akun</h1>
            <p className="text-xs text-text-muted mt-0.5">
              Savings &amp; Cashflow Tracker — kelola keuangan dengan tenang.
            </p>
          </div>
        </div>

        {/* Error alert */}
        {errorMsg && (
          <div
            role="alert"
            className="rounded-xl bg-danger/10 border border-danger/20 p-3 text-xs text-danger font-medium flex items-center gap-2"
          >
            <AlertTriangle size={16} className="shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="login-email"
              className="text-xs font-semibold text-text-base"
            >
              Email
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              required
              disabled={isLoading}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nama@email.com"
              className="w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm text-text-base outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="login-password"
              className="text-xs font-semibold text-text-base"
            >
              Password
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              required
              disabled={isLoading}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm text-text-base outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="mt-2 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-text-inverse shadow-sm transition active:scale-[0.99] hover:opacity-95 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                <span>Memproses...</span>
              </>
            ) : (
              <span>Masuk</span>
            )}
          </button>
        </form>

        {/* Footer link */}
        <div className="text-center text-xs text-text-muted">
          Belum punya akun?{' '}
          <Link
            href="/signup"
            className="font-semibold text-primary hover:underline underline-offset-4"
          >
            Daftar sekarang
          </Link>
        </div>
      </div>
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-dvh flex-col items-center justify-center p-4">
          <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  )
}

