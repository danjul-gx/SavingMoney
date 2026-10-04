'use client'

import { useEffect, useRef, useCallback } from 'react'
import { X } from 'lucide-react'

interface DrawerProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
}

export function Drawer({ isOpen, onClose, title, children }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const prevFocusRef = useRef<HTMLElement | null>(null)

  // Focus trap and restore
  useEffect(() => {
    if (isOpen) {
      prevFocusRef.current = document.activeElement as HTMLElement
      const timer = setTimeout(() => panelRef.current?.focus(), 100)
      return () => clearTimeout(timer)
    } else if (prevFocusRef.current) {
      prevFocusRef.current.focus()
    }
  }, [isOpen])

  // Escape key
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  // Prevent body scroll
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [isOpen])

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }, [onClose])

  if (!isOpen) return null

  return (
    <>
      {/* Overlay */}
      <div
        className="overlay animate-in"
        style={{ animationDuration: '200ms' }}
        onClick={handleOverlayClick}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Dialog'}
        tabIndex={-1}
        className="drawer-panel animate-in"
        style={{ animationDuration: '350ms' }}
      >
        {title && (
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-base font-bold text-ink">{title}</h3>
            <button
              onClick={onClose}
              className="btn btn-ghost btn-sm"
              aria-label="Tutup"
            >
              <X size={18} />
            </button>
          </div>
        )}

        {children}
      </div>
    </>
  )
}
