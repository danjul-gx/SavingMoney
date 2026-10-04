'use client'

import { useRef, useEffect, useCallback, useState } from 'react'
import gsap from 'gsap'
import {
  LayoutDashboard,
  Wallet,
  ArrowLeftRight,
  Target,
  Sliders,
  Clock3,
  FileText,
  Activity,
  X,
  Menu,
} from 'lucide-react'
import { ThemeToggle } from '@/lib/theme/ThemeToggle'

const NAV_ITEMS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'wallets', label: 'Dompet', icon: Wallet },
  { id: 'transactions', label: 'Transaksi', icon: ArrowLeftRight },
  { id: 'budgets', label: 'Anggaran', icon: Sliders },
  { id: 'goals', label: 'Tabungan', icon: Target },
  { id: 'history', label: 'Riwayat', icon: Clock3 },
  { id: 'reports', label: 'Laporan', icon: FileText },
  { id: 'activity', label: 'Aktivitas', icon: Activity },
] as const

export type SectionId = (typeof NAV_ITEMS)[number]['id']

interface StaggeredMenuProps {
  activeSection: SectionId
  onNavigate: (id: SectionId) => void
}

export function StaggeredMenu({ activeSection, onNavigate }: StaggeredMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const isOpenRef = useRef(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const itemsRef = useRef<HTMLButtonElement[]>([])
  const tlRef = useRef<gsap.core.Timeline | null>(null)

  const prefersReduced = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const closeMenu = useCallback(() => {
    if (!isOpenRef.current) return
    isOpenRef.current = false
    setIsOpen(false)

    if (tlRef.current) {
      tlRef.current.kill()
      tlRef.current = null
    }

    if (!panelRef.current || prefersReduced) {
      if (panelRef.current) panelRef.current.style.display = 'none'
      return
    }

    const tl = gsap.timeline({
      defaults: { ease: 'expo.in' },
      onComplete: () => {
        if (panelRef.current) panelRef.current.style.display = 'none'
      },
    })
    tlRef.current = tl

    tl.to(
      itemsRef.current.filter(Boolean).reverse(),
      { opacity: 0, x: -16, duration: 0.18, stagger: 0.02 }
    ).to(panelRef.current, { opacity: 0, y: 10, duration: 0.2 }, '-=0.1')
  }, [prefersReduced])

  const openMenu = useCallback(() => {
    if (isOpenRef.current) return
    isOpenRef.current = true
    setIsOpen(true)

    if (tlRef.current) {
      tlRef.current.kill()
      tlRef.current = null
    }

    if (!panelRef.current) return

    if (prefersReduced) {
      panelRef.current.style.display = 'flex'
      panelRef.current.style.opacity = '1'
      panelRef.current.style.transform = 'none'
      return
    }

    const validItems = itemsRef.current.filter(Boolean)
    const tl = gsap.timeline({
      defaults: { ease: 'expo.out' },
    })
    tlRef.current = tl

    tl.set(panelRef.current, { display: 'flex' })
      .fromTo(
        panelRef.current,
        { opacity: 0, y: 16 },
        { opacity: 1, y: 0, duration: 0.35 }
      )
      .fromTo(
        validItems,
        { opacity: 0, x: -14 },
        { opacity: 1, x: 0, duration: 0.3, stagger: 0.035 },
        '-=0.18'
      )
  }, [prefersReduced])

  const toggleMenu = useCallback(() => {
    if (isOpenRef.current) {
      closeMenu()
    } else {
      openMenu()
    }
  }, [closeMenu, openMenu])

  // Click outside listener
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        isOpenRef.current &&
        menuRef.current &&
        !menuRef.current.contains(e.target as Node)
      ) {
        closeMenu()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [closeMenu])

  // Escape key listener
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isOpenRef.current && e.key === 'Escape') {
        closeMenu()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [closeMenu])

  const handleNav = (id: SectionId) => {
    onNavigate(id)
    closeMenu()
  }

  return (
    <div ref={menuRef} className="relative z-50">
      {/* Menu trigger */}
      <button
        type="button"
        onClick={toggleMenu}
        className="btn btn-ghost flex items-center gap-2 select-none"
        aria-label={isOpen ? 'Tutup menu' : 'Buka menu'}
        aria-expanded={isOpen}
      >
        <span
          className="transition-transform duration-300"
          style={{
            transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
          }}
        >
          {isOpen ? <X size={18} /> : <Menu size={18} />}
        </span>
        <span className="text-xs font-semibold tracking-wide hidden sm:inline">
          {isOpen ? 'Tutup' : 'Menu'}
        </span>
      </button>

      {/* Navigation panel */}
      <div
        ref={panelRef}
        role="navigation"
        aria-label="Menu utama"
        className="absolute right-0 top-full mt-2 w-56 max-h-[calc(100dvh-5rem)] overflow-y-auto flex-col gap-1 rounded-2xl bg-surface border border-border-subtle p-2 shadow-lg"
        style={{ display: 'none' }}
      >
        {NAV_ITEMS.map((item, i) => {
          const Icon = item.icon
          const isActive = activeSection === item.id
          return (
            <button
              key={item.id}
              type="button"
              ref={(el) => { if (el) itemsRef.current[i] = el }}
              onClick={() => handleNav(item.id)}
              className={`
                flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium
                transition-colors
                ${isActive
                  ? 'bg-primary/8 text-primary'
                  : 'text-ink-secondary hover:bg-surface-raised hover:text-ink'}
              `}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon size={16} strokeWidth={isActive ? 2 : 1.5} />
              <span>{item.label}</span>
              {isActive && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
              )}
            </button>
          )
        })}

        {/* Theme Selector inside menu */}
        <div className="mt-1 pt-2 border-t border-border-subtle px-2 pb-1 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Tema</span>
          <ThemeToggle variant="segmented" />
        </div>
      </div>
    </div>
  )
}


export { NAV_ITEMS }
