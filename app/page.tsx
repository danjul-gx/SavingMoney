'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { updateUserProfile } from '@/lib/profile/client'
import { getWallets, createWallet, updateWallet } from '@/lib/wallets/client'
import { createTransaction, queryTransactions } from '@/lib/transactions/client'
import { reverseTransaction } from '@/lib/transactions/reversal'
import { getBudgetAllocations, createBudgetAllocation, updateBudgetAllocation, deleteBudgetAllocation } from '@/lib/budgets/client'
import { getSavingsAllocation } from '@/lib/savings/client'
import type { SavingsAllocationCalculation } from '@/lib/savings/client'
import { getGoals, createGoal, updateGoal, deleteGoal, calculateGoalProgress } from '@/lib/goals/client'
import { createSavingsContribution } from '@/lib/savings/contribution'
import { createSavingsWithdrawal, calculateGoalDelayEstimate } from '@/lib/savings/withdrawal'
import { getMonthBudgetEvaluation, finalizeMonthBudgetDecision } from '@/lib/rollover/client'
import type { MonthBudgetEvaluation } from '@/lib/rollover/client'
import { getMonthHistorySummary, getMonthTransactions, getGoalProgressSnapshots } from '@/lib/history/client'
import type { MonthHistorySummary, MonthTransactionsByType, GoalProgressSnapshot } from '@/lib/history/client'
import type { Wallet, WalletType, Transaction, BudgetAllocation, BudgetCategory, BudgetPeriod, Goal } from '@/types/domain'
import { formatRupiah, normalizeToMonthly } from '@/types/domain'
import { getFinancialAuditEvents, formatAuditEvent, matchesAuditFilter } from '@/lib/audit/client'
import type { FinancialAuditEvent, AuditFilterCategory } from '@/types/domain'
import { getDashboardData } from '@/lib/dashboard/client'
import type { DashboardData } from '@/lib/dashboard/client'
import { getFinancialReportData, generateFinancialReportCsv } from '@/lib/reports/client'
import type { FinancialReportData } from '@/lib/reports/client'
import { StaggeredMenu, type SectionId } from '@/lib/ui/StaggeredMenu'
import { ThemeToggle } from '@/lib/theme/ThemeToggle'
import {
  Wallet as WalletIcon,
  LogOut,
  Edit2,
  CheckCircle2,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Plus,
  Target,
  Sliders,
  Clock3,
  FileText,
  Activity,
  CreditCard,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
} from 'lucide-react'

export default function HomePage() {
  const router = useRouter()
  const { user, profile, isLoading, signOut, refreshProfile } = useAuth()

  const [isEditing, setIsEditing] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [timezone, setTimezone] = useState('')
  const [saveStatus, setSaveStatus] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [activeSection, setActiveSection] = useState<SectionId>('overview')
  const [walletRefreshKey, setWalletRefreshKey] = useState(0)

  const handleStartEdit = () => {
    setDisplayName(profile?.displayName || '')
    setTimezone(profile?.timezone || 'Asia/Jakarta')
    setSaveStatus(null)
    setIsEditing(true)
  }

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSaving) return

    setIsSaving(true)
    setSaveStatus(null)

    const { error } = await updateUserProfile({
      displayName: displayName.trim() || null,
      timezone: timezone.trim() || 'Asia/Jakarta',
    })

    if (error) {
      setSaveStatus(`Gagal memperbarui profil: ${error}`)
    } else {
      await refreshProfile()
      setIsEditing(false)
      setSaveStatus('Profil berhasil diperbarui!')
    }
    setIsSaving(false)
  }

  const handleSignOut = async () => {
    await signOut()
    router.push('/login')
    router.refresh()
  }

  if (isLoading) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3">
          <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-xs text-text-muted">Memuat sesi pengguna...</p>
        </div>
      </main>
    )
  }

  // If unauthenticated, redirect or prompt (middleware also catches this on server side)
  if (!user) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-raised border border-border text-ink-muted">
            <Clock3 size={24} />
          </div>
          <p className="text-sm font-semibold text-ink">Sesi berakhir</p>
          <button
            onClick={() => router.push('/login')}
            className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-text-inverse shadow-sm"
          >
            Masuk ke Akun
          </button>
        </div>
      </main>
    )
  }

  return (
    <div className="min-h-dvh flex flex-col bg-app-background safe-x pb-safe">
      {/* Top Application Shell Header */}
      <header className="sticky top-0 z-40 w-full border-b border-border/80 bg-surface/90 backdrop-blur-md pt-safe">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-text-inverse shadow-sm">
              <WalletIcon size={18} strokeWidth={2.2} />
            </div>
            <div>
              <span className="font-bold text-sm tracking-tight text-ink block leading-none">
                Cashflow
              </span>
              <span className="text-[10px] font-medium text-ink-muted uppercase tracking-wider block mt-0.5">
                Savings Tracker
              </span>
            </div>
          </div>

          {/* Right Header Controls: Profile Pill + StaggeredMenu + Logout */}
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={() => setActiveSection('overview')}
              className="hidden sm:flex items-center gap-2 rounded-xl bg-surface-raised border border-border px-2.5 py-1.5 text-xs text-ink hover:border-primary/40 transition"
              title="Profil Pengguna"
            >
              <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10 text-primary font-bold text-xs">
                {(profile?.displayName || user.email || 'U')[0].toUpperCase()}
              </div>
              <span className="font-medium max-w-[120px] truncate">
                {profile?.displayName || 'Pengguna'}
              </span>
            </button>

            {/* Theme Toggle Button */}
            <ThemeToggle />

            {/* GSAP Staggered Menu Navigation */}
            <StaggeredMenu
              activeSection={activeSection}
              onNavigate={(id) => setActiveSection(id)}
            />


            <button
              onClick={handleSignOut}
              className="flex items-center justify-center h-9 w-9 rounded-xl border border-border bg-surface text-ink-muted hover:text-danger hover:border-danger/30 hover:bg-danger/5 transition active:scale-95"
              title="Keluar dari akun"
              aria-label="Keluar dari akun"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>

      </header>

      {/* Main Content Area */}
      <main className="flex-1 mx-auto w-full max-w-5xl px-4 sm:px-6 py-4 sm:py-6">
        {/* Personal Greeting on Overview */}
        {activeSection === 'overview' && (
          <div className="mb-6 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  Keuangan Kamu
                </p>
                <h1 className="text-xl sm:text-2xl font-black tracking-tight text-ink mt-0.5">
                  Halo, {profile?.displayName || user.email?.split('@')[0] || 'Teman'}
                </h1>
                <p className="text-xs text-ink-muted mt-0.5">
                  Yuk lihat posisi uang dan target tabungan kamu bulan ini.
                </p>
              </div>

              {!isEditing && (
                <button
                  type="button"
                  onClick={handleStartEdit}
                  className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-ink-secondary hover:text-ink hover:bg-surface-raised transition shadow-xs"
                >
                  <Edit2 size={13} />
                  <span>Ubah Profil</span>
                </button>
              )}
            </div>

            {saveStatus && (
              <div
                className={`rounded-xl p-3 text-xs font-medium flex items-center gap-2 ${
                  saveStatus.includes('Gagal')
                    ? 'bg-danger/10 text-danger border border-danger/20'
                    : 'bg-surface-raised text-ink border border-border'
                }`}
              >
                {saveStatus.includes('Gagal') ? (
                  <AlertTriangle size={14} className="shrink-0" />
                ) : (
                  <CheckCircle2 size={14} className="shrink-0 text-primary" />
                )}
                <span>{saveStatus}</span>
              </div>
            )}

            {isEditing && (
              <form onSubmit={handleSaveProfile} className="mt-2 rounded-2xl bg-surface border border-border p-4 shadow-sm flex flex-col gap-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label htmlFor="edit-name" className="text-xs font-medium text-ink-muted">
                      Nama Panggilan
                    </label>
                    <input
                      id="edit-name"
                      type="text"
                      disabled={isSaving}
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Nama kamu"
                      className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-ink outline-none focus:border-primary"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label htmlFor="edit-tz" className="text-xs font-medium text-ink-muted">
                      Zona Waktu
                    </label>
                    <select
                      id="edit-tz"
                      disabled={isSaving}
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-ink outline-none focus:border-primary"
                    >
                      <option value="Asia/Jakarta">WIB (Asia/Jakarta)</option>
                      <option value="Asia/Makassar">WITA (Asia/Makassar)</option>
                      <option value="Asia/Jayapura">WIT (Asia/Jayapura)</option>
                    </select>
                  </div>
                </div>

                {/* Theme Preference Option in Profile Form */}
                <div className="flex items-center justify-between pt-2 border-t border-border/60">
                  <div>
                    <p className="text-xs font-medium text-ink">Tema Tampilan</p>
                    <p className="text-[11px] text-ink-muted">Pilih mode terang atau gelap sesuai kenyamanan Anda.</p>
                  </div>
                  <ThemeToggle variant="segmented" />
                </div>

                <div className="flex items-center gap-2 pt-1">

                  <button
                    type="submit"
                    disabled={isSaving}
                    className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-text-inverse hover:opacity-95 disabled:opacity-50"
                  >
                    {isSaving ? 'Menyimpan...' : 'Simpan'}
                  </button>
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => setIsEditing(false)}
                    className="rounded-xl border border-border bg-surface px-4 py-2 text-xs font-semibold text-ink-muted hover:bg-surface-raised disabled:opacity-50"
                  >
                    Batal
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* Section View Routing */}
        <div className="space-y-6">
          {/* Back button for non-overview sections */}
          {activeSection !== 'overview' && (
            <div className="pt-1">
              <BackToOverview onClick={() => setActiveSection('overview')} />
            </div>
          )}

          {/* OVERVIEW SECTION: Financial Snapshot & Insights */}
          {activeSection === 'overview' && (
            <DashboardSection
              refreshKey={walletRefreshKey}
              onNavigate={(id) => setActiveSection(id)}
            />
          )}

          {/* WALLETS SECTION */}
          {activeSection === 'wallets' && (
            <div className="flex flex-col gap-6">
              <WalletSection
                refreshKey={walletRefreshKey}
                onWalletChange={() => setWalletRefreshKey((k) => k + 1)}
              />
              <SavingsSection refreshKey={walletRefreshKey} />
            </div>
          )}

          {/* TRANSACTIONS SECTION */}
          {activeSection === 'transactions' && (
            <TransactionSection
              walletRefreshKey={walletRefreshKey}
              onTransactionCreated={() => setWalletRefreshKey((k) => k + 1)}
            />
          )}

          {/* BUDGETS SECTION */}
          {activeSection === 'budgets' && (
            <div className="flex flex-col gap-6">
              <BudgetSection
                walletRefreshKey={walletRefreshKey}
                onBudgetChange={() => setWalletRefreshKey((k) => k + 1)}
              />
              <MonthTransitionSection
                walletRefreshKey={walletRefreshKey}
                onDecisionApplied={() => setWalletRefreshKey((k) => k + 1)}
              />
            </div>
          )}

          {/* GOALS SECTION */}
          {activeSection === 'goals' && (
            <GoalSection
              refreshKey={walletRefreshKey}
              onGoalContributed={() => setWalletRefreshKey((k) => k + 1)}
            />
          )}

          {/* HISTORY SECTION */}
          {activeSection === 'history' && (
            <MonthlyHistorySection walletRefreshKey={walletRefreshKey} />
          )}

          {/* REPORTS SECTION */}
          {activeSection === 'reports' && (
            <ExportSection refreshKey={walletRefreshKey} />
          )}

          {/* ACTIVITY SECTION */}
          {activeSection === 'activity' && (
            <ActivitySection walletRefreshKey={walletRefreshKey} />
          )}
        </div>
      </main>
    </div>
  )
}

function BackToOverview({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Kembali ke Overview"
      className="inline-flex items-center gap-2 rounded-xl border border-border/80 bg-surface/90 px-3.5 py-2 text-xs font-semibold text-ink-secondary hover:text-ink hover:bg-surface-raised hover:border-border transition active:scale-95 shadow-2xs group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <ArrowLeft
        size={15}
        className="transition-transform duration-200 group-hover:-translate-x-0.5 text-primary"
      />
      <span>Kembali ke Overview</span>
    </button>
  )
}

function WalletSection({
  refreshKey,
  onWalletChange,
}: {
  refreshKey: number
  onWalletChange: () => void
}) {
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Creation state
  const [isCreating, setIsCreating] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newType, setNewType] = useState<WalletType>('cash')
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Edit state
  const [editingWalletId, setEditingWalletId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const loadWallets = async () => {
    setIsLoading(true)
    setErrorMsg(null)
    const { data, error } = await getWallets()
    if (error) {
      setErrorMsg(error)
    } else {
      setWallets(data)
    }
    setIsLoading(false)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadWallets()
  }, [refreshKey])

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSubmittingCreate) return

    setCreateError(null)
    setIsSubmittingCreate(true)

    const { data, error } = await createWallet({
      label: newLabel,
      type: newType,
    })

    if (error) {
      setCreateError(error)
      setIsSubmittingCreate(false)
      return
    }

    if (data) {
      setWallets((prev) => [...prev, data])
      setIsCreating(false)
      setNewLabel('')
      setNewType('cash')
      onWalletChange()
    }
    setIsSubmittingCreate(false)
  }

  const handleStartEdit = (wallet: Wallet) => {
    setEditingWalletId(wallet.id)
    setEditLabel(wallet.label)
    setEditError(null)
  }

  const handleEditSubmit = async (e: React.FormEvent, walletId: string) => {
    e.preventDefault()
    if (isSubmittingEdit) return

    setEditError(null)
    setIsSubmittingEdit(true)

    const { data, error } = await updateWallet(walletId, {
      label: editLabel,
    })

    if (error) {
      setEditError(error)
      setIsSubmittingEdit(false)
      return
    }

    if (data) {
      setWallets((prev) =>
        prev.map((w) => (w.id === walletId ? data : w))
      )
      setEditingWalletId(null)
    }
    setIsSubmittingEdit(false)
  }

  const hasCash = wallets.some((w) => w.type === 'cash')
  const hasDigital = wallets.some((w) => w.type === 'digital')
  const canAddMore = !hasCash || !hasDigital

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-text-base">Daftar Dompet</h2>
        {canAddMore && !isCreating && (
          <button
            onClick={() => {
              setNewType(hasCash ? 'digital' : 'cash')
              setNewLabel(hasCash ? 'Bank / E-Wallet' : 'Dompet Tunai')
              setCreateError(null)
              setIsCreating(true)
            }}
            className="text-xs font-semibold text-primary hover:underline underline-offset-4"
          >
            + Tambah Dompet
          </button>
        )}
      </div>

      {/* Global Error Banner */}
      {errorMsg && (
        <div
          role="alert"
          className="rounded-2xl bg-danger/10 border border-danger/20 p-3 text-xs text-danger font-medium flex items-center justify-between"
        >
          <span>⚠️ {errorMsg}</span>
          <button
            onClick={loadWallets}
            className="text-xs underline font-bold"
          >
            Coba Lagi
          </button>
        </div>
      )}

      {/* Create Form Card */}
      {isCreating && (
        <div className="rounded-3xl bg-surface border border-primary/30 p-5 shadow-sm flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-text-base">Buat Dompet Baru</h3>
            <button
              onClick={() => setIsCreating(false)}
              className="text-xs text-text-muted hover:text-text-base"
            >
              Tutup
            </button>
          </div>

          {createError && (
            <div className="rounded-xl bg-danger/10 border border-danger/20 p-2.5 text-xs text-danger font-medium">
              ⚠️ {createError}
            </div>
          )}

          <form onSubmit={handleCreateSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="create-wallet-type" className="text-xs font-medium text-text-muted">
                Tipe Dompet
              </label>
              <select
                id="create-wallet-type"
                value={newType}
                onChange={(e) => setNewType(e.target.value as WalletType)}
                className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-text-base outline-none focus:border-primary"
              >
                {!hasCash && <option value="cash">Tunai (Cash)</option>}
                {!hasDigital && <option value="digital">Digital (Rekening / E-Wallet)</option>}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="create-wallet-name" className="text-xs font-medium text-text-muted">
                Nama / Label Dompet
              </label>
              <input
                id="create-wallet-name"
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Contoh: Dompet Utama / BCA"
                maxLength={50}
                required
                className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-text-base outline-none focus:border-primary"
              />
            </div>

            <div className="rounded-xl bg-surface-raised p-2.5 text-[11px] text-text-muted flex items-center gap-1.5">
              <span>ℹ️</span>
              <span>Saldo awal dimulai dari Rp 0 sesuai standar akuntansi database.</span>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="submit"
                disabled={isSubmittingCreate}
                className="flex-1 rounded-xl bg-primary py-2.5 text-xs font-semibold text-text-inverse hover:opacity-95 disabled:opacity-50"
              >
                {isSubmittingCreate ? 'Menyimpan...' : 'Simpan Dompet'}
              </button>
              <button
                type="button"
                disabled={isSubmittingCreate}
                onClick={() => setIsCreating(false)}
                className="flex-1 rounded-xl border border-border bg-surface py-2.5 text-xs font-semibold text-text-muted hover:bg-surface-raised"
              >
                Batal
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Loading state */}
      {isLoading ? (
        <div className="flex flex-col gap-3">
          <div className="h-24 animate-pulse rounded-3xl bg-surface border border-border" />
          <div className="h-24 animate-pulse rounded-3xl bg-surface border border-border" />
        </div>
      ) : wallets.length === 0 ? (
        /* Empty State */
        <div className="rounded-3xl bg-surface border border-border p-6 text-center flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-raised border border-border text-primary">
            <WalletIcon size={24} />
          </div>
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-bold text-text-base">Belum Ada Dompet</h3>
            <p className="text-xs text-text-muted max-w-xs">
              Dompet mencerminkan tempat uang Anda disimpan (seperti uang tunai fisik atau rekening bank/e-wallet).
            </p>
          </div>
          {!isCreating && (
            <button
              onClick={() => {
                setNewType('cash')
                setNewLabel('Dompet Tunai')
                setIsCreating(true)
              }}
              className="mt-1 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-text-inverse shadow-sm hover:opacity-95"
            >
              + Tambah Dompet Sekarang
            </button>
          )}
        </div>
      ) : (
        /* Wallet Cards */
        <div className="flex flex-col gap-3">
          {wallets.map((wallet) => {
            const isEditingThis = editingWalletId === wallet.id
            const isCash = wallet.type === 'cash'

            return (
              <div
                key={wallet.id}
                className="rounded-3xl bg-surface border border-border p-5 shadow-sm flex flex-col gap-3"
              >
                {isEditingThis ? (
                  <form
                    onSubmit={(e) => handleEditSubmit(e, wallet.id)}
                    className="flex flex-col gap-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-text-muted">
                        Edit Nama Dompet ({isCash ? 'Tunai' : 'Digital'})
                      </span>
                      <button
                        type="button"
                        onClick={() => setEditingWalletId(null)}
                        className="text-xs text-text-muted hover:text-text-base"
                      >
                        Batal
                      </button>
                    </div>

                    {editError && (
                      <div className="rounded-xl bg-danger/10 border border-danger/20 p-2 text-xs text-danger">
                        ⚠️ {editError}
                      </div>
                    )}

                    <input
                      type="text"
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      maxLength={50}
                      required
                      disabled={isSubmittingEdit}
                      className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-text-base outline-none focus:border-primary"
                    />

                    <div className="flex items-center gap-2">
                      <button
                        type="submit"
                        disabled={isSubmittingEdit}
                        className="flex-1 rounded-xl bg-primary py-2 text-xs font-semibold text-text-inverse hover:opacity-95 disabled:opacity-50"
                      >
                        {isSubmittingEdit ? 'Menyimpan...' : 'Simpan'}
                      </button>
                      <button
                        type="button"
                        disabled={isSubmittingEdit}
                        onClick={() => setEditingWalletId(null)}
                        className="flex-1 rounded-xl border border-border bg-surface py-2 text-xs font-semibold text-text-muted hover:bg-surface-raised"
                      >
                        Batal
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-surface-raised border border-border text-base text-primary">
                          {isCash ? <WalletIcon size={18} /> : <FileText size={18} />}
                        </span>
                        <div className="flex flex-col">
                          <p className="text-sm font-bold text-text-base">{wallet.label}</p>
                          <span className="text-[11px] font-medium text-text-muted">
                            {isCash ? 'Uang Tunai (Cash)' : 'Digital / Bank / E-Wallet'}
                          </span>
                        </div>
                      </div>

                      <button
                        onClick={() => handleStartEdit(wallet)}
                        className="text-xs font-semibold text-primary hover:underline underline-offset-4"
                      >
                        Ubah
                      </button>
                    </div>

                    <div className="pt-2 border-t border-border flex items-baseline justify-between">
                      <span className="text-xs text-text-muted">Saldo Saat Ini</span>
                      <span className="text-lg font-bold text-text-base font-mono">
                        {formatRupiah(wallet.balance)}
                      </span>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function TransactionSection({
  walletRefreshKey,
  onTransactionCreated,
}: {
  walletRefreshKey: number
  onTransactionCreated: () => void
}) {
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [goals, setGoals] = useState<Goal[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Transaction form state
  const [isEntryOpen, setIsEntryOpen] = useState(false)
  const [txType, setTxType] = useState<'income' | 'expense'>('expense')
  const [selectedWalletId, setSelectedWalletId] = useState<string>('')
  const [amountStr, setAmountStr] = useState('')
  const [description, setDescription] = useState('')
  const [txDate, setTxDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Reversal modal state (M2.12)
  const [reversingTx, setReversingTx] = useState<Transaction | null>(null)
  const [reversalReason, setReversalReason] = useState('')
  const [reversalError, setReversalError] = useState<string | null>(null)
  const [isSubmittingReversal, setIsSubmittingReversal] = useState(false)

  // M2.16: Search, filter, sort & server-side pagination state
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<string>('all')
  const [filterWalletId, setFilterWalletId] = useState<string>('all')
  const [filterGoalId, setFilterGoalId] = useState<string>('all')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [sortNewestFirst, setSortNewestFirst] = useState(true)
  const [page, setPage] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [detailTx, setDetailTx] = useState<Transaction | null>(null)
  const PAGE_SIZE = 50

  const handleOpenReversal = (tx: Transaction) => {
    setReversingTx(tx)
    setReversalReason('')
    setReversalError(null)
  }

  const handleCloseReversal = () => {
    if (isSubmittingReversal) return
    setReversingTx(null)
    setReversalReason('')
    setReversalError(null)
  }

  const handleExecuteReversal = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!reversingTx || isSubmittingReversal) return

    const trimmed = reversalReason.trim()
    if (!trimmed) {
      setReversalError('Alasan pembatalan wajib diisi.')
      return
    }

    setIsSubmittingReversal(true)
    setReversalError(null)

    const { data, error } = await reverseTransaction({
      transactionId: reversingTx.id,
      reason: trimmed,
    })

    if (error) {
      setReversalError(error)
      setIsSubmittingReversal(false)
      return
    }

    if (data) {
      await loadData()
      handleCloseReversal()
      onTransactionCreated()
    }

    setIsSubmittingReversal(false)
  }

  const loadData = async () => {
    setIsLoading(true)
    setErrorMsg(null)

    const [walletsRes, txRes, goalsRes] = await Promise.all([
      getWallets(),
      queryTransactions({
        search: searchQuery.trim() || null,
        type: filterType !== 'all' ? filterType : null,
        walletId: filterWalletId !== 'all' ? filterWalletId : null,
        goalId: filterGoalId !== 'all' ? filterGoalId : null,
        startDate: filterDateFrom || null,
        endDate: filterDateTo || null,
        sortNewestFirst,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
      getGoals(),
    ])

    if (walletsRes.error) {
      setErrorMsg(walletsRes.error)
    } else {
      setWallets(walletsRes.data)
      if (!selectedWalletId && walletsRes.data.length > 0) {
        setSelectedWalletId(walletsRes.data[0].id)
      }
    }

    if (txRes.error) {
      setErrorMsg(txRes.error)
    } else {
      setTransactions(txRes.data)
      setTotalCount(txRes.totalCount)
      setHasMore(txRes.hasMore)
    }

    if (!goalsRes.error) {
      setGoals(goalsRes.data)
    }

    setIsLoading(false)
  }

  // Reload transactions whenever pagination or filters change, or walletRefreshKey changes
  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletRefreshKey, page, searchQuery, filterType, filterWalletId, filterGoalId, filterDateFrom, filterDateTo, sortNewestFirst])

  const handleCreateTx = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSubmitting) return

    setFormError(null)

    const cleanAmount = parseInt(amountStr.replace(/\D/g, ''), 10)
    if (isNaN(cleanAmount) || cleanAmount <= 0) {
      setFormError('Nominal transaksi harus lebih dari 0.')
      return
    }

    if (!selectedWalletId) {
      setFormError('Pilih dompet terlebih dahulu.')
      return
    }

    setIsSubmitting(true)

    const { data, error } = await createTransaction({
      walletId: selectedWalletId,
      type: txType,
      amount: cleanAmount,
      description: description.trim() || null,
      transactionDate: txDate,
    })

    if (error) {
      setFormError(error)
      setIsSubmitting(false)
      return
    }

    if (data) {
      await loadData()
      setIsEntryOpen(false)
      setAmountStr('')
      setDescription('')
      onTransactionCreated()
    }

    setIsSubmitting(false)
  }

  // Lookup maps
  const walletMap = new Map<string, Wallet>()
  wallets.forEach((w) => walletMap.set(w.id, w))
  const goalMap = new Map<string, Goal>()
  goals.forEach((g) => goalMap.set(g.id, g))

  // M2.16 & M2.17: Active filter detection & clear
  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    filterType !== 'all' ||
    filterWalletId !== 'all' ||
    filterGoalId !== 'all' ||
    filterDateFrom !== '' ||
    filterDateTo !== ''

  const clearFilters = () => {
    setSearchQuery('')
    setFilterType('all')
    setFilterWalletId('all')
    setFilterGoalId('all')
    setFilterDateFrom('')
    setFilterDateTo('')
    setPage(0)
  }

  const filteredTransactions = transactions

  // Transaction type label helper
  const txTypeLabel = (type: string, isReversal: boolean): string => {
    if (isReversal) return 'Koreksi'
    switch (type) {
      case 'income': return 'Pemasukan'
      case 'expense': return 'Pengeluaran'
      case 'savings_contribution': return 'Alokasi Tabungan'
      case 'savings_withdrawal': return 'Penarikan Tabungan'
      case 'rollover': return 'Rollover'
      case 'adjustment': return 'Penyesuaian'
      default: return type
    }
  }

  // Icon/style helper for transaction rendering
  const getTxStyle = (tx: Transaction) => {
    const isIncome = tx.type === 'income'
    const isSavingsContribution = tx.type === 'savings_contribution'
    const isSavingsWithdrawal = tx.type === 'savings_withdrawal'
    const isReversal = Boolean(tx.reversalOfTransactionId)

    let icon = '↑'
    let iconClass = 'bg-danger/10 border-danger/20 text-danger'
    let amountColor = 'text-danger'
    let amountPrefix = '-'

    if (isReversal) {
      icon = '↩'
      iconClass = 'bg-primary/10 border-primary/20 text-primary'
      amountColor = 'text-text-base'
      amountPrefix = tx.type === 'adjustment' && tx.adjustmentDirection === 'credit' ? '+' : '-'
    } else if (isIncome) {
      icon = '↓'
      iconClass = 'bg-surface-raised border-border text-primary'
      amountColor = 'text-primary'
      amountPrefix = '+'
    } else if (isSavingsContribution) {
      icon = '◎'
      iconClass = 'bg-primary/10 border-primary/20 text-primary'
      amountColor = 'text-primary'
      amountPrefix = '-'
    } else if (isSavingsWithdrawal) {
      icon = '↗'
      iconClass = 'bg-warning/10 border-warning/20 text-warning'
      amountColor = 'text-text-base'
      amountPrefix = '+'
    }

    return { icon, iconClass, amountColor, amountPrefix, isReversal, isIncome, isSavingsContribution, isSavingsWithdrawal }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-text-base">Catatan Transaksi</h2>
        <div className="flex items-center gap-2">
          {transactions.length > 0 && (
            <button
              onClick={() => setIsFilterOpen(!isFilterOpen)}
              className={`text-xs font-semibold transition underline-offset-4 flex items-center gap-1 ${
                isFilterOpen || hasActiveFilters
                  ? 'text-primary'
                  : 'text-text-muted hover:text-text-base'
              }`}
              aria-label="Toggle filter panel"
              id="tx-filter-toggle"
            >
              <span>{hasActiveFilters ? 'Filter Aktif' : 'Cari & Filter'}</span>
            </button>
          )}
          {wallets.length > 0 && !isEntryOpen && (
            <button
              onClick={() => {
                setFormError(null)
                setIsEntryOpen(true)
              }}
              className="text-xs font-semibold text-primary hover:underline underline-offset-4"
            >
              + Catat Transaksi
            </button>
          )}
        </div>
      </div>

      {/* Error alert */}
      {errorMsg && (
        <div
          role="alert"
          className="rounded-2xl bg-danger/10 border border-danger/20 p-3 text-xs text-danger font-medium flex items-center justify-between"
        >
          <span>⚠️ {errorMsg}</span>
          <button onClick={loadData} className="text-xs underline font-bold">
            Coba Lagi
          </button>
        </div>
      )}

      {/* M2.16: Search & Filter Panel */}
      {isFilterOpen && (
        <div className="rounded-3xl bg-surface border border-primary/20 p-4 shadow-sm flex flex-col gap-3 animate-in fade-in duration-200">
          {/* Search input */}
          <div className="flex flex-col gap-1">
            <label htmlFor="tx-search" className="text-xs font-medium text-text-muted">
              Cari Keterangan
            </label>
            <input
              id="tx-search"
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setPage(0)
              }}
              placeholder="Ketik untuk mencari..."
              className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-text-base outline-none focus:border-primary"
            />
          </div>

          {/* Type, Wallet & Goal filters */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="tx-filter-type" className="text-xs font-medium text-text-muted">
                Tipe
              </label>
              <select
                id="tx-filter-type"
                value={filterType}
                onChange={(e) => {
                  setFilterType(e.target.value)
                  setPage(0)
                }}
                className="rounded-xl border border-border bg-surface px-2.5 py-2 text-xs text-text-base outline-none focus:border-primary"
              >
                <option value="all">Semua Tipe</option>
                <option value="income">Pemasukan</option>
                <option value="expense">Pengeluaran</option>
                <option value="savings_contribution">Alokasi Tabungan</option>
                <option value="savings_withdrawal">Penarikan Tabungan</option>
                <option value="rollover">Rollover</option>
                <option value="adjustment">Penyesuaian</option>
                <option value="reversal">Koreksi (Reversal)</option>
                <option value="reversed">Sudah Dibatalkan</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="tx-filter-wallet" className="text-xs font-medium text-text-muted">
                Dompet
              </label>
              <select
                id="tx-filter-wallet"
                value={filterWalletId}
                onChange={(e) => {
                  setFilterWalletId(e.target.value)
                  setPage(0)
                }}
                className="rounded-xl border border-border bg-surface px-2.5 py-2 text-xs text-text-base outline-none focus:border-primary"
              >
                <option value="all">Semua Dompet</option>
                {wallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="tx-filter-goal" className="text-xs font-medium text-text-muted">
                Tujuan Tabungan
              </label>
              <select
                id="tx-filter-goal"
                value={filterGoalId}
                onChange={(e) => {
                  setFilterGoalId(e.target.value)
                  setPage(0)
                }}
                className="rounded-xl border border-border bg-surface px-2.5 py-2 text-xs text-text-base outline-none focus:border-primary"
              >
                <option value="all">Semua Tujuan</option>
                {goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Date range */}
          <div className="flex gap-2">
            <div className="flex-1 flex flex-col gap-1">
              <label htmlFor="tx-filter-from" className="text-xs font-medium text-text-muted">
                Dari Tanggal
              </label>
              <input
                id="tx-filter-from"
                type="date"
                value={filterDateFrom}
                onChange={(e) => {
                  setFilterDateFrom(e.target.value)
                  setPage(0)
                }}
                className="rounded-xl border border-border bg-surface px-2.5 py-2 text-xs text-text-base outline-none focus:border-primary"
              />
            </div>
            <div className="flex-1 flex flex-col gap-1">
              <label htmlFor="tx-filter-to" className="text-xs font-medium text-text-muted">
                Sampai Tanggal
              </label>
              <input
                id="tx-filter-to"
                type="date"
                value={filterDateTo}
                onChange={(e) => {
                  setFilterDateTo(e.target.value)
                  setPage(0)
                }}
                className="rounded-xl border border-border bg-surface px-2.5 py-2 text-xs text-text-base outline-none focus:border-primary"
              />
            </div>
          </div>

          {/* Sort toggle & clear */}
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={() => setSortNewestFirst(!sortNewestFirst)}
              className="text-xs font-medium text-text-muted hover:text-text-base transition flex items-center gap-1"
              id="tx-sort-toggle"
            >
              {sortNewestFirst ? '↓ Terbaru' : '↑ Terlama'}
            </button>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-xs font-semibold text-danger hover:underline underline-offset-2"
                id="tx-clear-filters"
              >
                Hapus Filter
              </button>
            )}
          </div>
        </div>
      )}

      {/* Filter summary badge (when panel closed but filters active) */}
      {!isFilterOpen && hasActiveFilters && (
        <div className="flex items-center justify-between rounded-2xl bg-primary/5 border border-primary/15 px-3.5 py-2">
          <span className="text-[11px] font-medium text-primary">
            🔍 Filter aktif • {totalCount} transaksi ditemukan
          </span>
          <button
            type="button"
            onClick={clearFilters}
            className="text-[11px] font-semibold text-danger hover:underline underline-offset-2"
          >
            Reset Filter
          </button>
        </div>
      )}

      {/* Transaction Entry Drawer / Form */}
      {isEntryOpen && (
        <div className="rounded-3xl bg-surface border border-primary/30 p-5 shadow-sm flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-text-base">Catat Transaksi Baru</h3>
            <button
              onClick={() => setIsEntryOpen(false)}
              className="text-xs text-text-muted hover:text-text-base"
            >
              Tutup
            </button>
          </div>

          {formError && (
            <div
              role="alert"
              className="rounded-xl bg-danger/10 border border-danger/20 p-2.5 text-xs text-danger font-medium"
            >
              ⚠️ {formError}
            </div>
          )}

          <form onSubmit={handleCreateTx} className="flex flex-col gap-3.5">
            {/* Income / Expense Toggle */}
            <div className="flex rounded-2xl bg-surface-raised p-1 border border-border">
              <button
                type="button"
                onClick={() => setTxType('expense')}
                className={`flex-1 py-2 text-xs font-bold rounded-xl transition ${
                  txType === 'expense'
                    ? 'bg-danger text-text-inverse shadow-sm'
                    : 'text-text-muted hover:text-text-base'
                }`}
              >
                Pengeluaran
              </button>
              <button
                type="button"
                onClick={() => setTxType('income')}
                className={`flex-1 py-2 text-xs font-bold rounded-xl transition ${
                  txType === 'income'
                    ? 'bg-primary text-text-inverse shadow-sm'
                    : 'text-text-muted hover:text-text-base'
                }`}
              >
                Pemasukan
              </button>
            </div>

            {/* Wallet Selection */}
            <div className="flex flex-col gap-1">
              <label htmlFor="tx-wallet" className="text-xs font-medium text-text-muted">
                Pilih Dompet
              </label>
              <select
                id="tx-wallet"
                value={selectedWalletId}
                onChange={(e) => setSelectedWalletId(e.target.value)}
                required
                className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-text-base outline-none focus:border-primary"
              >
                {wallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label} ({w.type === 'cash' ? 'Tunai' : 'Digital'}) — {formatRupiah(w.balance)}
                  </option>
                ))}
              </select>
            </div>

            {/* Amount */}
            <div className="flex flex-col gap-1">
              <label htmlFor="tx-amount" className="text-xs font-medium text-text-muted">
                Nominal (Rp)
              </label>
              <input
                id="tx-amount"
                type="text"
                inputMode="numeric"
                required
                value={amountStr}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '')
                  if (!val) {
                    setAmountStr('')
                  } else {
                    const parsed = parseInt(val, 10)
                    setAmountStr(parsed.toLocaleString('id-ID'))
                  }
                }}
                placeholder="Contoh: 50.000"
                className="rounded-xl border border-border bg-surface px-3 py-2 text-sm font-bold font-mono text-text-base outline-none focus:border-primary"
              />
            </div>

            {/* Date */}
            <div className="flex flex-col gap-1">
              <label htmlFor="tx-date" className="text-xs font-medium text-text-muted">
                Tanggal
              </label>
              <input
                id="tx-date"
                type="date"
                required
                value={txDate}
                onChange={(e) => setTxDate(e.target.value)}
                className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-text-base outline-none focus:border-primary"
              />
            </div>

            {/* Description */}
            <div className="flex flex-col gap-1">
              <label htmlFor="tx-desc" className="text-xs font-medium text-text-muted">
                Keterangan (opsional)
              </label>
              <input
                id="tx-desc"
                type="text"
                maxLength={255}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Contoh: Makan Siang / Gaji Bulanan"
                className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-text-base outline-none focus:border-primary"
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 rounded-xl bg-primary py-2.5 text-xs font-semibold text-text-inverse hover:opacity-95 disabled:opacity-50"
              >
                {isSubmitting ? 'Mencatat...' : 'Simpan Transaksi'}
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => setIsEntryOpen(false)}
                className="flex-1 rounded-xl border border-border bg-surface py-2.5 text-xs font-semibold text-text-muted hover:bg-surface-raised"
              >
                Batal
              </button>
            </div>
          </form>
        </div>
      )}

      {/* History List */}
      {isLoading ? (
        <div className="flex flex-col gap-2.5">
          <div className="h-16 animate-pulse rounded-2xl bg-surface border border-border" />
          <div className="h-16 animate-pulse rounded-2xl bg-surface border border-border" />
        </div>
      ) : transactions.length === 0 ? (
        <div className="rounded-3xl bg-surface border border-border p-6 text-center flex flex-col items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-surface-raised border border-border text-primary">
            <FileText size={20} />
          </div>
          <p className="text-xs font-bold text-text-base">Belum Ada Transaksi</p>
          <p className="text-[11px] text-text-muted max-w-xs">
            Catat pemasukan atau pengeluaran harianmu untuk memperbarui saldo dompet secara akurat.
          </p>
          {wallets.length > 0 && !isEntryOpen && (
            <button
              onClick={() => setIsEntryOpen(true)}
              className="mt-1 rounded-xl bg-primary px-3.5 py-1.5 text-xs font-semibold text-text-inverse shadow-sm"
            >
              + Catat Sekarang
            </button>
          )}
        </div>
      ) : transactions.length === 0 && hasActiveFilters ? (
        <div className="rounded-3xl bg-surface border border-border p-6 text-center flex flex-col items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-surface-raised border border-border text-primary">
            <Clock3 size={20} />
          </div>
          <p className="text-xs font-bold text-text-base">Tidak Ditemukan</p>
          <p className="text-[11px] text-text-muted max-w-xs">
            Tidak ada transaksi yang cocok dengan filter atau kata kunci pencarian yang dipilih.
          </p>
          <button
            onClick={clearFilters}
            className="mt-1 rounded-xl border border-primary/30 bg-primary/5 px-3.5 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10 transition"
          >
            Hapus Semua Filter
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {filteredTransactions.map((tx) => {
            const style = getTxStyle(tx)
            const isReversible =
              !tx.isReversed &&
              !style.isReversal &&
              ['income', 'expense', 'savings_contribution', 'savings_withdrawal'].includes(tx.type)

            const wallet = walletMap.get(tx.walletId)

            return (
              <div
                key={tx.id}
                className={`rounded-2xl bg-surface border p-3.5 shadow-sm flex flex-col gap-2 transition cursor-pointer hover:border-primary/30 ${
                  tx.isReversed ? 'border-border/60 opacity-75' : 'border-border'
                }`}
                onClick={() => setDetailTx(tx)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailTx(tx) } }}
                aria-label={`Detail transaksi ${tx.description || txTypeLabel(tx.type, style.isReversal)}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-2xl border text-sm ${style.iconClass}`}
                    >
                      {style.icon}
                    </span>
                    <div className="flex flex-col">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className={`text-xs font-bold ${tx.isReversed ? 'line-through text-text-muted' : 'text-text-base'}`}>
                          {tx.description ||
                            (style.isIncome
                              ? 'Pemasukan'
                              : style.isSavingsContribution
                              ? 'Alokasi Tabungan'
                              : style.isSavingsWithdrawal
                              ? 'Penarikan Tabungan'
                              : 'Pengeluaran')}
                        </p>
                        {tx.isReversed && (
                          <span className="rounded-md bg-danger/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-danger border border-danger/20">
                            Dibatalkan
                          </span>
                        )}
                        {style.isReversal && (
                          <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary border border-primary/20">
                            Koreksi
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-text-muted">
                        {tx.transactionDate} • {wallet?.label || 'Dompet'}
                        {tx.reversalReason && ` • Alasan: "${tx.reversalReason}"`}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col items-end">
                    <span
                      className={`text-xs font-bold font-mono ${
                        tx.isReversed ? 'text-text-muted line-through' : style.amountColor
                      }`}
                    >
                      {style.amountPrefix} {formatRupiah(tx.amount)}
                    </span>
                    <span className="text-[10px] uppercase font-bold text-text-muted tracking-wider">
                      {style.isReversal
                        ? 'Reversal'
                        : style.isSavingsContribution
                        ? 'Nabung'
                        : style.isSavingsWithdrawal
                        ? 'Tarik'
                        : tx.type}
                    </span>
                  </div>
                </div>

                {/* Reversal action for eligible transactions */}
                {isReversible && (
                  <div className="flex justify-end pt-1 border-t border-border/40">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleOpenReversal(tx) }}
                      className="text-[11px] font-medium text-danger/80 hover:text-danger hover:underline underline-offset-2 transition"
                    >
                      Batalkan Transaksi
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* M2.16 Server-Side Pagination Bar */}
      {totalCount > PAGE_SIZE && (
        <div className="flex items-center justify-between px-1 py-2 text-xs">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0 || isLoading}
            className="flex items-center gap-1 rounded-xl border border-border bg-surface px-3 py-1.5 font-medium text-text-base hover:bg-surface-raised disabled:opacity-40 transition"
            id="tx-prev-page"
          >
            ← Sebelumnya
          </button>
          <span className="text-[11px] text-text-muted">
            Hal. {page + 1} dari {Math.ceil(totalCount / PAGE_SIZE)} ({totalCount} total)
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasMore || (page + 1) * PAGE_SIZE >= totalCount || isLoading}
            className="flex items-center gap-1 rounded-xl border border-border bg-surface px-3 py-1.5 font-medium text-text-base hover:bg-surface-raised disabled:opacity-40 transition"
            id="tx-next-page"
          >
            Berikutnya →
          </button>
        </div>
      )}

      {/* M2.16: Transaction Detail Drawer */}
      {detailTx && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4 backdrop-blur-xs" onClick={() => setDetailTx(null)}>
          <div
            className="w-full max-w-sm rounded-3xl bg-surface border border-border p-5 shadow-xl flex flex-col gap-4 max-h-[85dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-text-base">Detail Transaksi</h3>
              <button
                type="button"
                onClick={() => setDetailTx(null)}
                className="text-xs text-text-muted hover:text-text-base"
                aria-label="Tutup detail"
              >
                ✕
              </button>
            </div>

            {(() => {
              const style = getTxStyle(detailTx)
              const wallet = walletMap.get(detailTx.walletId)
              const goal = detailTx.goalId ? goalMap.get(detailTx.goalId) : null
              return (
                <>
                  {/* Amount hero */}
                  <div className="flex items-center justify-center gap-2 py-3">
                    <span className={`flex h-11 w-11 items-center justify-center rounded-2xl border text-base ${style.iconClass}`}>
                      {style.icon}
                    </span>
                    <span className={`text-xl font-bold font-mono ${detailTx.isReversed ? 'text-text-muted line-through' : style.amountColor}`}>
                      {style.amountPrefix} {formatRupiah(detailTx.amount)}
                    </span>
                  </div>

                  {/* Status badges */}
                  <div className="flex items-center justify-center gap-2 flex-wrap">
                    <span className="rounded-lg bg-surface-raised border border-border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-text-muted">
                      {txTypeLabel(detailTx.type, style.isReversal)}
                    </span>
                    {detailTx.isReversed && (
                      <span className="rounded-lg bg-danger/10 border border-danger/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-danger">
                        Dibatalkan
                      </span>
                    )}
                  </div>

                  {/* Detail fields */}
                  <div className="rounded-2xl bg-surface-raised border border-border p-3.5 flex flex-col gap-2.5 text-xs">
                    {detailTx.description && (
                      <div className="flex justify-between gap-3">
                        <span className="text-text-muted shrink-0">Keterangan</span>
                        <span className="text-text-base text-right font-medium break-words max-w-[65%]">{detailTx.description}</span>
                      </div>
                    )}
                    <div className="flex justify-between gap-3">
                      <span className="text-text-muted shrink-0">Tanggal</span>
                      <span className="text-text-base font-medium">{detailTx.transactionDate}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-text-muted shrink-0">Dompet</span>
                      <span className="text-text-base font-medium">{wallet?.label || '—'}</span>
                    </div>
                    {goal && (
                      <div className="flex justify-between gap-3">
                        <span className="text-text-muted shrink-0">Tujuan</span>
                        <span className="text-text-base font-medium">{goal.name}</span>
                      </div>
                    )}
                    {detailTx.adjustmentDirection && (
                      <div className="flex justify-between gap-3">
                        <span className="text-text-muted shrink-0">Arah Penyesuaian</span>
                        <span className="text-text-base font-medium capitalize">{detailTx.adjustmentDirection}</span>
                      </div>
                    )}
                    {detailTx.reversalOfTransactionId && (
                      <div className="flex justify-between gap-3">
                        <span className="text-text-muted shrink-0">Koreksi Dari Transaksi</span>
                        <span className="text-text-base font-mono text-[10px]" title={detailTx.reversalOfTransactionId}>
                          {detailTx.reversalOfTransactionId.slice(0, 8)}…
                        </span>
                      </div>
                    )}
                    {detailTx.reversalReason && (
                      <div className="flex justify-between gap-3">
                        <span className="text-text-muted shrink-0">Alasan Pembatalan</span>
                        <span className="text-text-base font-medium text-right break-words max-w-[65%]">{detailTx.reversalReason}</span>
                      </div>
                    )}
                    {detailTx.reversedByTransactionId && (
                      <div className="flex justify-between gap-3">
                        <span className="text-text-muted shrink-0">Dibatalkan Oleh</span>
                        <span className="text-text-base font-mono text-[10px]" title={detailTx.reversedByTransactionId}>
                          {detailTx.reversedByTransactionId.slice(0, 8)}…
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between gap-3 pt-1 border-t border-border/40">
                      <span className="text-text-muted shrink-0">Waktu Pencatatan</span>
                      <span className="text-text-muted text-[10px]">{new Date(detailTx.createdAt).toLocaleString('id-ID')}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-text-muted shrink-0">ID Transaksi</span>
                      <span className="text-text-muted font-mono text-[10px]" title={detailTx.id}>
                        {detailTx.id.slice(0, 8)}…{detailTx.id.slice(-4)}
                      </span>
                    </div>
                  </div>
                </>
              )
            })()}

            <button
              type="button"
              onClick={() => setDetailTx(null)}
              className="rounded-xl border border-border bg-surface py-2.5 text-xs font-semibold text-text-muted hover:bg-surface-raised w-full"
            >
              Tutup
            </button>
          </div>
        </div>
      )}

      {/* Reversal Modal */}
      {reversingTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-3xl bg-surface border border-border p-5 shadow-xl flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-text-base">Batalkan Transaksi</h3>
              <button
                type="button"
                disabled={isSubmittingReversal}
                onClick={handleCloseReversal}
                className="text-xs text-text-muted hover:text-text-base disabled:opacity-50"
              >
                ✕
              </button>
            </div>

            <div className="rounded-2xl bg-surface-raised border border-border p-3 flex flex-col gap-1.5 text-xs">
              <div className="flex justify-between text-text-muted">
                <span>Tipe:</span>
                <span className="font-semibold text-text-base capitalize">
                  {reversingTx.type.replace('_', ' ')}
                </span>
              </div>
              <div className="flex justify-between text-text-muted">
                <span>Nominal:</span>
                <span className="font-bold font-mono text-text-base">
                  {formatRupiah(reversingTx.amount)}
                </span>
              </div>
              <div className="flex justify-between text-text-muted">
                <span>Tanggal:</span>
                <span className="text-text-base">{reversingTx.transactionDate}</span>
              </div>
              {reversingTx.description && (
                <div className="flex justify-between text-text-muted">
                  <span>Keterangan:</span>
                  <span className="text-text-base">{reversingTx.description}</span>
                </div>
              )}
            </div>

            <p className="text-[11px] text-text-muted leading-relaxed">
              Transaksi asli akan tetap tercatat dalam riwayat sebagai arsip audit. Sistem akan membuat transaksi koreksi untuk mengembalikan saldo secara otomatis.
            </p>

            {reversalError && (
              <div
                role="alert"
                className="rounded-xl bg-danger/10 border border-danger/20 p-2.5 text-xs text-danger font-medium"
              >
                ⚠️ {reversalError}
              </div>
            )}

            <form onSubmit={handleExecuteReversal} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor="reversal-reason" className="text-xs font-medium text-text-muted">
                  Alasan Pembatalan <span className="text-danger">*</span>
                </label>
                <input
                  id="reversal-reason"
                  type="text"
                  required
                  maxLength={500}
                  value={reversalReason}
                  onChange={(e) => setReversalReason(e.target.value)}
                  placeholder="Contoh: Salah nominal / duplikat"
                  className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-text-base outline-none focus:border-primary"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  disabled={isSubmittingReversal}
                  onClick={handleCloseReversal}
                  className="flex-1 rounded-xl border border-border bg-surface py-2.5 text-xs font-semibold text-text-muted hover:bg-surface-raised disabled:opacity-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingReversal}
                  className="flex-1 rounded-xl bg-danger py-2.5 text-xs font-semibold text-text-inverse hover:opacity-95 disabled:opacity-50"
                >
                  {isSubmittingReversal ? 'Memproses...' : 'Konfirmasi Batalkan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function ActivitySection({ walletRefreshKey }: { walletRefreshKey: number }) {
  const [events, setEvents] = useState<FinancialAuditEvent[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [filter, setFilter] = useState<AuditFilterCategory>('all')

  const loadEvents = async () => {
    setIsLoading(true)
    setErrorMsg(null)
    const { data, error } = await getFinancialAuditEvents(30)
    if (error) {
      setErrorMsg(error)
    } else {
      setEvents(data)
    }
    setIsLoading(false)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadEvents()
  }, [walletRefreshKey])

  const filteredEvents = events.filter((e) => matchesAuditFilter(e.eventType, filter))

  const filterTabs: { id: AuditFilterCategory; label: string }[] = [
    { id: 'all', label: 'Semua' },
    { id: 'transactions', label: 'Transaksi' },
    { id: 'savings', label: 'Tabungan' },
    { id: 'reversals', label: 'Pembatalan' },
    { id: 'rollover', label: 'Rollover' },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-text-base">Aktivitas Keuangan</h2>
            <span className="rounded-full bg-surface-raised px-2 py-0.5 text-[10px] font-bold text-text-muted border border-border">
              Audit Trail
            </span>
          </div>
          <button
            onClick={loadEvents}
            className="text-xs font-semibold text-primary hover:underline underline-offset-4"
          >
            Perbarui
          </button>
        </div>
        <p className="text-[11px] text-text-muted">
          Catatan kronologis peristiwa sistem (informasional). Saldo dompet dan target dihitung secara otoritatif dari buku besar transaksi.
        </p>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs">
        {filterTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setFilter(tab.id)}
            className={`rounded-xl px-3 py-1.5 font-medium transition shrink-0 ${
              filter === tab.id
                ? 'bg-primary text-text-inverse shadow-sm'
                : 'bg-surface border border-border text-text-muted hover:text-text-base'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Error alert */}
      {errorMsg && (
        <div
          role="alert"
          className="rounded-2xl bg-danger/10 border border-danger/20 p-3 text-xs text-danger font-medium flex items-center justify-between"
        >
          <span>⚠️ {errorMsg}</span>
          <button onClick={loadEvents} className="text-xs underline font-bold">
            Coba Lagi
          </button>
        </div>
      )}

      {/* Activity List */}
      {isLoading ? (
        <div className="flex flex-col gap-2">
          <div className="h-14 animate-pulse rounded-2xl bg-surface border border-border" />
          <div className="h-14 animate-pulse rounded-2xl bg-surface border border-border" />
        </div>
      ) : filteredEvents.length === 0 ? (
        <div className="rounded-3xl bg-surface border border-border p-5 text-center flex flex-col items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-surface-raised border border-border text-primary">
            <Activity size={20} />
          </div>
          <p className="text-xs font-bold text-text-base">Belum Ada Catatan Aktivitas</p>
          <p className="text-[11px] text-text-muted">
            Setiap transaksi, tabungan, pembatalan, atau evaluasi anggaran akan terekam secara otomatis di sini.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filteredEvents.map((evt) => {
            const formatted = formatAuditEvent(evt)
            const dateStr = new Date(evt.createdAt).toLocaleString('id-ID', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })

            return (
              <div
                key={evt.id}
                className="rounded-2xl bg-surface border border-border p-3 shadow-xs flex items-center justify-between gap-3 text-xs"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border text-sm ${formatted.badgeColor}`}
                  >
                    {formatted.icon}
                  </span>
                  <div className="flex flex-col min-w-0">
                    <span className="font-bold text-text-base truncate">
                      {formatted.title}
                    </span>
                    <span className="text-[11px] text-text-muted truncate">
                      {formatted.description}
                    </span>
                    <span className="text-[10px] text-text-muted/70">
                      {dateStr}
                    </span>
                  </div>
                </div>

                {formatted.amount !== null && (
                  <div className="flex flex-col items-end shrink-0">
                    <span className="font-bold font-mono text-text-base text-xs">
                      {formatRupiah(formatted.amount)}
                    </span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function BudgetSection({
  walletRefreshKey,
  onBudgetChange,
}: {
  walletRefreshKey: number
  onBudgetChange: () => void
}) {
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [allocations, setAllocations] = useState<BudgetAllocation[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Creation form state
  const [isCreating, setIsCreating] = useState(false)
  const [selectedWalletId, setSelectedWalletId] = useState<string>('')
  const [category, setCategory] = useState<BudgetCategory>('food')
  const [customLabel, setCustomLabel] = useState('')
  const [period, setPeriod] = useState<BudgetPeriod>('monthly')
  const [intervalDaysStr, setIntervalDaysStr] = useState('4')
  const [amountStr, setAmountStr] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editAmountStr, setEditAmountStr] = useState('')
  const [editPeriod, setEditPeriod] = useState<BudgetPeriod>('monthly')
  const [editIntervalDaysStr, setEditIntervalDaysStr] = useState('4')
  const [editCustomLabel, setEditCustomLabel] = useState('')
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const loadData = async () => {
    setIsLoading(true)
    setErrorMsg(null)

    const [walletsRes, budgetsRes] = await Promise.all([
      getWallets(),
      getBudgetAllocations(),
    ])

    if (walletsRes.error) {
      setErrorMsg(walletsRes.error)
    } else {
      setWallets(walletsRes.data)
      if (!selectedWalletId && walletsRes.data.length > 0) {
        setSelectedWalletId(walletsRes.data[0].id)
      }
    }

    if (budgetsRes.error) {
      setErrorMsg(budgetsRes.error)
    } else {
      setAllocations(budgetsRes.data)
    }

    setIsLoading(false)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletRefreshKey])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSubmitting) return

    setFormError(null)

    const cleanAmount = parseInt(amountStr.replace(/\D/g, ''), 10)
    if (isNaN(cleanAmount) || cleanAmount <= 0) {
      setFormError('Nominal anggaran harus lebih besar dari 0.')
      return
    }

    if (!selectedWalletId) {
      setFormError('Pilih dompet sumber terlebih dahulu.')
      return
    }

    if (category === 'other' && !customLabel.trim()) {
      setFormError('Label wajib diisi untuk kategori Lainnya.')
      return
    }

    let parsedIntervalDays: number | null = null
    if (period === 'interval') {
      const days = parseInt(intervalDaysStr.replace(/\D/g, ''), 10)
      if (isNaN(days) || days <= 0) {
        setFormError('Jumlah hari interval harus lebih besar dari 0.')
        return
      }
      parsedIntervalDays = days
    }

    setIsSubmitting(true)

    const { data, error } = await createBudgetAllocation({
      walletId: selectedWalletId,
      category,
      customLabel: category === 'other' ? customLabel.trim() : null,
      originalAmount: cleanAmount,
      period,
      intervalDays: parsedIntervalDays,
    })

    if (error) {
      setFormError(error)
      setIsSubmitting(false)
      return
    }

    if (data) {
      setAllocations((prev) => [data, ...prev])
      setIsCreating(false)
      setAmountStr('')
      setCustomLabel('')
      setCategory('food')
      setPeriod('monthly')
      setIntervalDaysStr('4')
      onBudgetChange()
    }

    setIsSubmitting(false)
  }

  const handleStartEdit = (item: BudgetAllocation) => {
    setEditingId(item.id)
    setEditAmountStr(item.originalAmount.toLocaleString('id-ID'))
    setEditPeriod(item.period)
    setEditIntervalDaysStr(item.intervalDays ? String(item.intervalDays) : '4')
    setEditCustomLabel(item.customLabel || '')
    setEditError(null)
  }

  const handleSaveEdit = async (e: React.FormEvent, item: BudgetAllocation) => {
    e.preventDefault()
    if (isSubmittingEdit) return

    setEditError(null)

    const cleanAmount = parseInt(editAmountStr.replace(/\D/g, ''), 10)
    if (isNaN(cleanAmount) || cleanAmount <= 0) {
      setEditError('Nominal anggaran harus lebih besar dari 0.')
      return
    }

    if (item.category === 'other' && !editCustomLabel.trim()) {
      setEditError('Label wajib diisi untuk kategori Lainnya.')
      return
    }

    let parsedEditIntervalDays: number | null = null
    if (editPeriod === 'interval') {
      const days = parseInt(editIntervalDaysStr.replace(/\D/g, ''), 10)
      if (isNaN(days) || days <= 0) {
        setEditError('Jumlah hari interval harus lebih besar dari 0.')
        return
      }
      parsedEditIntervalDays = days
    }

    setIsSubmittingEdit(true)

    const { data, error } = await updateBudgetAllocation(
      item.id,
      {
        originalAmount: cleanAmount,
        period: editPeriod,
        intervalDays: parsedEditIntervalDays,
        customLabel: item.category === 'other' ? editCustomLabel.trim() : null,
      },
      {
        originalAmount: item.originalAmount,
        period: item.period,
        intervalDays: item.intervalDays,
        category: item.category,
      }
    )

    if (error) {
      setEditError(error)
      setIsSubmittingEdit(false)
      return
    }

    if (data) {
      setAllocations((prev) => prev.map((a) => (a.id === item.id ? data : a)))
      setEditingId(null)
      onBudgetChange()
    }

    setIsSubmittingEdit(false)
  }

  const handleDelete = async (id: string) => {
    const { success, error } = await deleteBudgetAllocation(id)
    if (!success && error) {
      setErrorMsg(error)
      return
    }
    setAllocations((prev) => prev.filter((a) => a.id !== id))
    onBudgetChange()
  }

  const walletMap = new Map<string, Wallet>()
  wallets.forEach((w) => walletMap.set(w.id, w))

  const getCategoryDisplay = (cat: BudgetCategory, custom: string | null) => {
    switch (cat) {
      case 'food':
        return { label: 'Makanan & Minuman', icon: '•' }
      case 'transport':
        return { label: 'Transportasi', icon: '•' }
      case 'other':
        return { label: custom || 'Lain-lain', icon: '•' }
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <h2 className="text-base font-bold text-text-base">Alokasi Anggaran</h2>
          <span className="text-[11px] text-text-muted">Perencanaan pengeluaran operasional bulanan</span>
        </div>
        {wallets.length > 0 && !isCreating && (
          <button
            onClick={() => {
              setFormError(null)
              setIsCreating(true)
            }}
            className="text-xs font-semibold text-primary hover:underline underline-offset-4"
          >
            + Buat Anggaran
          </button>
        )}
      </div>

      {/* Global Error Banner */}
      {errorMsg && (
        <div
          role="alert"
          className="rounded-2xl bg-danger/10 border border-danger/20 p-3 text-xs text-danger font-medium flex items-center justify-between"
        >
          <span>⚠️ {errorMsg}</span>
          <button onClick={loadData} className="text-xs underline font-bold">
            Coba Lagi
          </button>
        </div>
      )}

      {/* Create Budget Drawer */}
      {isCreating && (
        <div className="rounded-3xl bg-surface border border-primary/30 p-5 shadow-sm flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-text-base">Tambah Anggaran Operasional</h3>
            <button
              onClick={() => setIsCreating(false)}
              className="text-xs text-text-muted hover:text-text-base"
            >
              Tutup
            </button>
          </div>

          {formError && (
            <div
              role="alert"
              className="rounded-xl bg-danger/10 border border-danger/20 p-2.5 text-xs text-danger font-medium"
            >
              ⚠️ {formError}
            </div>
          )}

          <form onSubmit={handleCreate} className="flex flex-col gap-3.5">
            {/* Wallet Selection */}
            <div className="flex flex-col gap-1">
              <label htmlFor="budget-wallet" className="text-xs font-medium text-text-muted">
                Dompet Sumber Dana
              </label>
              <select
                id="budget-wallet"
                value={selectedWalletId}
                onChange={(e) => setSelectedWalletId(e.target.value)}
                required
                className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-text-base outline-none focus:border-primary"
              >
                {wallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label} ({w.type === 'cash' ? 'Tunai' : 'Digital'}) — Saldo: {formatRupiah(w.balance)}
                  </option>
                ))}
              </select>
            </div>

            {/* Category Selection */}
            <div className="flex flex-col gap-1">
              <label htmlFor="budget-category" className="text-xs font-medium text-text-muted">
                Kategori
              </label>
              <select
                id="budget-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as BudgetCategory)}
                className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-text-base outline-none focus:border-primary"
              >
                <option value="food">Makanan &amp; Minuman (Food)</option>
                <option value="transport">Transportasi (Transport)</option>
                <option value="other">Lainnya (Custom Label)</option>
              </select>
            </div>

            {category === 'other' && (
              <div className="flex flex-col gap-1">
                <label htmlFor="budget-custom-label" className="text-xs font-medium text-text-muted">
                  Nama Kategori Khusus
                </label>
                <input
                  id="budget-custom-label"
                  type="text"
                  maxLength={50}
                  required
                  value={customLabel}
                  onChange={(e) => setCustomLabel(e.target.value)}
                  placeholder="Contoh: Hiburan / Langganan"
                  className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-text-base outline-none focus:border-primary"
                />
              </div>
            )}

            {/* Period Selection */}
            <div className="flex flex-col gap-1">
              <label htmlFor="budget-period" className="text-xs font-medium text-text-muted">
                Periode Anggaran
              </label>
              <select
                id="budget-period"
                value={period}
                onChange={(e) => setPeriod(e.target.value as BudgetPeriod)}
                className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-text-base outline-none focus:border-primary"
              >
                <option value="monthly">Bulanan (Monthly)</option>
                <option value="weekly">Mingguan (Weekly — dinormalisasi 4.3x)</option>
                <option value="interval">Setiap beberapa hari (Interval)</option>
              </select>
            </div>

            {/* Custom Interval Days Input */}
            {period === 'interval' && (
              <div className="flex flex-col gap-1">
                <label htmlFor="budget-interval-days" className="text-xs font-medium text-text-muted">
                  Setiap Berapa Hari
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="budget-interval-days"
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={intervalDaysStr}
                    onChange={(e) => setIntervalDaysStr(e.target.value)}
                    placeholder="4"
                    className="w-24 rounded-xl border border-border bg-surface px-3 py-2 text-xs font-mono font-bold text-text-base outline-none focus:border-primary"
                  />
                  <span className="text-xs text-text-muted">hari</span>
                </div>
              </div>
            )}

            {/* Amount */}
            <div className="flex flex-col gap-1">
              <label htmlFor="budget-amount" className="text-xs font-medium text-text-muted">
                Jumlah ({period === 'weekly' ? 'per Minggu' : period === 'interval' ? `per ${intervalDaysStr || 'X'} Hari` : 'per Bulan'})
              </label>
              <input
                id="budget-amount"
                type="text"
                inputMode="numeric"
                required
                value={amountStr}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '')
                  if (!val) {
                    setAmountStr('')
                  } else {
                    const parsed = parseInt(val, 10)
                    setAmountStr(parsed.toLocaleString('id-ID'))
                  }
                }}
                placeholder="Contoh: 50.000"
                className="rounded-xl border border-border bg-surface px-3 py-2 text-sm font-bold font-mono text-text-base outline-none focus:border-primary"
              />
              {period === 'weekly' && amountStr && (
                <span className="text-[11px] text-text-muted mt-0.5">
                  Estimasi budget bulanan:{' '}
                  <strong className="text-text-base">
                    {formatRupiah(
                      normalizeToMonthly(parseInt(amountStr.replace(/\D/g, ''), 10) || 0, 'weekly')
                    )}
                  </strong>
                </span>
              )}
              {period === 'interval' && amountStr && parseInt(intervalDaysStr, 10) > 0 && (
                <span className="text-[11px] text-text-muted mt-0.5">
                  Estimasi budget bulanan:{' '}
                  <strong className="text-text-base">
                    {formatRupiah(
                      normalizeToMonthly(
                        parseInt(amountStr.replace(/\D/g, ''), 10) || 0,
                        'interval',
                        parseInt(intervalDaysStr, 10)
                      )
                    )}
                  </strong>
                </span>
              )}
            </div>

            <div className="rounded-xl bg-surface-raised p-2.5 text-[11px] text-text-muted flex items-center gap-1.5">
              <span>ℹ️</span>
              <span>
                Anggaran adalah rencana belanja. Saldo dompet baru berkurang saat Anda mencatat transaksi pengeluaran.
              </span>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 rounded-xl bg-primary py-2.5 text-xs font-semibold text-text-inverse hover:opacity-95 disabled:opacity-50"
              >
                {isSubmitting ? 'Menyimpan...' : 'Simpan Anggaran'}
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => setIsCreating(false)}
                className="flex-1 rounded-xl border border-border bg-surface py-2.5 text-xs font-semibold text-text-muted hover:bg-surface-raised"
              >
                Batal
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Allocations List */}
      {isLoading ? (
        <div className="flex flex-col gap-2.5">
          <div className="h-16 animate-pulse rounded-2xl bg-surface border border-border" />
          <div className="h-16 animate-pulse rounded-2xl bg-surface border border-border" />
        </div>
      ) : wallets.length === 0 ? (
        <div className="rounded-3xl bg-surface border border-border p-6 text-center flex flex-col items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-surface-raised border border-border text-primary">
            <WalletIcon size={20} />
          </div>
          <p className="text-xs font-bold text-text-base">Belum Ada Dompet Sumber</p>
          <p className="text-[11px] text-text-muted max-w-xs">
            Buat dompet terlebih dahulu di bagian atas sebelum mengalokasikan anggaran belanja.
          </p>
        </div>
      ) : allocations.length === 0 ? (
        <div className="rounded-3xl bg-surface border border-border p-6 text-center flex flex-col items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-surface-raised border border-border text-primary">
            <Sliders size={20} />
          </div>
          <p className="text-xs font-bold text-text-base">Belum Ada Anggaran Operasional</p>
          <p className="text-[11px] text-text-muted max-w-xs">
            Rencanakan pos belanja rutinmu seperti makanan dan transportasi agar arus kas terkendali.
          </p>
          {!isCreating && (
            <button
              onClick={() => setIsCreating(true)}
              className="mt-1 rounded-xl bg-primary px-3.5 py-1.5 text-xs font-semibold text-text-inverse shadow-sm"
            >
              + Rencanakan Anggaran
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {allocations.map((item) => {
            const isEditingThis = editingId === item.id
            const wallet = walletMap.get(item.walletId)
            const catDisplay = getCategoryDisplay(item.category, item.customLabel)
            const isWeekly = item.period === 'weekly'
            const isInterval = item.period === 'interval'

            return (
              <div
                key={item.id}
                className="rounded-2xl bg-surface border border-border p-3.5 shadow-sm flex flex-col gap-3"
              >
                {isEditingThis ? (
                  <form
                    onSubmit={(e) => handleSaveEdit(e, item)}
                    className="flex flex-col gap-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-text-muted">
                        Edit Anggaran — {catDisplay.label}
                      </span>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="text-xs text-text-muted hover:text-text-base"
                      >
                        Batal
                      </button>
                    </div>

                    {editError && (
                      <div className="rounded-xl bg-danger/10 border border-danger/20 p-2 text-xs text-danger">
                        ⚠️ {editError}
                      </div>
                    )}

                    {item.category === 'other' && (
                      <input
                        type="text"
                        value={editCustomLabel}
                        onChange={(e) => setEditCustomLabel(e.target.value)}
                        placeholder="Nama Kategori Khusus"
                        maxLength={50}
                        required
                        className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-text-base outline-none focus:border-primary"
                      />
                    )}

                    <div className="flex flex-col gap-2">
                      <div className="flex gap-2">
                        <select
                          value={editPeriod}
                          onChange={(e) => setEditPeriod(e.target.value as BudgetPeriod)}
                          className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-text-base outline-none focus:border-primary"
                        >
                          <option value="monthly">Bulanan</option>
                          <option value="weekly">Mingguan</option>
                          <option value="interval">Setiap beberapa hari</option>
                        </select>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={editAmountStr}
                          onChange={(e) => {
                            const val = e.target.value.replace(/\D/g, '')
                            if (!val) {
                              setEditAmountStr('')
                            } else {
                              const parsed = parseInt(val, 10)
                              setEditAmountStr(parsed.toLocaleString('id-ID'))
                            }
                          }}
                          className="flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-xs font-mono font-bold text-text-base outline-none focus:border-primary"
                        />
                      </div>

                      {editPeriod === 'interval' && (
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-text-muted">Setiap:</label>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            required
                            value={editIntervalDaysStr}
                            onChange={(e) => setEditIntervalDaysStr(e.target.value)}
                            className="w-20 rounded-xl border border-border bg-surface px-3 py-1.5 text-xs font-mono font-bold text-text-base outline-none focus:border-primary"
                          />
                          <span className="text-xs text-text-muted">hari</span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="submit"
                        disabled={isSubmittingEdit}
                        className="flex-1 rounded-xl bg-primary py-2 text-xs font-semibold text-text-inverse hover:opacity-95 disabled:opacity-50"
                      >
                        {isSubmittingEdit ? 'Menyimpan...' : 'Simpan'}
                      </button>
                      <button
                        type="button"
                        disabled={isSubmittingEdit}
                        onClick={() => setEditingId(null)}
                        className="flex-1 rounded-xl border border-border bg-surface py-2 text-xs font-semibold text-text-muted hover:bg-surface-raised"
                      >
                        Batal
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-surface-raised border border-border text-base">
                          {catDisplay.icon}
                        </span>
                        <div className="flex flex-col">
                          <p className="text-xs font-bold text-text-base">{catDisplay.label}</p>
                          <span className="text-[11px] text-text-muted">
                            {wallet?.label || 'Dompet'} • {isWeekly ? 'Mingguan' : isInterval ? `Setiap ${item.intervalDays || 'X'} hari` : 'Bulanan'}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleStartEdit(item)}
                          className="text-xs font-semibold text-primary hover:underline underline-offset-4"
                        >
                          Ubah
                        </button>
                        <button
                          onClick={() => handleDelete(item.id)}
                          className="text-xs font-semibold text-danger/80 hover:text-danger"
                          title="Hapus Anggaran"
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-border flex items-baseline justify-between">
                      <div className="flex flex-col">
                        <span className="text-[11px] text-text-muted">Alokasi Rencana</span>
                        {(isWeekly || isInterval) && (
                          <span className="text-[10px] text-text-muted font-mono">
                            (setara {formatRupiah(item.normalizedMonthlyAmount)}/bln)
                          </span>
                        )}
                      </div>
                      <span className="text-sm font-bold font-mono text-text-base">
                        {formatRupiah(item.originalAmount)}
                        <span className="text-[11px] font-normal text-text-muted font-sans">
                          {isWeekly ? ' /mg' : isInterval ? ` /${item.intervalDays || 'X'}hr` : ' /bln'}
                        </span>
                      </span>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SavingsSection({ refreshKey }: { refreshKey: number }) {
  const now = new Date()
  const [selectedYear, setSelectedYear] = useState<number>(now.getFullYear())
  const [selectedMonth, setSelectedMonth] = useState<number>(now.getMonth() + 1)
  const [savingsData, setSavingsData] = useState<SavingsAllocationCalculation | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const monthNames = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
  ]

  const loadSavings = async () => {
    setIsLoading(true)
    setErrorMsg(null)
    const { data, error } = await getSavingsAllocation(selectedYear, selectedMonth)
    if (error) {
      setErrorMsg(error)
    } else {
      setSavingsData(data)
    }
    setIsLoading(false)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSavings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYear, selectedMonth, refreshKey])

  const handlePrevMonth = () => {
    if (selectedMonth === 1) {
      setSelectedYear((y) => y - 1)
      setSelectedMonth(12)
    } else {
      setSelectedMonth((m) => m - 1)
    }
  }

  const handleNextMonth = () => {
    if (selectedMonth === 12) {
      setSelectedYear((y) => y + 1)
      setSelectedMonth(1)
    } else {
      setSelectedMonth((m) => m + 1)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header with Month Selector */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <h2 className="text-base font-bold text-text-base">Alokasi Tabungan</h2>
          <span className="text-[11px] text-text-muted">Pemasukan dikurangi anggaran operasional</span>
        </div>

        {/* Month Navigation */}
        <div className="flex items-center gap-1 rounded-2xl bg-surface border border-border px-2 py-1 shadow-xs">
          <button
            onClick={handlePrevMonth}
            className="px-1.5 py-0.5 text-xs font-bold text-text-muted hover:text-text-base active:scale-95"
            title="Bulan Sebelumnya"
          >
            ‹
          </button>
          <span className="text-xs font-bold text-text-base min-w-[84px] text-center">
            {monthNames[selectedMonth - 1]} {selectedYear}
          </span>
          <button
            onClick={handleNextMonth}
            className="px-1.5 py-0.5 text-xs font-bold text-text-muted hover:text-text-base active:scale-95"
            title="Bulan Berikutnya"
          >
            ›
          </button>
        </div>
      </div>

      {/* Global Error Banner */}
      {errorMsg && (
        <div
          role="alert"
          className="rounded-2xl bg-danger/10 border border-danger/20 p-3 text-xs text-danger font-medium flex items-center justify-between"
        >
          <span>⚠️ {errorMsg}</span>
          <button onClick={loadSavings} className="text-xs underline font-bold">
            Coba Lagi
          </button>
        </div>
      )}

      {/* Main Savings Allocation Card */}
      {isLoading ? (
        <div className="h-32 animate-pulse rounded-3xl bg-surface border border-border" />
      ) : (
        <div className="rounded-3xl bg-surface border border-border p-5 shadow-sm flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20 text-primary">
                <Target size={20} />
              </span>
              <div className="flex flex-col">
                <span className="text-[11px] font-semibold text-text-muted">
                  Estimasi Alokasi Tabungan
                </span>
                <span className="text-2xl font-black font-mono text-primary">
                  {formatRupiah(savingsData?.savingsAllocation || 0)}
                </span>
              </div>
            </div>

            <span className="rounded-xl bg-surface-raised border border-border px-2.5 py-1 text-[10px] font-bold text-text-muted uppercase tracking-wider">
              {monthNames[selectedMonth - 1].slice(0, 3)} {selectedYear}
            </span>
          </div>

          {/* Breakdown summary */}
          <div className="grid grid-cols-2 gap-2 pt-3 border-t border-border text-xs">
            <div className="flex flex-col">
              <span className="text-text-muted text-[11px]">Total Pemasukan:</span>
              <span className="font-bold font-mono text-text-base">
                {formatRupiah(savingsData?.totalIncome || 0)}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-text-muted text-[11px]">Anggaran Operasional:</span>
              <span className="font-bold font-mono text-text-base">
                {formatRupiah(savingsData?.totalOperationalBudget || 0)}
              </span>
            </div>
          </div>

          {/* Warning state: Budget > Income */}
          {savingsData?.isBudgetOverIncome && (
            <div
              role="alert"
              className="rounded-2xl bg-danger/10 border border-danger/20 p-3 text-xs text-danger font-medium flex items-start gap-2"
            >
              <span>⚠️</span>
              <div className="flex flex-col gap-0.5">
                <span className="font-bold">Anggaran Melebihi Pemasukan</span>
                <span className="text-[11px]">
                  Rencana anggaran operasional Anda melebihi pemasukan bulan ini sebesar{' '}
                  <strong className="font-mono">{formatRupiah(savingsData.budgetOverIncomeAmount)}</strong>.
                  Alokasi tabungan ditahan di Rp 0.
                </span>
              </div>
            </div>
          )}

          {/* Zero income informative callout */}
          {savingsData && savingsData.totalIncome === 0 && (
            <div className="rounded-2xl bg-surface-raised p-2.5 text-[11px] text-text-muted flex items-center gap-1.5">
              <span>ℹ️</span>
              <span>
                Belum ada transaksi pemasukan yang tercatat untuk bulan ini. Catat pemasukan di bawah agar alokasi tabungan terhitung.
              </span>
            </div>
          )}

          {/* Footnote about allocation concept */}
          <div className="text-[10px] text-text-muted text-center pt-1 border-t border-border/50">
            Alokasi tabungan adalah porsi pendapatan yang dialokasikan untuk ditabung (bukan pemindahan saldo fisik).
          </div>
        </div>
      )}
    </div>
  )
}

function MonthTransitionSection({
  walletRefreshKey,
  onDecisionApplied,
}: {
  walletRefreshKey: number
  onDecisionApplied: () => void
}) {
  const now = new Date()
  const [selectedYear, setSelectedYear] = useState<number>(now.getFullYear())
  const [selectedMonth, setSelectedMonth] = useState<number>(now.getMonth() + 1)
  const [evaluation, setEvaluation] = useState<MonthBudgetEvaluation | null>(null)
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [goals, setGoals] = useState<Goal[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Decision Modal State
  const [isDecisionOpen, setIsDecisionOpen] = useState(false)
  const [decisionType, setDecisionType] = useState<'add_to_savings' | 'rollover' | 'none'>('add_to_savings')
  const [selectedWalletId, setSelectedWalletId] = useState<string>('')
  const [selectedGoalId, setSelectedGoalId] = useState<string>('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const monthNames = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
  ]

  const loadData = async () => {
    setIsLoading(true)
    setErrorMsg(null)
    const [evalRes, walletsRes, goalsRes] = await Promise.all([
      getMonthBudgetEvaluation(selectedYear, selectedMonth),
      getWallets(),
      getGoals(),
    ])

    if (evalRes.error) {
      setErrorMsg(evalRes.error)
    } else {
      setEvaluation(evalRes.data)
    }

    if (walletsRes.data) {
      setWallets(walletsRes.data)
      if (walletsRes.data.length > 0 && !selectedWalletId) {
        setSelectedWalletId(walletsRes.data[0].id)
      }
    }

    if (goalsRes.data) {
      const activeGoals = goalsRes.data.filter((g) => g.status === 'active')
      setGoals(activeGoals)
      if (activeGoals.length > 0 && !selectedGoalId) {
        setSelectedGoalId(activeGoals[0].id)
      }
    }
    setIsLoading(false)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYear, selectedMonth, walletRefreshKey])

  const handlePrevMonth = () => {
    if (selectedMonth === 1) {
      setSelectedYear((y) => y - 1)
      setSelectedMonth(12)
    } else {
      setSelectedMonth((m) => m - 1)
    }
  }

  const handleNextMonth = () => {
    if (selectedMonth === 12) {
      setSelectedYear((y) => y + 1)
      setSelectedMonth(1)
    } else {
      setSelectedMonth((m) => m + 1)
    }
  }

  const handleOpenDecision = () => {
    setFormError(null)
    if (evaluation?.hasLeftover) {
      setDecisionType('add_to_savings')
    } else {
      setDecisionType('none')
    }
    setIsDecisionOpen(true)
  }

  const handleApplyDecision = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSubmitting) return

    setFormError(null)
    setIsSubmitting(true)

    const res = await finalizeMonthBudgetDecision({
      year: selectedYear,
      month: selectedMonth,
      decision: decisionType,
      walletId: decisionType === 'add_to_savings' ? selectedWalletId : undefined,
      goalId: decisionType === 'add_to_savings' ? selectedGoalId : undefined,
    })

    if (res.error) {
      setFormError(res.error)
      setIsSubmitting(false)
    } else {
      setIsSubmitting(false)
      setIsDecisionOpen(false)
      await loadData()
      onDecisionApplied()
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header with Month Navigation */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <h2 className="text-base font-bold text-text-base">Evaluasi Sisa Anggaran</h2>
          <span className="text-[11px] text-text-muted">Perbandingan alokasi vs pengeluaran operasional</span>
        </div>

        <div className="flex items-center gap-1 rounded-2xl bg-surface border border-border px-2 py-1 shadow-xs">
          <button
            onClick={handlePrevMonth}
            className="px-1.5 py-0.5 text-xs font-bold text-text-muted hover:text-text-base active:scale-95"
            title="Bulan Sebelumnya"
          >
            ‹
          </button>
          <span className="text-xs font-bold text-text-base min-w-[84px] text-center">
            {monthNames[selectedMonth - 1]} {selectedYear}
          </span>
          <button
            onClick={handleNextMonth}
            className="px-1.5 py-0.5 text-xs font-bold text-text-muted hover:text-text-base active:scale-95"
            title="Bulan Berikutnya"
          >
            ›
          </button>
        </div>
      </div>

      {errorMsg && (
        <div role="alert" className="rounded-2xl bg-danger/10 border border-danger/20 p-3 text-xs text-danger font-medium flex items-center justify-between">
          <span>⚠️ {errorMsg}</span>
          <button onClick={loadData} className="text-xs underline font-bold">Coba Lagi</button>
        </div>
      )}

      {isLoading ? (
        <div className="h-36 animate-pulse rounded-3xl bg-surface border border-border" />
      ) : (
        <div className="rounded-3xl bg-surface border border-border p-5 shadow-sm flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-surface-raised border border-border text-primary">
                <Sliders size={20} />
              </span>
              <div className="flex flex-col">
                <span className="text-[11px] font-semibold text-text-muted">
                  {evaluation?.isOverspent ? 'Total Overspending (Defisit)' : 'Sisa Anggaran Operasional'}
                </span>
                <span className={`text-2xl font-black font-mono ${evaluation?.isOverspent ? 'text-danger' : 'text-primary'}`}>
                  {evaluation?.isOverspent ? '-' : ''}{formatRupiah(evaluation?.isOverspent ? evaluation.overspentAmount : (evaluation?.leftoverOperationalBudget || 0))}
                </span>
              </div>
            </div>

            {evaluation?.isFinalized ? (
              <span className="rounded-xl bg-primary/10 border border-primary/20 px-2.5 py-1 text-[10px] font-bold text-primary uppercase tracking-wider">
                ✓ Selesai
              </span>
            ) : (
              <span className="rounded-xl bg-surface-raised border border-border px-2.5 py-1 text-[10px] font-bold text-text-muted uppercase tracking-wider">
                Aktif
              </span>
            )}
          </div>

          {/* Breakdown: Allocated vs Actual Spending */}
          <div className="grid grid-cols-2 gap-2 pt-3 border-t border-border text-xs">
            <div className="flex flex-col">
              <span className="text-text-muted text-[11px]">Anggaran Operasional:</span>
              <span className="font-bold font-mono text-text-base">
                {formatRupiah(evaluation?.totalAllocatedBudget || 0)}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-text-muted text-[11px]">Realisasi Pengeluaran:</span>
              <span className="font-bold font-mono text-text-base">
                {formatRupiah(evaluation?.actualOperationalSpending || 0)}
              </span>
            </div>
          </div>

          {/* Overspent Warning Alert */}
          {evaluation?.isOverspent && (
            <div role="alert" className="rounded-2xl bg-danger/10 border border-danger/20 p-3 text-xs text-danger font-medium flex items-start gap-2">
              <span>⚠️</span>
              <div className="flex flex-col gap-0.5">
                <span className="font-bold">Pengeluaran Melebihi Anggaran</span>
                <span className="text-[11px]">
                  Pengeluaran operasional bulan ini melampaui anggaran sebesar{' '}
                  <strong className="font-mono">{formatRupiah(evaluation.overspentAmount)}</strong>. Tidak ada sisa untuk ditabung atau di-rollover.
                </span>
              </div>
            </div>
          )}

          {/* Action History / Finalized State */}
          {evaluation?.isFinalized && (
            <div className="rounded-2xl bg-surface-raised p-3 text-xs flex flex-col gap-1 border border-border/60">
              <div className="flex items-center justify-between">
                <span className="font-bold text-text-base">Keputusan Akhir Bulan:</span>
                <span className="text-[10px] text-text-muted">
                  {evaluation.finalizedAt ? new Date(evaluation.finalizedAt).toLocaleDateString('id-ID') : ''}
                </span>
              </div>
              <p className="text-[11px] text-text-muted">
                {evaluation.actionTaken === 'added_to_savings' && `Dipindahkan ke Tabungan: ${formatRupiah(evaluation.actionAmount)}`}
                {evaluation.actionTaken === 'rollover' && `Di-rollover ke Anggaran Bulan Depan: ${formatRupiah(evaluation.actionAmount)}`}
                {evaluation.actionTaken === 'none' && 'Tidak ada aksi keuangan yang dieksekusi.'}
              </p>
            </div>
          )}

          {/* Decision Button */}
          {!evaluation?.isFinalized && (
            <div className="pt-2 border-t border-border flex justify-end">
              <button
                onClick={handleOpenDecision}
                className="w-full rounded-2xl bg-primary px-4 py-2.5 text-xs font-bold text-text-inverse shadow-sm hover:opacity-95 active:scale-98 transition flex items-center justify-center gap-1.5"
              >
                <Clock3 size={15} />
                <span>Proses Akhir Bulan</span>
              </button>
            </div>
          )}

          <div className="text-[10px] text-text-muted text-center pt-1 border-t border-border/50">
            Sisa anggaran adalah selisih perencanaan, bukan saldo kas fisik baru secara otomatis.
          </div>
        </div>
      )}

      {/* Decision Modal */}
      {isDecisionOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-3xl bg-surface border border-border p-5 shadow-xl flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-primary font-bold"><Sliders size={18} /></span>
                <span className="text-sm font-bold text-text-base">
                  Keputusan Akhir Bulan {monthNames[selectedMonth - 1]}
                </span>
              </div>
              <button
                onClick={() => setIsDecisionOpen(false)}
                className="text-text-muted hover:text-text-base text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleApplyDecision} className="flex flex-col gap-4">
              {formError && (
                <div role="alert" className="rounded-xl bg-danger/10 border border-danger/20 p-2.5 text-xs text-danger font-medium">
                  {formError}
                </div>
              )}

              <div className="rounded-2xl bg-surface-raised p-3 text-xs flex flex-col gap-1 border border-border">
                <div className="flex justify-between items-center">
                  <span className="text-text-muted text-[11px]">Sisa Anggaran Tersedia:</span>
                  <span className="font-bold font-mono text-primary text-sm">
                    {formatRupiah(evaluation?.leftoverOperationalBudget || 0)}
                  </span>
                </div>
              </div>

              {/* Decision Type Radio Selector */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-text-base">Pilih Tindakan:</label>
                <div className="flex flex-col gap-1.5">
                  <label className="flex items-start gap-2.5 p-2.5 rounded-xl border border-border hover:bg-surface-raised cursor-pointer">
                    <input
                      type="radio"
                      name="decisionType"
                      value="add_to_savings"
                      checked={decisionType === 'add_to_savings'}
                      onChange={() => setDecisionType('add_to_savings')}
                      disabled={!evaluation?.hasLeftover}
                      className="mt-0.5 text-primary focus:ring-0"
                    />
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-text-base">Tabung ke Target Tabungan</span>
                      <span className="text-[10px] text-text-muted">
                        Pindahkan sisa uang secara nyata dari dompet ke tujuan tabungan melalui transaksi buku besar.
                      </span>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-2.5 rounded-xl border border-border hover:bg-surface-raised cursor-pointer">
                    <input
                      type="radio"
                      name="decisionType"
                      value="rollover"
                      checked={decisionType === 'rollover'}
                      onChange={() => setDecisionType('rollover')}
                      disabled={!evaluation?.hasLeftover}
                      className="mt-0.5 text-primary focus:ring-0"
                    />
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-text-base">Rollover ke Bulan Depan</span>
                      <span className="text-[10px] text-text-muted">
                        Tambahkan sisa ini sebagai alokasi perencanaan tambahan di bulan berikutnya (tidak merubah saldo dompet).
                      </span>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-2.5 rounded-xl border border-border hover:bg-surface-raised cursor-pointer">
                    <input
                      type="radio"
                      name="decisionType"
                      value="none"
                      checked={decisionType === 'none'}
                      onChange={() => setDecisionType('none')}
                      className="mt-0.5 text-primary focus:ring-0"
                    />
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-text-base">Tutup Tanpa Tindakan</span>
                      <span className="text-[10px] text-text-muted">
                        Selesaikan evaluasi bulan ini tanpa membuat transaksi atau alokasi baru.
                      </span>
                    </div>
                  </label>
                </div>
              </div>

              {/* If add_to_savings selected, pick wallet and goal */}
              {decisionType === 'add_to_savings' && (
                <div className="flex flex-col gap-3 pt-2 border-t border-border">
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-semibold text-text-muted">Dompet Sumber Dana:</label>
                    <select
                      value={selectedWalletId}
                      onChange={(e) => setSelectedWalletId(e.target.value)}
                      className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-text-base focus:border-primary focus:outline-hidden"
                      required
                    >
                      {wallets.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.label} ({formatRupiah(w.balance)})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-semibold text-text-muted">Tujuan Tabungan Target:</label>
                    <select
                      value={selectedGoalId}
                      onChange={(e) => setSelectedGoalId(e.target.value)}
                      className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-text-base focus:border-primary focus:outline-hidden"
                      required
                    >
                      {goals.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name} (Terkumpul: {formatRupiah(g.currentAmount)})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 pt-2 border-t border-border">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 rounded-2xl bg-primary py-2.5 text-xs font-bold text-text-inverse hover:opacity-95 disabled:opacity-50 transition"
                >
                  {isSubmitting ? 'Memproses...' : 'Terapkan Keputusan'}
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setIsDecisionOpen(false)}
                  className="flex-1 rounded-2xl border border-border bg-surface py-2.5 text-xs font-semibold text-text-muted hover:bg-surface-raised disabled:opacity-50 transition"
                >
                  Batal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function GoalSection({
  refreshKey,
  onGoalContributed,
}: {
  refreshKey: number
  onGoalContributed: () => void
}) {
  const [goals, setGoals] = useState<Goal[]>([])
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Creation form state
  const [isCreating, setIsCreating] = useState(false)
  const [name, setName] = useState('')
  const [targetAmountStr, setTargetAmountStr] = useState('')
  const [targetYear, setTargetYear] = useState<string>('')
  const [targetMonth, setTargetMonth] = useState<string>('')
  const [isPrimary, setIsPrimary] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editTargetStr, setEditTargetStr] = useState('')
  const [editYear, setEditYear] = useState<string>('')
  const [editMonth, setEditMonth] = useState<string>('')
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Contribution state
  const [contributingGoal, setContributingGoal] = useState<Goal | null>(null)
  const [contribWalletId, setContribWalletId] = useState<string>('')
  const [contribAmountStr, setContribAmountStr] = useState<string>('')
  const [contribDesc, setContribDesc] = useState<string>('')
  const [contribDate, setContribDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [isSubmittingContrib, setIsSubmittingContrib] = useState<boolean>(false)
  const [contribError, setContribError] = useState<string | null>(null)
  const [contribSuccess, setContribSuccess] = useState<string | null>(null)

  // Withdrawal state
  const [withdrawingGoal, setWithdrawingGoal] = useState<Goal | null>(null)
  const [withdrawingWalletId, setWithdrawingWalletId] = useState<string>('')
  const [withdrawingAmountStr, setWithdrawingAmountStr] = useState<string>('')
  const [withdrawingReason, setWithdrawingReason] = useState<string>('')
  const [withdrawingDate, setWithdrawingDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [isSubmittingWithdrawal, setIsSubmittingWithdrawal] = useState<boolean>(false)
  const [withdrawalError, setWithdrawalError] = useState<string | null>(null)
  const [withdrawalSuccess, setWithdrawalSuccess] = useState<string | null>(null)
  const [monthlyPlannedSavings, setMonthlyPlannedSavings] = useState<number>(0)

  const monthNames = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
  ]

  const loadGoalsAndWallets = async () => {
    setIsLoading(true)
    setErrorMsg(null)
    const now = new Date()
    const [goalsRes, walletsRes, savingsRes] = await Promise.all([
      getGoals(),
      getWallets(),
      getSavingsAllocation(now.getFullYear(), now.getMonth() + 1),
    ])
    if (goalsRes.error) {
      setErrorMsg(goalsRes.error)
    } else {
      setGoals(goalsRes.data)
    }

    if (walletsRes.data) {
      setWallets(walletsRes.data)
      if (walletsRes.data.length > 0) {
        if (!contribWalletId) setContribWalletId(walletsRes.data[0].id)
        if (!withdrawingWalletId) setWithdrawingWalletId(walletsRes.data[0].id)
      }
    }

    if (savingsRes.data) {
      setMonthlyPlannedSavings(savingsRes.data.savingsAllocation)
    }
    setIsLoading(false)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadGoalsAndWallets()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSubmitting) return

    setFormError(null)

    const cleanTarget = parseInt(targetAmountStr.replace(/\D/g, ''), 10)
    if (isNaN(cleanTarget) || cleanTarget <= 0) {
      setFormError('Target tabungan harus lebih besar dari 0.')
      return
    }

    if (!name.trim()) {
      setFormError('Nama tujuan tabungan wajib diisi.')
      return
    }

    setIsSubmitting(true)

    const { data, error } = await createGoal({
      name: name.trim(),
      targetAmount: cleanTarget,
      targetYear: targetYear ? parseInt(targetYear, 10) : null,
      targetMonth: targetMonth ? parseInt(targetMonth, 10) : null,
      isPrimary: goals.length === 0 ? true : isPrimary,
    })

    if (error) {
      setFormError(error)
      setIsSubmitting(false)
      return
    }

    if (data) {
      setGoals((prev) => [...prev, data])
      setIsCreating(false)
      setName('')
      setTargetAmountStr('')
      setTargetYear('')
      setTargetMonth('')
      setIsPrimary(false)
    }

    setIsSubmitting(false)
  }

  const handleStartEdit = (item: Goal) => {
    setEditingId(item.id)
    setEditName(item.name)
    setEditTargetStr(item.targetAmount.toLocaleString('id-ID'))
    setEditYear(item.targetYear ? String(item.targetYear) : '')
    setEditMonth(item.targetMonth ? String(item.targetMonth) : '')
    setEditError(null)
  }

  const handleSaveEdit = async (e: React.FormEvent, item: Goal) => {
    e.preventDefault()
    if (isSubmittingEdit) return

    setEditError(null)

    const cleanTarget = parseInt(editTargetStr.replace(/\D/g, ''), 10)
    if (isNaN(cleanTarget) || cleanTarget <= 0) {
      setEditError('Target tabungan harus lebih besar dari 0.')
      return
    }

    if (!editName.trim()) {
      setEditError('Nama tujuan tabungan tidak boleh kosong.')
      return
    }

    setIsSubmittingEdit(true)

    const { data, error } = await updateGoal(item.id, {
      name: editName.trim(),
      targetAmount: cleanTarget,
      targetYear: editYear ? parseInt(editYear, 10) : null,
      targetMonth: editMonth ? parseInt(editMonth, 10) : null,
    })

    if (error) {
      setEditError(error)
      setIsSubmittingEdit(false)
      return
    }

    if (data) {
      setGoals((prev) => prev.map((g) => (g.id === item.id ? data : g)))
      setEditingId(null)
    }

    setIsSubmittingEdit(false)
  }

  const handleDelete = async (id: string) => {
    const { success, error } = await deleteGoal(id)
    if (!success && error) {
      setErrorMsg(error)
      return
    }
    setGoals((prev) => prev.filter((g) => g.id !== id))
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <h2 className="text-base font-bold text-text-base">Tujuan Tabungan</h2>
          <span className="text-[11px] text-text-muted">Target dan progres dana tabungan terkunci</span>
        </div>
        {!isCreating && (
          <button
            onClick={() => {
              setFormError(null)
              setIsCreating(true)
            }}
            className="text-xs font-semibold text-primary hover:underline underline-offset-4"
          >
            + Buat Tujuan
          </button>
        )}
      </div>

      {/* Global Error Banner */}
      {errorMsg && (
        <div
          role="alert"
          className="rounded-2xl bg-danger/10 border border-danger/20 p-3 text-xs text-danger font-medium flex items-center justify-between"
        >
          <span>⚠️ {errorMsg}</span>
          <button onClick={loadGoalsAndWallets} className="text-xs underline font-bold">
            Coba Lagi
          </button>
        </div>
      )}

      {/* Create Goal Card */}
      {isCreating && (
        <div className="rounded-3xl bg-surface border border-primary/30 p-5 shadow-sm flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-text-base">Buat Tujuan Tabungan Baru</h3>
            <button
              onClick={() => setIsCreating(false)}
              className="text-xs text-text-muted hover:text-text-base"
            >
              Tutup
            </button>
          </div>

          {formError && (
            <div
              role="alert"
              className="rounded-xl bg-danger/10 border border-danger/20 p-2.5 text-xs text-danger font-medium"
            >
              ⚠️ {formError}
            </div>
          )}

          <form onSubmit={handleCreate} className="flex flex-col gap-3.5">
            <div className="flex flex-col gap-1">
              <label htmlFor="goal-name" className="text-xs font-medium text-text-muted">
                Nama Tujuan
              </label>
              <input
                id="goal-name"
                type="text"
                required
                maxLength={50}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Contoh: Dana Darurat / Beli Laptop"
                className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-text-base outline-none focus:border-primary"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="goal-target" className="text-xs font-medium text-text-muted">
                Target Nominal (Rp)
              </label>
              <input
                id="goal-target"
                type="text"
                inputMode="numeric"
                required
                value={targetAmountStr}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '')
                  if (!val) {
                    setTargetAmountStr('')
                  } else {
                    const parsed = parseInt(val, 10)
                    setTargetAmountStr(parsed.toLocaleString('id-ID'))
                  }
                }}
                placeholder="Contoh: 15.000.000"
                className="rounded-xl border border-border bg-surface px-3 py-2 text-sm font-bold font-mono text-text-base outline-none focus:border-primary"
              />
            </div>

            {/* Target Timeframe */}
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label htmlFor="goal-year" className="text-xs font-medium text-text-muted">
                  Tahun Target (opsional)
                </label>
                <input
                  id="goal-year"
                  type="number"
                  min={new Date().getFullYear()}
                  max={2050}
                  value={targetYear}
                  onChange={(e) => setTargetYear(e.target.value)}
                  placeholder="Contoh: 2027"
                  className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-text-base outline-none focus:border-primary"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="goal-month" className="text-xs font-medium text-text-muted">
                  Bulan Target (opsional)
                </label>
                <select
                  id="goal-month"
                  value={targetMonth}
                  onChange={(e) => setTargetMonth(e.target.value)}
                  className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-text-base outline-none focus:border-primary"
                >
                  <option value="">Pilih Bulan</option>
                  {monthNames.map((m, idx) => (
                    <option key={m} value={idx + 1}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {goals.length > 0 && (
              <label className="flex items-center gap-2 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={isPrimary}
                  onChange={(e) => setIsPrimary(e.target.checked)}
                  className="rounded text-primary focus:ring-primary"
                />
                <span className="text-xs text-text-base">Jadikan tujuan tabungan utama (primary)</span>
              </label>
            )}

            <div className="rounded-xl bg-surface-raised p-2.5 text-[11px] text-text-muted flex items-center gap-1.5">
              <span>🔒</span>
              <span>
                Saldo tabungan terkunci bertambah melalui kontribusi tabungan terarah pada rilis berikutnya.
              </span>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 rounded-xl bg-primary py-2.5 text-xs font-semibold text-text-inverse hover:opacity-95 disabled:opacity-50"
              >
                {isSubmitting ? 'Menyimpan...' : 'Simpan Tujuan'}
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => setIsCreating(false)}
                className="flex-1 rounded-xl border border-border bg-surface py-2.5 text-xs font-semibold text-text-muted hover:bg-surface-raised"
              >
                Batal
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Goals List */}
      {isLoading ? (
        <div className="flex flex-col gap-2.5">
          <div className="h-20 animate-pulse rounded-2xl bg-surface border border-border" />
          <div className="h-20 animate-pulse rounded-2xl bg-surface border border-border" />
        </div>
      ) : goals.length === 0 ? (
        <div className="rounded-3xl bg-surface border border-border p-6 text-center flex flex-col items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-surface-raised border border-border text-primary">
            <Target size={20} />
          </div>
          <p className="text-xs font-bold text-text-base">Belum Ada Tujuan Tabungan</p>
          <p className="text-[11px] text-text-muted max-w-xs">
            Tentukan tujuan tabunganmu (seperti dana darurat atau gadget baru) agar uang tersimpan dengan fokus.
          </p>
          {!isCreating && (
            <button
              onClick={() => setIsCreating(true)}
              className="mt-1 rounded-xl bg-primary px-3.5 py-1.5 text-xs font-semibold text-text-inverse shadow-sm"
            >
              + Buat Tujuan Sekarang
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {goals.map((item) => {
            const isEditingThis = editingId === item.id
            const { remainingAmount, progressPercent } = calculateGoalProgress(
              item.targetAmount,
              item.currentAmount
            )

            const timeframeLabel =
              item.targetYear && item.targetMonth
                ? `${monthNames[item.targetMonth - 1]} ${item.targetYear}`
                : item.targetYear
                ? `Tahun ${item.targetYear}`
                : null

            return (
              <div
                key={item.id}
                className="rounded-3xl bg-surface border border-border p-5 shadow-sm flex flex-col gap-3.5"
              >
                {isEditingThis ? (
                  <form
                    onSubmit={(e) => handleSaveEdit(e, item)}
                    className="flex flex-col gap-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-text-muted">
                        Edit Tujuan Tabungan
                      </span>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="text-xs text-text-muted hover:text-text-base"
                      >
                        Batal
                      </button>
                    </div>

                    {editError && (
                      <div className="rounded-xl bg-danger/10 border border-danger/20 p-2 text-xs text-danger">
                        ⚠️ {editError}
                      </div>
                    )}

                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Nama Tujuan"
                      maxLength={50}
                      required
                      className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-text-base outline-none focus:border-primary"
                    />

                    <input
                      type="text"
                      inputMode="numeric"
                      value={editTargetStr}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, '')
                        if (!val) {
                          setEditTargetStr('')
                        } else {
                          const parsed = parseInt(val, 10)
                          setEditTargetStr(parsed.toLocaleString('id-ID'))
                        }
                      }}
                      className="rounded-xl border border-border bg-surface px-3 py-2 text-xs font-mono font-bold text-text-base outline-none focus:border-primary"
                    />

                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="number"
                        min={new Date().getFullYear()}
                        value={editYear}
                        onChange={(e) => setEditYear(e.target.value)}
                        placeholder="Tahun"
                        className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-text-base outline-none focus:border-primary"
                      />
                      <select
                        value={editMonth}
                        onChange={(e) => setEditMonth(e.target.value)}
                        className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-text-base outline-none focus:border-primary"
                      >
                        <option value="">Bulan</option>
                        {monthNames.map((m, idx) => (
                          <option key={m} value={idx + 1}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="submit"
                        disabled={isSubmittingEdit}
                        className="flex-1 rounded-xl bg-primary py-2 text-xs font-semibold text-text-inverse hover:opacity-95 disabled:opacity-50"
                      >
                        {isSubmittingEdit ? 'Menyimpan...' : 'Simpan'}
                      </button>
                      <button
                        type="button"
                        disabled={isSubmittingEdit}
                        onClick={() => setEditingId(null)}
                        className="flex-1 rounded-xl border border-border bg-surface py-2 text-xs font-semibold text-text-muted hover:bg-surface-raised"
                      >
                        Batal
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="flex items-start justify-between">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-primary font-bold"><Target size={16} /></span>
                          <p className="text-sm font-bold text-text-base">{item.name}</p>
                          {item.isPrimary && (
                            <span className="rounded-md bg-primary/15 text-primary text-[10px] font-bold px-1.5 py-0.2">
                              Utama
                            </span>
                          )}
                        </div>
                        {timeframeLabel && (
                          <span className="text-[11px] text-text-muted">
                            Target: {timeframeLabel}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleStartEdit(item)}
                          className="text-xs font-semibold text-primary hover:underline underline-offset-4"
                        >
                          Ubah
                        </button>
                        <button
                          onClick={() => handleDelete(item.id)}
                          className="text-xs font-semibold text-danger/80 hover:text-danger"
                          title="Hapus Tujuan"
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="flex flex-col gap-1.5 pt-1">
                      <div className="flex items-baseline justify-between text-xs">
                        <span className="text-text-muted text-[11px]">Terkumpul</span>
                        <div className="flex items-baseline gap-1">
                          <span className="font-bold font-mono text-text-base">
                            {formatRupiah(item.currentAmount)}
                          </span>
                          <span className="text-[10px] text-text-muted">
                            / {formatRupiah(item.targetAmount)}
                          </span>
                        </div>
                      </div>

                      <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-raised border border-border">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-300"
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-text-muted pt-0.5">
                        <span className="font-semibold text-primary">{progressPercent}% tercapai</span>
                        <span>Sisa: {formatRupiah(remainingAmount)}</span>
                      </div>
                    </div>

                    {/* Savings Lock Info Badge & Contribute/Withdraw Buttons */}
                    <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
                      <div className="flex-1 min-w-[200px] rounded-2xl bg-surface-raised p-2 text-[10px] text-text-muted flex items-center gap-1.5">
                        <span className="font-semibold text-primary">Terkunci:</span>
                        <span>Dana tabungan dialokasikan khusus untuk tujuan ini.</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {item.currentAmount > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setWithdrawingGoal(item)
                              setWithdrawingAmountStr('')
                              setWithdrawingReason('')
                              setWithdrawalError(null)
                              setWithdrawalSuccess(null)
                            }}
                            className="rounded-xl border border-warning/30 bg-warning/5 px-3 py-2 text-xs font-bold text-warning hover:bg-warning/15 active:scale-95 transition"
                          >
                            Tarik
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setContributingGoal(item)
                            setContribAmountStr('')
                            setContribDesc('')
                            setContribError(null)
                            setContribSuccess(null)
                          }}
                          className="rounded-xl bg-primary/10 border border-primary/20 px-3 py-2 text-xs font-bold text-primary hover:bg-primary/20 active:scale-95 transition"
                        >
                          + Nabung
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Contribution Drawer / Modal */}
      {contributingGoal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-3xl bg-surface border border-border p-5 shadow-xl flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">🎯</span>
                <div className="flex flex-col">
                  <h3 className="text-sm font-bold text-text-base">Alokasikan Tabungan</h3>
                  <p className="text-[11px] text-text-muted">
                    Tujuan: <span className="font-semibold text-text-base">{contributingGoal.name}</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!isSubmittingContrib) setContributingGoal(null)
                }}
                className="text-xs text-text-muted hover:text-text-base"
              >
                ✕
              </button>
            </div>

            {contribError && (
              <div
                role="alert"
                className="rounded-xl bg-danger/10 border border-danger/20 p-2.5 text-xs text-danger font-medium"
              >
                ⚠️ {contribError}
              </div>
            )}

            {contribSuccess && (
              <div
                role="alert"
                className="rounded-xl bg-primary/10 border border-primary/20 p-2.5 text-xs text-primary font-medium flex items-center gap-1.5"
              >
                <span>✅</span>
                <span>{contribSuccess}</span>
              </div>
            )}

            <form
              onSubmit={async (e) => {
                e.preventDefault()
                if (isSubmittingContrib) return

                setContribError(null)
                setContribSuccess(null)

                const cleanAmount = parseInt(contribAmountStr.replace(/\D/g, ''), 10)
                if (isNaN(cleanAmount) || cleanAmount <= 0) {
                  setContribError('Nominal kontribusi harus lebih besar dari 0.')
                  return
                }

                const selectedWallet = wallets.find((w) => w.id === contribWalletId)
                if (!selectedWallet) {
                  setContribError('Pilih dompet sumber dana terlebih dahulu.')
                  return
                }

                if (selectedWallet.balance < cleanAmount) {
                  setContribError(
                    `Saldo dompet ${selectedWallet.label} (${formatRupiah(
                      selectedWallet.balance
                    )}) tidak mencukupi untuk kontribusi sebesar ${formatRupiah(cleanAmount)}.`
                  )
                  return
                }

                setIsSubmittingContrib(true)

                const { data, error } = await createSavingsContribution({
                  walletId: contribWalletId,
                  goalId: contributingGoal.id,
                  amount: cleanAmount,
                  description: contribDesc.trim() || `Nabung untuk ${contributingGoal.name}`,
                  transactionDate: contribDate,
                })

                if (error) {
                  setContribError(error)
                  setIsSubmittingContrib(false)
                  return
                }

                if (data) {
                  setContribSuccess('Tabungan berhasil dialokasikan!')
                  await loadGoalsAndWallets()
                  onGoalContributed()
                  setTimeout(() => {
                    setContributingGoal(null)
                    setIsSubmittingContrib(false)
                  }, 800)
                } else {
                  setIsSubmittingContrib(false)
                }
              }}
              className="flex flex-col gap-3.5"
            >
              {/* Wallet Selector */}
              <div className="flex flex-col gap-1">
                <label htmlFor="contrib-wallet" className="text-xs font-medium text-text-muted">
                  Sumber Dompet
                </label>
                <select
                  id="contrib-wallet"
                  disabled={isSubmittingContrib}
                  value={contribWalletId}
                  onChange={(e) => setContribWalletId(e.target.value)}
                  className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-text-base outline-none focus:border-primary"
                >
                  {wallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.label} — Saldo: {formatRupiah(w.balance)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Amount Input */}
              <div className="flex flex-col gap-1">
                <label htmlFor="contrib-amount" className="text-xs font-medium text-text-muted">
                  Nominal Alokasi (Rp)
                </label>
                <input
                  id="contrib-amount"
                  type="text"
                  inputMode="numeric"
                  required
                  disabled={isSubmittingContrib}
                  value={contribAmountStr}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '')
                    if (!val) {
                      setContribAmountStr('')
                    } else {
                      const parsed = parseInt(val, 10)
                      setContribAmountStr(parsed.toLocaleString('id-ID'))
                    }
                  }}
                  placeholder="Contoh: 500.000"
                  className="rounded-xl border border-border bg-surface px-3 py-2 text-sm font-bold font-mono text-text-base outline-none focus:border-primary"
                />
              </div>

              {/* Transaction Date */}
              <div className="flex flex-col gap-1">
                <label htmlFor="contrib-date" className="text-xs font-medium text-text-muted">
                  Tanggal Alokasi
                </label>
                <input
                  id="contrib-date"
                  type="date"
                  required
                  disabled={isSubmittingContrib}
                  value={contribDate}
                  onChange={(e) => setContribDate(e.target.value)}
                  className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-text-base outline-none focus:border-primary"
                />
              </div>

              {/* Note / Description */}
              <div className="flex flex-col gap-1">
                <label htmlFor="contrib-desc" className="text-xs font-medium text-text-muted">
                  Keterangan (opsional)
                </label>
                <input
                  id="contrib-desc"
                  type="text"
                  maxLength={255}
                  disabled={isSubmittingContrib}
                  value={contribDesc}
                  onChange={(e) => setContribDesc(e.target.value)}
                  placeholder={`Contoh: Nabung untuk ${contributingGoal.name}`}
                  className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-text-base outline-none focus:border-primary"
                />
              </div>

              {/* Informational Preview Card */}
              {(() => {
                const cleanAmount = parseInt(contribAmountStr.replace(/\D/g, ''), 10) || 0
                const selectedWallet = wallets.find((w) => w.id === contribWalletId)
                const currentWalletBal = selectedWallet ? selectedWallet.balance : 0
                const estWalletBal = currentWalletBal - cleanAmount
                const estGoalBal = contributingGoal.currentAmount + cleanAmount
                const isOverdraft = cleanAmount > currentWalletBal

                return (
                  <div className="rounded-2xl bg-surface-raised border border-border p-3 flex flex-col gap-2 text-xs">
                    <span className="font-semibold text-text-muted text-[11px] uppercase tracking-wider">
                      Pratinjau Dampak Keuangan
                    </span>
                    <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border">
                      <div className="flex flex-col">
                        <span className="text-text-muted text-[10px]">Saldo Dompet Setelahnya:</span>
                        <span
                          className={`font-mono font-bold ${
                            isOverdraft ? 'text-danger' : 'text-text-base'
                          }`}
                        >
                          {formatRupiah(estWalletBal)}
                        </span>
                        {isOverdraft && (
                          <span className="text-[10px] text-danger font-semibold">
                            ⚠️ Saldo tidak mencukupi!
                          </span>
                        )}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-text-muted text-[10px]">Total Terkumpul Tujuan:</span>
                        <span className="font-mono font-bold text-primary">
                          {formatRupiah(estGoalBal)}
                        </span>
                        <span className="text-[10px] text-text-muted">
                          dari target {formatRupiah(contributingGoal.targetAmount)}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })()}

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="submit"
                  disabled={isSubmittingContrib}
                  className="flex-1 rounded-xl bg-primary py-2.5 text-xs font-semibold text-text-inverse shadow-sm hover:opacity-95 disabled:opacity-50"
                >
                  {isSubmittingContrib ? 'Menyimpan Transaksi...' : 'Konfirmasi Alokasi Tabungan'}
                </button>
                <button
                  type="button"
                  disabled={isSubmittingContrib}
                  onClick={() => setContributingGoal(null)}
                  className="rounded-xl border border-border bg-surface px-4 py-2.5 text-xs font-semibold text-text-muted hover:bg-surface-raised"
                >
                  Batal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Withdrawal Friction Drawer / Modal */}
      {withdrawingGoal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-3xl bg-surface border border-warning/30 p-5 shadow-xl flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">🔓</span>
                <div className="flex flex-col">
                  <h3 className="text-sm font-bold text-text-base">Tarik Saldo Tabungan</h3>
                  <p className="text-[11px] text-text-muted">
                    Tujuan: <span className="font-semibold text-text-base">{withdrawingGoal.name}</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!isSubmittingWithdrawal) setWithdrawingGoal(null)
                }}
                className="text-xs text-text-muted hover:text-text-base"
              >
                ✕
              </button>
            </div>

            {/* Friction Notice */}
            <div className="rounded-2xl bg-warning/10 border border-warning/20 p-3 text-xs text-warning flex items-start gap-2">
              <span className="text-sm">⚠️</span>
              <p className="text-[11px] leading-relaxed text-text-base">
                Menarik tabungan akan mengurangi dana terkumpul dan berpotensi memperlambat tercapainya target tujuan ini.
              </p>
            </div>

            {withdrawalError && (
              <div
                role="alert"
                className="rounded-xl bg-danger/10 border border-danger/20 p-2.5 text-xs text-danger font-medium"
              >
                ⚠️ {withdrawalError}
              </div>
            )}

            {withdrawalSuccess && (
              <div
                role="alert"
                className="rounded-xl bg-primary/10 border border-primary/20 p-2.5 text-xs text-primary font-medium flex items-center gap-1.5"
              >
                <span>✅</span>
                <span>{withdrawalSuccess}</span>
              </div>
            )}

            <form
              onSubmit={async (e) => {
                e.preventDefault()
                if (isSubmittingWithdrawal) return

                setWithdrawalError(null)
                setWithdrawalSuccess(null)

                const cleanAmount = parseInt(withdrawingAmountStr.replace(/\D/g, ''), 10)
                if (isNaN(cleanAmount) || cleanAmount <= 0) {
                  setWithdrawalError('Nominal penarikan harus lebih besar dari 0.')
                  return
                }

                if (cleanAmount > withdrawingGoal.currentAmount) {
                  setWithdrawalError(
                    `Saldo tabungan tidak mencukupi. Dana terkumpul saat ini adalah ${formatRupiah(
                      withdrawingGoal.currentAmount
                    )}.`
                  )
                  return
                }

                if (!withdrawingReason.trim()) {
                  setWithdrawalError('Alasan penarikan dana tabungan wajib diisi.')
                  return
                }

                const selectedWallet = wallets.find((w) => w.id === withdrawingWalletId)
                if (!selectedWallet) {
                  setWithdrawalError('Pilih dompet tujuan transfer dana.')
                  return
                }

                setIsSubmittingWithdrawal(true)

                const estDelay = calculateGoalDelayEstimate(cleanAmount, monthlyPlannedSavings)

                const { data, error } = await createSavingsWithdrawal({
                  goalId: withdrawingGoal.id,
                  walletId: withdrawingWalletId,
                  amount: cleanAmount,
                  reason: withdrawingReason.trim(),
                  transactionDate: withdrawingDate,
                  estimatedDelayDays: estDelay,
                })

                if (error) {
                  setWithdrawalError(error)
                  setIsSubmittingWithdrawal(false)
                  return
                }

                if (data) {
                  setWithdrawalSuccess('Penarikan tabungan berhasil diproses!')
                  await loadGoalsAndWallets()
                  onGoalContributed()
                  setTimeout(() => {
                    setWithdrawingGoal(null)
                    setIsSubmittingWithdrawal(false)
                  }, 800)
                } else {
                  setIsSubmittingWithdrawal(false)
                }
              }}
              className="flex flex-col gap-3.5"
            >
              {/* Amount Input */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <label htmlFor="withdrawal-amount" className="text-xs font-medium text-text-muted">
                    Nominal Penarikan (Rp)
                  </label>
                  <span className="text-[10px] text-text-muted">
                    Maks: <span className="font-bold font-mono">{formatRupiah(withdrawingGoal.currentAmount)}</span>
                  </span>
                </div>
                <input
                  id="withdrawal-amount"
                  type="text"
                  inputMode="numeric"
                  required
                  disabled={isSubmittingWithdrawal}
                  value={withdrawingAmountStr}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '')
                    if (!val) {
                      setWithdrawingAmountStr('')
                    } else {
                      const parsed = parseInt(val, 10)
                      setWithdrawingAmountStr(parsed.toLocaleString('id-ID'))
                    }
                  }}
                  placeholder="Contoh: 200.000"
                  className="rounded-xl border border-border bg-surface px-3 py-2 text-sm font-bold font-mono text-text-base outline-none focus:border-primary"
                />
              </div>

              {/* Destination Wallet Selector */}
              <div className="flex flex-col gap-1">
                <label htmlFor="withdrawal-wallet" className="text-xs font-medium text-text-muted">
                  Kirim ke Dompet
                </label>
                <select
                  id="withdrawal-wallet"
                  disabled={isSubmittingWithdrawal}
                  value={withdrawingWalletId}
                  onChange={(e) => setWithdrawingWalletId(e.target.value)}
                  className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-text-base outline-none focus:border-primary"
                >
                  {wallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.label} (Saldo saat ini: {formatRupiah(w.balance)})
                    </option>
                  ))}
                </select>
              </div>

              {/* Mandatory Reason */}
              <div className="flex flex-col gap-1">
                <label htmlFor="withdrawal-reason" className="text-xs font-medium text-text-muted">
                  Alasan Penarikan <span className="text-danger">*</span>
                </label>
                <textarea
                  id="withdrawal-reason"
                  required
                  rows={2}
                  maxLength={500}
                  disabled={isSubmittingWithdrawal}
                  value={withdrawingReason}
                  onChange={(e) => setWithdrawingReason(e.target.value)}
                  placeholder="Contoh: Keperluan mendesak servis laptop atau biaya berobat"
                  className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-text-base outline-none focus:border-primary resize-none"
                />
              </div>

              {/* Transaction Date */}
              <div className="flex flex-col gap-1">
                <label htmlFor="withdrawal-date" className="text-xs font-medium text-text-muted">
                  Tanggal Transaksi
                </label>
                <input
                  id="withdrawal-date"
                  type="date"
                  required
                  disabled={isSubmittingWithdrawal}
                  value={withdrawingDate}
                  onChange={(e) => setWithdrawingDate(e.target.value)}
                  className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-text-base outline-none focus:border-primary"
                />
              </div>

              {/* Real-time Friction & Impact Preview */}
              {(() => {
                const cleanAmount = parseInt(withdrawingAmountStr.replace(/\D/g, ''), 10) || 0
                const selectedWallet = wallets.find((w) => w.id === withdrawingWalletId)
                const currentWalletBal = selectedWallet ? selectedWallet.balance : 0
                const estWalletBal = currentWalletBal + cleanAmount
                const estGoalBal = Math.max(0, withdrawingGoal.currentAmount - cleanAmount)
                const isOverGoal = cleanAmount > withdrawingGoal.currentAmount
                const estDelayDays = calculateGoalDelayEstimate(cleanAmount, monthlyPlannedSavings)

                const { progressPercent: newProgress } = calculateGoalProgress(
                  withdrawingGoal.targetAmount,
                  estGoalBal
                )

                return (
                  <div className="rounded-2xl bg-surface-raised border border-border p-3.5 flex flex-col gap-2.5 text-xs">
                    <span className="font-semibold text-text-muted text-[11px] uppercase tracking-wider">
                      Konfirmasi Dampak Penarikan
                    </span>

                    <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border">
                      <div className="flex flex-col">
                        <span className="text-text-muted text-[10px]">Sisa Saldo Tujuan:</span>
                        <span
                          className={`font-mono font-bold ${
                            isOverGoal ? 'text-danger' : 'text-text-base'
                          }`}
                        >
                          {formatRupiah(estGoalBal)}
                        </span>
                        <span className="text-[10px] text-text-muted">
                          Progres: {newProgress}%
                        </span>
                      </div>

                      <div className="flex flex-col">
                        <span className="text-text-muted text-[10px]">Saldo Dompet Setelahnya:</span>
                        <span className="font-mono font-bold text-primary">
                          {formatRupiah(estWalletBal)}
                        </span>
                        <span className="text-[10px] text-text-muted">
                          +{formatRupiah(cleanAmount)}
                        </span>
                      </div>
                    </div>

                    {/* Goal delay calculation notice */}
                    {estDelayDays > 0 && (
                      <div className="rounded-xl bg-warning/15 p-2 text-[11px] text-warning flex items-center gap-1.5 font-medium">
                        <span>⏳</span>
                        <span>
                          Penarikan ini berpotensi memundurkan target sekitar <strong>{estDelayDays} hari</strong> berdasarkan alokasi tabungan bulanan.
                        </span>
                      </div>
                    )}

                    {isOverGoal && (
                      <div className="rounded-xl bg-danger/10 p-2 text-[11px] text-danger font-semibold">
                        ⚠️ Nominal melebihi saldo tabungan saat ini ({formatRupiah(withdrawingGoal.currentAmount)})!
                      </div>
                    )}
                  </div>
                )
              })()}

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="submit"
                  disabled={isSubmittingWithdrawal}
                  className="flex-1 rounded-xl bg-warning/90 py-2.5 text-xs font-semibold text-text-base shadow-sm hover:bg-warning active:scale-95 disabled:opacity-50 transition"
                >
                  {isSubmittingWithdrawal ? 'Memproses Penarikan...' : 'Konfirmasi Buka Kunci / Tarik'}
                </button>
                <button
                  type="button"
                  disabled={isSubmittingWithdrawal}
                  onClick={() => setWithdrawingGoal(null)}
                  className="rounded-xl border border-border bg-surface px-4 py-2.5 text-xs font-semibold text-text-muted hover:bg-surface-raised"
                >
                  Batal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function MonthlyHistorySection({ walletRefreshKey }: { walletRefreshKey: number }) {
  const now = new Date()
  const [histYear, setHistYear] = useState<number>(now.getFullYear())
  const [histMonth, setHistMonth] = useState<number>(now.getMonth() + 1)
  const [summary, setSummary] = useState<MonthHistorySummary | null>(null)
  const [transactions, setTransactions] = useState<MonthTransactionsByType | null>(null)
  const [goalSnapshots, setGoalSnapshots] = useState<GoalProgressSnapshot[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [showDetail, setShowDetail] = useState(false)

  const monthNames = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
  ]

  const loadHistory = async () => {
    setIsLoading(true)
    setErrorMsg(null)
    const [sumRes, txRes, goalRes] = await Promise.all([
      getMonthHistorySummary(histYear, histMonth),
      getMonthTransactions(histYear, histMonth),
      getGoalProgressSnapshots(),
    ])

    if (sumRes.error) {
      setErrorMsg(sumRes.error)
    } else {
      setSummary(sumRes.data)
    }
    setTransactions(txRes.data)
    setGoalSnapshots(goalRes.data)
    setIsLoading(false)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [histYear, histMonth, walletRefreshKey])

  const handlePrevMonth = () => {
    if (histMonth === 1) {
      setHistYear((y) => y - 1)
      setHistMonth(12)
    } else {
      setHistMonth((m) => m - 1)
    }
    setShowDetail(false)
  }

  const handleNextMonth = () => {
    if (histMonth === 12) {
      setHistYear((y) => y + 1)
      setHistMonth(1)
    } else {
      setHistMonth((m) => m + 1)
    }
    setShowDetail(false)
  }

  const hasTx = transactions && (
    transactions.income.length > 0 ||
    transactions.expense.length > 0 ||
    transactions.savingsContribution.length > 0 ||
    transactions.savingsWithdrawal.length > 0
  )

  return (
    <div className="flex flex-col gap-4">
      {/* Header with month navigator */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <h2 className="text-base font-bold text-text-base">Riwayat Keuangan Bulanan</h2>
          <span className="text-[11px] text-text-muted">Ringkasan pendapatan, pengeluaran, dan tabungan</span>
        </div>

        <div className="flex items-center gap-1 rounded-2xl bg-surface border border-border px-2 py-1 shadow-xs">
          <button
            onClick={handlePrevMonth}
            className="px-1.5 py-0.5 text-xs font-bold text-text-muted hover:text-text-base active:scale-95"
            title="Bulan Sebelumnya"
          >
            ‹
          </button>
          <span className="text-xs font-bold text-text-base min-w-[84px] text-center">
            {monthNames[histMonth - 1]} {histYear}
          </span>
          <button
            onClick={handleNextMonth}
            className="px-1.5 py-0.5 text-xs font-bold text-text-muted hover:text-text-base active:scale-95"
            title="Bulan Berikutnya"
          >
            ›
          </button>
        </div>
      </div>

      {errorMsg && (
        <div role="alert" className="rounded-2xl bg-danger/10 border border-danger/20 p-3 text-xs text-danger font-medium flex items-center justify-between">
          <span>⚠️ {errorMsg}</span>
          <button onClick={loadHistory} className="text-xs underline font-bold">Coba Lagi</button>
        </div>
      )}

      {isLoading ? (
        <div className="h-48 animate-pulse rounded-3xl bg-surface border border-border" />
      ) : !summary ? (
        <div className="rounded-3xl bg-surface border border-border p-6 text-center flex flex-col items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-surface-raised border border-border text-xl">
            📊
          </div>
          <p className="text-xs font-bold text-text-base">Belum Ada Riwayat Keuangan</p>
          <p className="text-[11px] text-text-muted max-w-xs">
            Belum ada data keuangan untuk bulan ini. Mulai catat pemasukan dan pengeluaran untuk melihat ringkasan.
          </p>
        </div>
      ) : (
        <>
          {/* Monthly Summary Card */}
          <div className="rounded-3xl bg-surface border border-border p-5 shadow-sm flex flex-col gap-4">
            {/* Status Badge */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-surface-raised border border-border text-xl">
                  📊
                </span>
                <div className="flex flex-col">
                  <span className="text-sm font-bold text-text-base">
                    {monthNames[histMonth - 1]} {histYear}
                  </span>
                  <span className="text-[10px] text-text-muted">
                    Ringkasan Keuangan Bulanan
                  </span>
                </div>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
                  summary.isFinalized
                    ? 'bg-primary/15 text-primary'
                    : 'bg-highlight/40 text-text-base'
                }`}
              >
                {summary.isFinalized ? 'Selesai' : 'Belum Ditutup'}
              </span>
            </div>

            {/* Financial Grid */}
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
              <HistoryMetric label="Pemasukan" value={summary.totalIncome} color="text-primary" />
              <HistoryMetric label="Budget Operasional" value={summary.plannedOperationalBudget} />
              <HistoryMetric label="Pengeluaran" value={summary.actualOperationalSpending} color={summary.isOverspent ? 'text-danger' : undefined} />
              {summary.isOverspent ? (
                <HistoryMetric label="Kelebihan Belanja" value={summary.overspentAmount} color="text-danger" prefix="-" />
              ) : (
                <HistoryMetric label="Sisa Budget" value={summary.budgetLeftover} color="text-primary" />
              )}
            </div>

            {/* Savings Activity */}
            <div className="flex flex-col gap-2 pt-2 border-t border-border">
              <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Aktivitas Tabungan</span>
              <div className="grid grid-cols-2 gap-3">
                <HistoryMetric label="Ditabung (Aktual)" value={summary.actualSavingsContributed} color="text-savings" />
                <HistoryMetric label="Ditarik" value={summary.savingsWithdrawn} color={summary.savingsWithdrawn > 0 ? 'text-danger' : undefined} />
                <HistoryMetric label="Neto Tabungan" value={summary.netSavingsMovement} color={summary.netSavingsMovement >= 0 ? 'text-savings' : 'text-danger'} />
                <HistoryMetric label="Rollover" value={summary.rolloverAmount} />
              </div>
            </div>
          </div>

          {/* Goal Progress (Current Snapshot) */}
          {goalSnapshots.length > 0 && (
            <div className="rounded-3xl bg-surface border border-border p-5 shadow-sm flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-base">🎯</span>
                  <span className="text-xs font-bold text-text-base">Progres Tujuan Tabungan</span>
                </div>
                <span className="text-[10px] text-text-muted italic">Saldo saat ini</span>
              </div>
              <div className="flex flex-col gap-2.5 pt-2 border-t border-border">
                {goalSnapshots.filter((g) => g.status === 'active').map((goal) => (
                  <div key={goal.id} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-text-base">{goal.name}</span>
                      <span className="font-mono text-[11px] text-text-muted">
                        {goal.progressPercent}%
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-surface-raised border border-border overflow-hidden">
                      <div
                        className="h-full rounded-full bg-savings transition-all duration-300"
                        style={{ width: `${Math.min(100, goal.progressPercent)}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-text-muted">
                      <span>{formatRupiah(goal.currentAmount)}</span>
                      <span>Target: {formatRupiah(goal.targetAmount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Transaction Detail Toggle */}
          <button
            onClick={() => setShowDetail(!showDetail)}
            className="rounded-2xl bg-surface border border-border px-4 py-2.5 text-xs font-semibold text-text-muted hover:bg-surface-raised active:scale-[0.98] transition flex items-center justify-center gap-1.5"
          >
            <span>{showDetail ? '▾' : '▸'}</span>
            <span>{showDetail ? 'Tutup Detail Transaksi' : 'Lihat Detail Transaksi'}</span>
          </button>

          {/* Transaction Detail */}
          {showDetail && (
            <div className="rounded-3xl bg-surface border border-border p-5 shadow-sm flex flex-col gap-4">
              <span className="text-xs font-bold text-text-base">Detail Transaksi — {monthNames[histMonth - 1]} {histYear}</span>

              {!hasTx ? (
                <div className="text-center py-4">
                  <p className="text-xs text-text-muted">Tidak ada transaksi bulan ini.</p>
                </div>
              ) : (
                <>
                  <HistoryTxGroup label="Pemasukan" icon="↓" rows={transactions?.income || []} color="text-primary" />
                  <HistoryTxGroup label="Pengeluaran Operasional" icon="↑" rows={transactions?.expense || []} color="text-danger" />
                  <HistoryTxGroup label="Kontribusi Tabungan" icon="◎" rows={transactions?.savingsContribution || []} color="text-savings" />
                  <HistoryTxGroup label="Penarikan Tabungan" icon="↗" rows={transactions?.savingsWithdrawal || []} color="text-warning" />
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** Read-only metric display for monthly history card */
function HistoryMetric({
  label,
  value,
  color,
  prefix,
}: {
  label: string
  value: number
  color?: string
  prefix?: string
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-text-muted">{label}</span>
      <span className={`text-sm font-bold font-mono ${color || 'text-text-base'}`}>
        {prefix}{formatRupiah(value)}
      </span>
    </div>
  )
}

/** Transaction group for history detail view */
function HistoryTxGroup({
  label,
  icon,
  rows,
  color,
}: {
  label: string
  icon: string
  rows: { id: string; amount: number; description: string | null; transactionDate: string }[]
  color: string
}) {
  if (rows.length === 0) return null

  return (
    <div className="flex flex-col gap-2 pt-2 border-t border-border first:border-t-0 first:pt-0">
      <div className="flex items-center gap-1.5">
        <span className="text-sm">{icon}</span>
        <span className="text-[11px] font-bold text-text-base">{label}</span>
        <span className="text-[10px] text-text-muted">({rows.length})</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {rows.map((tx) => (
          <div key={tx.id} className="flex items-center justify-between text-xs px-1">
            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
              <span className="text-text-base truncate">{tx.description || '(Tanpa keterangan)'}</span>
              <span className="text-[10px] text-text-muted">{tx.transactionDate}</span>
            </div>
            <span className={`font-mono font-bold flex-shrink-0 ml-2 ${color}`}>
              {formatRupiah(tx.amount)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// =============================================================================
// M2.14 Financial Dashboard & Accounting Insights Component
// =============================================================================

const MONTH_NAMES_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
]

function DashboardSection({
  refreshKey,
  onNavigate,
}: {
  refreshKey: number
  onNavigate?: (id: SectionId) => void
}) {
  const now = new Date()
  const [selectedYear, setSelectedYear] = useState<number>(now.getFullYear())
  const [selectedMonth, setSelectedMonth] = useState<number>(now.getMonth() + 1)
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  const loadDashboard = async (year: number, month: number) => {
    setIsLoading(true)
    setError(null)
    const res = await getDashboardData(year, month)
    if (res.error) {
      setError(res.error)
      setDashboardData(null)
    } else {
      setDashboardData(res.data)
    }
    setIsLoading(false)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDashboard(selectedYear, selectedMonth)
  }, [selectedYear, selectedMonth, refreshKey])

  const handlePrevMonth = () => {
    if (selectedMonth === 1) {
      setSelectedYear((y) => y - 1)
      setSelectedMonth(12)
    } else {
      setSelectedMonth((m) => m - 1)
    }
  }

  const handleNextMonth = () => {
    if (selectedMonth === 12) {
      setSelectedYear((y) => y + 1)
      setSelectedMonth(1)
    } else {
      setSelectedMonth((m) => m + 1)
    }
  }

  const handleCurrentMonth = () => {
    const cur = new Date()
    setSelectedYear(cur.getFullYear())
    setSelectedMonth(cur.getMonth() + 1)
  }

  const isCurrentMonth =
    selectedYear === now.getFullYear() && selectedMonth === now.getMonth() + 1

  return (
    <div className="flex flex-col gap-6">
      {/* Financial Period (Month) Navigator & Refresh Control */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          {/* Main Month Stepper Control */}
          <div className="inline-flex items-center rounded-2xl bg-surface border border-border p-1 shadow-2xs">
            <button
              onClick={handlePrevMonth}
              className="flex items-center justify-center h-8 w-8 rounded-xl text-ink-secondary hover:text-ink hover:bg-surface-raised active:scale-95 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              aria-label="Bulan sebelumnya"
              title="Bulan sebelumnya"
            >
              <ChevronLeft size={17} strokeWidth={2.4} />
            </button>

            <div className="px-3.5 py-1 text-center min-w-[130px] sm:min-w-[150px]">
              <span className="text-xs sm:text-sm font-bold text-ink tracking-tight block leading-none">
                {MONTH_NAMES_ID[selectedMonth - 1]} {selectedYear}
              </span>
            </div>

            <button
              onClick={handleNextMonth}
              className="flex items-center justify-center h-8 w-8 rounded-xl text-ink-secondary hover:text-ink hover:bg-surface-raised active:scale-95 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              aria-label="Bulan berikutnya"
              title="Bulan berikutnya"
            >
              <ChevronRight size={17} strokeWidth={2.4} />
            </button>
          </div>

          {/* Current Month Status / Jump Shortcut */}
          <div className="flex items-center">
            {isCurrentMonth ? (
              <span
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-raised border border-border text-[11px] font-semibold text-ink-secondary"
                aria-label="Periode aktif adalah bulan ini"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                <span>Bulan ini</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={handleCurrentMonth}
                aria-label="Kembali ke bulan ini"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary/10 border border-primary/20 text-[11px] font-semibold text-primary hover:bg-primary/15 transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <RotateCcw size={11} strokeWidth={2.2} />
                <span>Kembali ke bulan ini</span>
              </button>
            )}
          </div>
        </div>

        {/* Data Refresh Button */}
        <button
          type="button"
          onClick={() => loadDashboard(selectedYear, selectedMonth)}
          title="Segarkan data periode ini"
          aria-label="Segarkan data periode ini"
          className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink-muted hover:text-ink hover:bg-surface-raised transition active:scale-95 shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <RotateCcw size={13} className={isLoading ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">Segarkan</span>
        </button>
      </div>

      {/* Loading Skeleton */}
      {isLoading && (
        <div className="flex flex-col gap-6 animate-pulse">
          <div className="rounded-3xl bg-surface-raised p-6 sm:p-8 border border-border h-48 sm:h-56" />
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            <div className="md:col-span-7 rounded-3xl bg-surface p-6 border border-border h-64" />
            <div className="md:col-span-5 rounded-3xl bg-surface p-6 border border-border h-64" />
          </div>
        </div>
      )}

      {/* Error State */}
      {!isLoading && error && (
        <div className="rounded-3xl bg-danger/5 border border-danger/20 p-6 sm:p-8 flex flex-col items-center gap-3 text-center">
          <div className="h-10 w-10 rounded-2xl bg-danger/10 text-danger flex items-center justify-center font-bold">
            !
          </div>
          <div className="flex flex-col gap-1 max-w-sm">
            <p className="text-sm font-bold text-ink">Ada kendala memuat data</p>
            <p className="text-xs text-ink-muted">{error}</p>
          </div>
          <button
            onClick={() => loadDashboard(selectedYear, selectedMonth)}
            className="rounded-xl bg-danger text-text-inverse px-4 py-2 text-xs font-semibold shadow-xs active:scale-95 transition hover:opacity-95"
          >
            Coba Lagi
          </button>
        </div>
      )}

      {/* Content State */}
      {!isLoading && !error && dashboardData && (
        <div className="flex flex-col gap-6">
          {/* 1. HERO SURFACE: Total Money & Quick Action Bar */}
          <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-highlight/50 via-surface-raised to-primary/10 border border-border-strong p-6 sm:p-8 shadow-sm">
            <div className="relative z-10 flex flex-col gap-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-ink-secondary">
                    Total Uang Kamu
                  </span>
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-surface/80 border border-border text-ink-secondary">
                    {dashboardData.walletSummary.wallets.length} tempat simpan
                  </span>
                </div>

                {/* Net indicator badge */}
                <span
                  className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
                    dashboardData.cashflow.netCashflow >= 0
                      ? 'bg-surface/80 border-border text-primary font-bold'
                      : 'bg-danger/10 border-danger/20 text-danger font-bold'
                  }`}
                >
                  {dashboardData.cashflow.netCashflow >= 0 ? '+' : ''}
                  {formatRupiah(dashboardData.cashflow.netCashflow)} bulan ini
                </span>
              </div>

              {/* Massive Hero Balance Typography */}
              <div>
                <p className="text-3xl sm:text-5xl font-black font-mono tracking-tight text-ink">
                  {formatRupiah(dashboardData.walletSummary.totalBalance)}
                </p>
                <p className="text-xs text-ink-muted mt-1">
                  Saldo akumulasi dari seluruh dompet tunai dan rekening digital kamu.
                </p>
              </div>

              {/* Quick Actions Bar */}
              {onNavigate && (
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/80">
                  <button
                    type="button"
                    onClick={() => onNavigate('transactions')}
                    className="flex items-center gap-1.5 rounded-xl bg-primary text-text-inverse px-3.5 py-2 text-xs font-semibold shadow-xs hover:opacity-95 active:scale-95 transition"
                  >
                    <Plus size={14} strokeWidth={2.5} />
                    <span>Catat Transaksi</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onNavigate('goals')}
                    className="flex items-center gap-1.5 rounded-xl bg-surface border border-border px-3.5 py-2 text-xs font-semibold text-ink hover:bg-surface-raised active:scale-95 transition shadow-xs"
                  >
                    <Target size={14} className="text-digital" strokeWidth={2.5} />
                    <span>Nabung ke Target</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onNavigate('wallets')}
                    className="flex items-center gap-1.5 rounded-xl bg-surface border border-border px-3.5 py-2 text-xs font-semibold text-ink-secondary hover:text-ink hover:bg-surface-raised active:scale-95 transition shadow-xs"
                  >
                    <WalletIcon size={14} strokeWidth={2} />
                    <span>Kelola Dompet</span>
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* 2. SECONDARY SECTION: Cashflow Visualization & Monthly Movement */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            {/* Left 7 cols: Arus Kas Visual */}
            <div className="md:col-span-7 rounded-3xl bg-surface border border-border p-6 shadow-xs flex flex-col justify-between gap-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm sm:text-base font-bold text-ink">Arus Uang Bulan Ini</h2>
                  <p className="text-xs text-ink-muted">Pemasukan, pengeluaran, dan tabungan yang bergerak</p>
                </div>
                <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-surface-raised border border-border text-ink-secondary">
                  {MONTH_NAMES_ID[selectedMonth - 1]}
                </span>
              </div>

              {/* Proportional visual comparison bars */}
              {(() => {
                const inc = dashboardData.cashflow.totalIncome
                const exp = dashboardData.cashflow.totalExpenses
                const sav = dashboardData.savingsMovement.actualContributions
                const maxVal = Math.max(inc, exp, sav, 1)

                return (
                  <div className="flex flex-col gap-3 py-1">
                    {/* Income Bar */}
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between text-xs">
                        <span className="font-medium text-ink-secondary flex items-center gap-1.5">
                          <ArrowDownLeft size={13} className="text-primary" />
                          <span>Pemasukan</span>
                        </span>
                        <span className="font-mono font-bold text-primary">
                          +{formatRupiah(inc)}
                        </span>
                      </div>
                      <div className="h-2.5 w-full rounded-full bg-surface-raised overflow-hidden border border-border-subtle">
                        <div
                          className="h-full bg-primary rounded-full transition-all duration-500"
                          style={{ width: `${Math.max(4, Math.round((inc / maxVal) * 100))}%` }}
                        />
                      </div>
                    </div>

                    {/* Expense Bar */}
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between text-xs">
                        <span className="font-medium text-ink-secondary flex items-center gap-1.5">
                          <ArrowUpRight size={13} className="text-danger" />
                          <span>Pengeluaran Belanja</span>
                        </span>
                        <span className="font-mono font-bold text-danger">
                          -{formatRupiah(exp)}
                        </span>
                      </div>
                      <div className="h-2.5 w-full rounded-full bg-surface-raised overflow-hidden border border-border-subtle">
                        <div
                          className="h-full bg-danger rounded-full transition-all duration-500"
                          style={{ width: `${Math.max(4, Math.round((exp / maxVal) * 100))}%` }}
                        />
                      </div>
                    </div>

                    {/* Savings Contribution Bar */}
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between text-xs">
                        <span className="font-medium text-ink-secondary flex items-center gap-1.5">
                          <Target size={13} className="text-digital" />
                          <span>Nabung Masuk</span>
                        </span>
                        <span className="font-mono font-bold text-digital">
                          +{formatRupiah(sav)}
                        </span>
                      </div>
                      <div className="h-2.5 w-full rounded-full bg-surface-raised overflow-hidden border border-border-subtle">
                        <div
                          className="h-full bg-digital rounded-full transition-all duration-500"
                          style={{ width: `${Math.max(4, Math.round((sav / maxVal) * 100))}%` }}
                        />
                      </div>
                    </div>
                  </div>
                )
              })()}

              {/* Bottom Cashflow Metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-3 border-t border-border text-xs">
                <div className="flex flex-col rounded-2xl bg-surface-raised p-2.5">
                  <span className="text-[10px] text-ink-muted">Net Operasional</span>
                  <span
                    className={`text-xs font-mono font-bold mt-0.5 ${
                      dashboardData.cashflow.netCashflow >= 0 ? 'text-primary' : 'text-danger'
                    }`}
                  >
                    {dashboardData.cashflow.netCashflow >= 0 ? '+' : ''}
                    {formatRupiah(dashboardData.cashflow.netCashflow)}
                  </span>
                </div>

                <div className="flex flex-col rounded-2xl bg-surface-raised p-2.5">
                  <span className="text-[10px] text-ink-muted">Gerakan Bersih Tabungan</span>
                  <span
                    className={`text-xs font-mono font-bold mt-0.5 ${
                      dashboardData.savingsMovement.netSavingsMovement >= 0 ? 'text-digital' : 'text-danger'
                    }`}
                  >
                    {dashboardData.savingsMovement.netSavingsMovement >= 0 ? '+' : ''}
                    {formatRupiah(dashboardData.savingsMovement.netSavingsMovement)}
                  </span>
                </div>

                <div className="col-span-2 sm:col-span-1 flex flex-col rounded-2xl bg-surface-raised p-2.5">
                  <span className="text-[10px] text-ink-muted">Ambil Tabungan</span>
                  <span className="text-xs font-mono font-bold text-ink-secondary mt-0.5">
                    {dashboardData.savingsMovement.actualWithdrawals > 0
                      ? `-${formatRupiah(dashboardData.savingsMovement.actualWithdrawals)}`
                      : 'Rp 0'}
                  </span>
                </div>
              </div>
            </div>

            {/* Right 5 cols: Anggaran Belanja */}
            <div className="md:col-span-5 rounded-3xl bg-surface-warm/60 border border-border p-6 shadow-xs flex flex-col justify-between gap-4">
              <div>
                <div className="flex items-center justify-between">
                  <h2 className="text-sm sm:text-base font-bold text-ink">Anggaran Belanja</h2>
                  <span
                    className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full ${
                      dashboardData.budgetUsage.isOverspent
                        ? 'bg-danger/10 text-danger'
                        : 'bg-primary/10 text-primary'
                    }`}
                  >
                    {dashboardData.budgetUsage.utilizationPercentage}% terpakai
                  </span>
                </div>
                <p className="text-xs text-ink-muted mt-0.5">
                  {dashboardData.budgetUsage.isOverspent
                    ? 'Pengeluaran melebihi batas anggaran yang direncanakan.'
                    : 'Pemakaian masih dalam batas rencana bulanan.'}
                </p>
              </div>

              {/* Large budget progress */}
              <div className="flex flex-col gap-2">
                <div className="h-3 w-full rounded-full bg-surface overflow-hidden border border-border">
                  <div
                    className={`h-full transition-all duration-500 rounded-full ${
                      dashboardData.budgetUsage.isOverspent ? 'bg-danger' : 'bg-primary'
                    }`}
                    style={{ width: `${Math.min(100, dashboardData.budgetUsage.utilizationPercentage)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[11px] text-ink-muted font-mono">
                  <span>Terpakai: {formatRupiah(dashboardData.budgetUsage.actualOperationalSpending)}</span>
                  <span>Plafon: {formatRupiah(dashboardData.budgetUsage.totalAllocatedBudget)}</span>
                </div>
              </div>

              <div className="rounded-2xl bg-surface p-3 border border-border flex items-center justify-between">
                <span className="text-xs font-medium text-ink-muted">
                  {dashboardData.budgetUsage.isOverspent ? 'Melebihi Anggaran' : 'Sisa Anggaran'}
                </span>
                <span
                  className={`font-mono font-bold text-sm ${
                    dashboardData.budgetUsage.isOverspent ? 'text-danger' : 'text-primary'
                  }`}
                >
                  {dashboardData.budgetUsage.isOverspent
                    ? `-${formatRupiah(dashboardData.budgetUsage.overspentAmount)}`
                    : formatRupiah(dashboardData.budgetUsage.remainingBudget)}
                </span>
              </div>
            </div>
          </div>

          {/* 3. LOWER SECTION: Wallets + Goals Grid */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            {/* Wallets: 5 cols */}
            <div className="md:col-span-5 rounded-3xl bg-surface border border-border p-6 shadow-xs flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm sm:text-base font-bold text-ink">Dompet Kamu</h2>
                  <p className="text-xs text-ink-muted">Tempat uang tunai & saldo rekening berada</p>
                </div>
                {onNavigate && (
                  <button
                    type="button"
                    onClick={() => onNavigate('wallets')}
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    Atur
                  </button>
                )}
              </div>

              {dashboardData.walletSummary.wallets.length === 0 ? (
                <div className="rounded-2xl bg-surface-raised p-4 text-center flex flex-col items-center gap-2">
                  <p className="text-xs text-ink-muted">Belum ada dompet dibuat.</p>
                  {onNavigate && (
                    <button
                      type="button"
                      onClick={() => onNavigate('wallets')}
                      className="rounded-xl bg-primary text-text-inverse px-3 py-1.5 text-xs font-semibold"
                    >
                      + Tambah Dompet
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {dashboardData.walletSummary.wallets.map((w) => {
                    const isCash = w.type === 'cash'
                    return (
                      <div
                        key={w.id}
                        className={`flex items-center justify-between p-3.5 rounded-2xl border transition ${
                          isCash
                            ? 'bg-surface-raised/80 border-border'
                            : 'bg-digital/5 border-digital/20'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl font-bold ${
                              isCash ? 'bg-primary/10 text-primary' : 'bg-digital/15 text-digital'
                            }`}
                          >
                            {isCash ? <WalletIcon size={17} /> : <CreditCard size={17} />}
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="text-xs font-bold text-ink truncate">{w.label}</span>
                            <span className="text-[10px] text-ink-muted capitalize">
                              {isCash ? 'Uang Tunai (Cash)' : 'Digital / Bank'}
                            </span>
                          </div>
                        </div>

                        <span className="text-xs sm:text-sm font-mono font-bold text-ink shrink-0 ml-3">
                          {formatRupiah(w.balance)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Goals: 7 cols */}
            <div className="md:col-span-7 rounded-3xl bg-surface border border-border p-6 shadow-xs flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm sm:text-base font-bold text-ink">Target Tabungan</h2>
                  <p className="text-xs text-ink-muted">Pantau progres impian finansial kamu</p>
                </div>
                {onNavigate && (
                  <button
                    type="button"
                    onClick={() => onNavigate('goals')}
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    Lihat Semua ({dashboardData.goals.length})
                  </button>
                )}
              </div>

              {dashboardData.goals.length === 0 ? (
                <div className="rounded-2xl bg-surface-raised p-6 text-center flex flex-col items-center gap-2">
                  <p className="text-xs text-ink-muted">
                    Belum punya target? Bikin satu untuk mulai nabung dan pantau impianmu.
                  </p>
                  {onNavigate && (
                    <button
                      type="button"
                      onClick={() => onNavigate('goals')}
                      className="rounded-xl bg-primary text-text-inverse px-3.5 py-2 text-xs font-semibold shadow-xs"
                    >
                      + Bikin Target Tabungan
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {dashboardData.goals.slice(0, 3).map((g) => (
                    <div
                      key={g.id}
                      className="rounded-2xl bg-surface-raised border border-border p-4 flex flex-col gap-2.5 transition hover:border-digital/40"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-ink">{g.name}</span>
                          {g.isPrimary && (
                            <span className="text-[9px] px-2 py-0.5 bg-primary/10 text-primary rounded-full font-semibold">
                              Target Utama
                            </span>
                          )}
                          {g.isOverfunded && (
                            <span className="text-[9px] px-2 py-0.5 bg-digital/20 text-digital rounded-full font-bold">
                              Tercapai
                            </span>
                          )}
                        </div>

                        <span className="font-mono text-xs font-bold text-digital">
                          {g.progressPercent}%
                        </span>
                      </div>

                      {/* Motivating Progress Bar */}
                      <div className="h-2 w-full rounded-full bg-surface overflow-hidden border border-border-subtle">
                        <div
                          className="h-full bg-digital transition-all duration-500 rounded-full"
                          style={{ width: `${Math.min(100, g.progressPercent)}%` }}
                        />
                      </div>

                      <div className="flex items-center justify-between text-[11px] font-mono text-ink-muted">
                        <span>{formatRupiah(g.currentAmount)} terkumpul</span>
                        <span>Target: {formatRupiah(g.targetAmount)}</span>
                      </div>
                    </div>
                  ))}

                  {dashboardData.goals.length > 3 && onNavigate && (
                    <button
                      type="button"
                      onClick={() => onNavigate('goals')}
                      className="w-full text-center py-2 text-xs font-medium text-ink-muted hover:text-ink"
                    >
                      + {dashboardData.goals.length - 3} target lainnya
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// =============================================================================
// M2.15 Financial Reports & Data Export Component
// =============================================================================

function ExportSection({ refreshKey }: { refreshKey: number }) {
  const now = new Date()
  const [selectedYear, setSelectedYear] = useState<number>(now.getFullYear())
  const [selectedMonth, setSelectedMonth] = useState<number>(now.getMonth() + 1)
  const [reportData, setReportData] = useState<FinancialReportData | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [isExporting, setIsExporting] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const loadReport = async (year: number, month: number) => {
    setIsLoading(true)
    setError(null)
    setSuccessMsg(null)
    const res = await getFinancialReportData(year, month)
    if (res.error) {
      setError(res.error)
      setReportData(null)
    } else {
      setReportData(res.data)
    }
    setIsLoading(false)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadReport(selectedYear, selectedMonth)
  }, [selectedYear, selectedMonth, refreshKey])

  const handlePrevMonth = () => {
    if (selectedMonth === 1) {
      setSelectedYear((y) => y - 1)
      setSelectedMonth(12)
    } else {
      setSelectedMonth((m) => m - 1)
    }
  }

  const handleNextMonth = () => {
    if (selectedMonth === 12) {
      setSelectedYear((y) => y + 1)
      setSelectedMonth(1)
    } else {
      setSelectedMonth((m) => m + 1)
    }
  }

  const handleCurrentMonth = () => {
    const cur = new Date()
    setSelectedYear(cur.getFullYear())
    setSelectedMonth(cur.getMonth() + 1)
  }

  const handleDownloadCsv = () => {
    if (!reportData) return
    setIsExporting(true)
    try {
      const csvText = generateFinancialReportCsv(reportData)
      const blob = new Blob(['\uFEFF' + csvText], { type: 'text/csv;charset=utf-8;' })
      const downloadUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const formattedMonth = String(selectedMonth).padStart(2, '0')
      a.href = downloadUrl
      a.download = `laporan_keuangan_${selectedYear}_${formattedMonth}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(downloadUrl)
      setSuccessMsg(`Laporan periode ${MONTH_NAMES_ID[selectedMonth - 1]} ${selectedYear} berhasil diunduh.`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal menghasilkan file CSV.')
    } finally {
      setIsExporting(false)
    }
  }

  const isCurrentMonth =
    selectedYear === now.getFullYear() && selectedMonth === now.getMonth() + 1

  return (
    <section className="rounded-3xl bg-surface border border-border p-5 shadow-sm flex flex-col gap-4">
      {/* Header & Title */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20">
              <FileText size={18} />
            </span>
            <div>
              <h2 className="text-sm font-bold text-text-base">Ekspor Laporan Keuangan</h2>
              <p className="text-[11px] text-text-muted">Unduh arsip CSV data finansial otoritatif</p>
            </div>
          </div>
          <button
            onClick={() => loadReport(selectedYear, selectedMonth)}
            title="Muat ulang data"
            className="flex items-center justify-center h-8 w-8 rounded-xl border border-border bg-surface text-text-muted hover:text-text-base hover:bg-surface-raised transition active:scale-95 text-xs"
          >
            ↻
          </button>
        </div>

        {/* Month Selector Controls */}
        <div className="flex items-center justify-between rounded-2xl bg-surface-raised border border-border p-1.5 text-xs">
          <button
            onClick={handlePrevMonth}
            className="flex items-center justify-center h-7 w-7 rounded-lg border border-border bg-surface text-text-base hover:bg-surface-raised font-bold transition active:scale-95"
            aria-label="Bulan sebelumnya"
          >
            ‹
          </button>

          <div className="flex items-center gap-2">
            <span className="font-semibold text-text-base">
              {MONTH_NAMES_ID[selectedMonth - 1]} {selectedYear}
            </span>
            {!isCurrentMonth && (
              <button
                onClick={handleCurrentMonth}
                className="text-[10px] text-primary font-medium hover:underline"
              >
                (Bulan Ini)
              </button>
            )}
          </div>

          <button
            onClick={handleNextMonth}
            className="flex items-center justify-center h-7 w-7 rounded-lg border border-border bg-surface text-text-base hover:bg-surface-raised font-bold transition active:scale-95"
            aria-label="Bulan berikutnya"
          >
            ›
          </button>
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center py-6 gap-2">
          <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-xs text-text-muted">Menyiapkan pratinjau laporan...</p>
        </div>
      )}

      {/* Error Alert */}
      {!isLoading && error && (
        <div className="rounded-2xl bg-danger/10 border border-danger/20 p-3.5 flex flex-col items-center gap-2 text-center text-xs">
          <span className="text-xl">⚠️</span>
          <p className="text-danger font-medium">{error}</p>
          <button
            onClick={() => loadReport(selectedYear, selectedMonth)}
            className="rounded-xl bg-danger text-text-inverse px-3 py-1 font-semibold active:scale-95 text-[11px]"
          >
            Coba Lagi
          </button>
        </div>
      )}

      {/* Success Notification */}
      {successMsg && (
        <div className="rounded-2xl bg-surface-raised border border-border p-3 flex items-center gap-2 text-xs text-primary font-medium">
          <span>✅</span>
          <span>{successMsg}</span>
        </div>
      )}

      {/* Report Content Preview & Download */}
      {!isLoading && !error && reportData && (
        <div className="flex flex-col gap-3">
          {/* Summary Preview Box */}
          <div className="rounded-2xl bg-surface-raised border border-border p-3.5 flex flex-col gap-2">
            <span className="text-xs font-bold text-text-base">
              Pratinjau Arsip Data ({MONTH_NAMES_ID[selectedMonth - 1]} {selectedYear})
            </span>
            <div className="grid grid-cols-2 gap-2 text-xs pt-1">
              <div className="flex flex-col rounded-xl bg-surface p-2 border border-border">
                <span className="text-[10px] text-text-muted">Transaksi:</span>
                <span className="font-mono font-bold text-text-base mt-0.5">
                  {reportData.transactions.length} baris
                </span>
              </div>
              <div className="flex flex-col rounded-xl bg-surface p-2 border border-border">
                <span className="text-[10px] text-text-muted">Alokasi Anggaran:</span>
                <span className="font-mono font-bold text-text-base mt-0.5">
                  {reportData.budgets.length} pos
                </span>
              </div>
              <div className="flex flex-col rounded-xl bg-surface p-2 border border-border">
                <span className="text-[10px] text-text-muted">Dompet Otoritatif:</span>
                <span className="font-mono font-bold text-text-base mt-0.5">
                  {reportData.wallets.length} dompet
                </span>
              </div>
              <div className="flex flex-col rounded-xl bg-surface p-2 border border-border">
                <span className="text-[10px] text-text-muted">Target Tabungan:</span>
                <span className="font-mono font-bold text-text-base mt-0.5">
                  {reportData.goals.length} target
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between text-[11px] pt-1 border-t border-border text-text-muted font-mono">
              <span>Net Kas Operasional:</span>
              <span className={`font-bold ${reportData.cashflow.netCashflow >= 0 ? 'text-primary' : 'text-danger'}`}>
                {reportData.cashflow.netCashflow >= 0 ? '+' : ''}
                {formatRupiah(reportData.cashflow.netCashflow)}
              </span>
            </div>
          </div>

          {/* Download Action Button */}
          <button
            onClick={handleDownloadCsv}
            disabled={isExporting}
            className="w-full flex items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-2.5 text-xs font-bold text-text-inverse shadow-sm hover:brightness-105 active:scale-95 transition disabled:opacity-50"
          >
            <FileText size={16} />
            <span>{isExporting ? 'Mengekspor CSV...' : 'Unduh Laporan (CSV UTF-8)'}</span>
          </button>
        </div>
      )}
    </section>
  )
}


