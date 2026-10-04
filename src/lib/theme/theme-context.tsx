'use client'

import React, { createContext, useContext, useEffect, useState, useSyncExternalStore, useCallback } from 'react'

export type Theme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'cashflow_theme_preference'

interface ThemeContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

function applyThemeClass(t: Theme) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (t === 'dark') {
    root.classList.add('dark')
    root.classList.remove('light')
    root.setAttribute('data-theme', 'dark')
    root.style.colorScheme = 'dark'
  } else {
    root.classList.remove('dark')
    root.classList.add('light')
    root.setAttribute('data-theme', 'light')
    root.style.colorScheme = 'light'
  }

  // Update meta theme-color tag dynamically for PWA/mobile browser chrome
  const metaThemeColor = document.querySelector('meta[name="theme-color"]')
  if (metaThemeColor) {
    metaThemeColor.setAttribute('content', t === 'dark' ? '#1D1E23' : '#FA855A')
  }
}


function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  try {
    const val = localStorage.getItem(THEME_STORAGE_KEY)
    if (val === 'dark' || val === 'light') return val
  } catch {
    // fallback
  }
  return 'light'
}

let listeners: Array<() => void> = []

function subscribe(callback: () => void) {
  listeners.push(callback)
  return () => {
    listeners = listeners.filter((l) => l !== callback)
  }
}

function notify() {
  listeners.forEach((l) => l())
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const clientTheme = useSyncExternalStore(
    subscribe,
    getStoredTheme,
    () => 'light' as Theme
  )

  const [localTheme, setLocalTheme] = useState<Theme | null>(null)
  const activeTheme = localTheme ?? clientTheme

  // Keep DOM synchronized with activeTheme
  useEffect(() => {
    applyThemeClass(activeTheme)
  }, [activeTheme])

  const setTheme = useCallback((nextTheme: Theme) => {
    setLocalTheme(nextTheme)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, nextTheme)
    } catch {
      // Ignore localStorage write failures
    }
    applyThemeClass(nextTheme)
    notify()
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(activeTheme === 'dark' ? 'light' : 'dark')
  }, [activeTheme, setTheme])

  return (
    <ThemeContext.Provider value={{ theme: activeTheme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
