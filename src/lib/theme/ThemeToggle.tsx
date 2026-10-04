'use client'

import React from 'react'
import { Sun, Moon } from 'lucide-react'
import { useTheme } from './theme-context'

interface ThemeToggleProps {
  className?: string
  showLabel?: boolean
  variant?: 'button' | 'segmented'
}

export function ThemeToggle({
  className = '',
  showLabel = false,
  variant = 'button',
}: ThemeToggleProps) {
  const { theme, setTheme, toggleTheme } = useTheme()

  if (variant === 'segmented') {
    return (
      <div
        role="radiogroup"
        aria-label="Pilih Tema"
        className={`inline-flex items-center p-0.5 rounded-xl bg-surface-raised border border-border ${className}`}
      >
        <button
          type="button"
          role="radio"
          aria-checked={theme === 'light'}
          onClick={() => setTheme('light')}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition ${
            theme === 'light'
              ? 'bg-surface text-ink shadow-xs border border-border/60'
              : 'text-ink-muted hover:text-ink'
          }`}
          title="Tema Terang (Light)"
        >
          <Sun size={13} className="shrink-0" />
          <span>Terang</span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={theme === 'dark'}
          onClick={() => setTheme('dark')}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition ${
            theme === 'dark'
              ? 'bg-surface text-ink shadow-xs border border-border/60'
              : 'text-ink-muted hover:text-ink'
          }`}
          title="Tema Gelap (Dark)"
        >
          <Moon size={13} className="shrink-0" />
          <span>Gelap</span>
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`flex items-center justify-center h-9 w-9 rounded-xl border border-border bg-surface text-ink-muted hover:text-ink hover:border-primary/40 hover:bg-surface-raised transition active:scale-95 ${className}`}
      title={theme === 'dark' ? 'Beralih ke Tema Terang' : 'Beralih ke Tema Gelap'}
      aria-label={theme === 'dark' ? 'Beralih ke Tema Terang' : 'Beralih ke Tema Gelap'}
    >
      {theme === 'dark' ? (
        <Sun size={16} className="text-highlight" />
      ) : (
        <Moon size={16} />
      )}
      {showLabel && (
        <span className="ml-2 text-xs font-medium text-ink">
          {theme === 'dark' ? 'Terang' : 'Gelap'}
        </span>
      )}
    </button>
  )
}
