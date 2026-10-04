'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

import { Wallet, CheckCircle2, AlertTriangle } from 'lucide-react'
import { ThemeToggle } from '@/lib/theme/ThemeToggle'

export default function SignupPage() {
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [isSuccess, setIsSuccess] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (isLoading) return

    setErrorMsg(null)

    // Validation
    if (!email.trim() || !password) {
      setErrorMsg('Email dan password wajib diisi.')
      return
    }

    if (password.length < 6) {
      setErrorMsg('Password minimal 6 karakter.')
      return
    }

    if (password !== confirmPassword) {
      setErrorMsg('Konfirmasi password tidak cocok.')
      return
    }

    setIsLoading(true)

    try {
      const supabase = createClient()
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            display_name: displayName.trim() || undefined,
          },
        },
      })

      if (error) {
        setErrorMsg(error.message)
        setIsLoading(false)
        return
      }

      // If user is created, create their profile record explicitly if session exists immediately
      if (data.user) {
        try {
          await supabase.from('profiles').upsert(
            {
              user_id: data.user.id,
              display_name: displayName.trim() || data.user.email?.split('@')[0] || 'User',
              timezone: 'Asia/Jakarta',
            },
            { onConflict: 'user_id' }
          )
        } catch {
          // Failure to upsert profile here is non-fatal as AuthProvider lazily creates it
        }
      }

      setIsSuccess(true)
      setIsLoading(false)
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Terjadi kesalahan saat pendaftaran.')
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
            <h1 className="text-xl font-bold tracking-tight text-text-base">Buat Akun Baru</h1>
            <p className="text-xs text-text-muted mt-0.5">
              Mulai kebiasaan menabung dan pantau cashflow harianmu.
            </p>
          </div>
        </div>

        {/* Success State */}
        {isSuccess ? (
          <div className="flex flex-col items-center gap-4 text-center py-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-raised border border-border text-primary">
              <CheckCircle2 size={28} />
            </div>
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-semibold text-text-base">
                Pendaftaran Berhasil!
              </h2>
              <p className="text-xs text-text-muted">
                Silakan periksa email Anda jika konfirmasi email diaktifkan, atau langsung masuk ke akun Anda.
              </p>
            </div>
            <Link
              href="/login"
              className="mt-2 w-full rounded-xl bg-primary py-3 text-center text-sm font-semibold text-text-inverse shadow-sm transition hover:opacity-95"
            >
              Lanjut ke Halaman Masuk
            </Link>
          </div>
        ) : (
          <>
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
            <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="signup-name"
                  className="text-xs font-semibold text-text-base"
                >
                  Nama Panggilan (opsional)
                </label>
                <input
                  id="signup-name"
                  type="text"
                  autoComplete="name"
                  disabled={isLoading}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Misal: Alex"
                  className="w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm text-text-base outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="signup-email"
                  className="text-xs font-semibold text-text-base"
                >
                  Email
                </label>
                <input
                  id="signup-email"
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
                  htmlFor="signup-password"
                  className="text-xs font-semibold text-text-base"
                >
                  Password
                </label>
                <input
                  id="signup-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  disabled={isLoading}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimal 6 karakter"
                  className="w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm text-text-base outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="signup-confirm-password"
                  className="text-xs font-semibold text-text-base"
                >
                  Konfirmasi Password
                </label>
                <input
                  id="signup-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  disabled={isLoading}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Ulangi password"
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
                    <span>Mendaftarkan...</span>
                  </>
                ) : (
                  <span>Daftar Sekarang</span>
                )}
              </button>
            </form>

            {/* Footer link */}
            <div className="text-center text-xs text-text-muted">
              Sudah punya akun?{' '}
              <Link
                href="/login"
                className="font-semibold text-primary hover:underline underline-offset-4"
              >
                Masuk di sini
              </Link>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
