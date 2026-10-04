import { createClient } from '@/lib/supabase/client'
import type { FinancialAuditEvent, AuditEventType, AuditFilterCategory } from '@/types/domain'

export interface AuditEventsFetchResult {
  data: FinancialAuditEvent[]
  error: string | null
}

function mapRowToAuditEvent(row: {
  id: string
  user_id: string
  event_type: string
  entity_type: string
  entity_id: string | null
  transaction_id: string | null
  related_transaction_id: string | null
  metadata: unknown
  created_at: string
}): FinancialAuditEvent {
  return {
    id: row.id,
    userId: row.user_id,
    eventType: row.event_type as AuditEventType,
    entityType: row.entity_type,
    entityId: row.entity_id,
    transactionId: row.transaction_id,
    relatedTransactionId: row.related_transaction_id,
    metadata: (typeof row.metadata === 'object' && row.metadata !== null
      ? row.metadata
      : {}) as Record<string, unknown>,
    createdAt: row.created_at,
  }
}

/**
 * Categorize event types into filter groups
 */
export function matchesAuditFilter(eventType: AuditEventType, filter: AuditFilterCategory): boolean {
  if (filter === 'all') return true
  if (filter === 'transactions') {
    return [
      'income_recorded',
      'expense_recorded',
      'adjustment_recorded',
      'transaction_created',
    ].includes(eventType)
  }
  if (filter === 'savings') {
    return [
      'savings_contribution_recorded',
      'savings_withdrawal_recorded',
      'savings_withdrawal_executed',
    ].includes(eventType)
  }
  if (filter === 'reversals') {
    return eventType === 'transaction_reversed'
  }
  if (filter === 'rollover') {
    return [
      'rollover_recorded',
      'budget_rollover_finalized',
    ].includes(eventType)
  }
  return true
}

/**
 * Format audit event into user-friendly human readable label and amount description
 */
export function formatAuditEvent(event: FinancialAuditEvent): {
  title: string
  description: string
  amount: number | null
  icon: string
  badgeColor: string
} {
  const meta = event.metadata || {}
  const amount = typeof meta.amount === 'number' ? meta.amount : null

  switch (event.eventType) {
    case 'income_recorded':
      return {
        title: 'Pemasukan Dicatat',
        description: typeof meta.description === 'string' && meta.description ? meta.description : 'Pemasukan ke dompet',
        amount,
        icon: '↓',
        badgeColor: 'text-primary bg-primary/10 border-primary/20',
      }
    case 'expense_recorded':
      return {
        title: 'Pengeluaran Dicatat',
        description: typeof meta.description === 'string' && meta.description ? meta.description : 'Pengeluaran dari dompet',
        amount,
        icon: '↑',
        badgeColor: 'text-danger bg-danger/10 border-danger/20',
      }
    case 'savings_contribution_recorded':
      return {
        title: 'Alokasi Tabungan',
        description: typeof meta.description === 'string' && meta.description ? meta.description : 'Setoran ke tujuan tabungan',
        amount,
        icon: '🎯',
        badgeColor: 'text-primary bg-primary/10 border-primary/20',
      }
    case 'savings_withdrawal_recorded':
      return {
        title: 'Penarikan Tabungan',
        description: typeof meta.description === 'string' && meta.description ? meta.description : 'Penarikan dari tabungan ke dompet',
        amount,
        icon: '🔓',
        badgeColor: 'text-warning bg-warning/10 border-warning/20',
      }
    case 'savings_withdrawal_executed':
      return {
        title: 'Eksekusi Penarikan Tabungan',
        description: typeof meta.reason === 'string' ? `Alasan: "${meta.reason}"` : 'Penarikan tabungan berhasil diverifikasi',
        amount,
        icon: '📋',
        badgeColor: 'text-warning bg-warning/10 border-warning/20',
      }
    case 'transaction_reversed':
      return {
        title: 'Transaksi Dibatalkan (Reversal)',
        description: typeof meta.reversal_reason === 'string' ? `Alasan: "${meta.reversal_reason}"` : 'Koreksi transaksi berhasil',
        amount,
        icon: '↩',
        badgeColor: 'text-danger bg-danger/10 border-danger/20',
      }
    case 'budget_rollover_finalized': {
      const rolloverAmt = typeof meta.rollover_amount === 'number' ? meta.rollover_amount : 0
      const addedToSav = typeof meta.amount_added_to_savings === 'number' ? meta.amount_added_to_savings : 0
      return {
        title: 'Evaluasi Anggaran Bulanan Selesai',
        description: rolloverAmt > 0
          ? `Rollover perencanaan: Rp${rolloverAmt.toLocaleString('id-ID')}`
          : addedToSav > 0
          ? `Dialokasikan ke tabungan: Rp${addedToSav.toLocaleString('id-ID')}`
          : 'Bulan difinalisasi tanpa sisa anggaran',
        amount: rolloverAmt > 0 ? rolloverAmt : addedToSav > 0 ? addedToSav : null,
        icon: '📅',
        badgeColor: 'text-primary bg-surface-raised border-border',
      }
    }
    case 'rollover_recorded':
      return {
        title: 'Rollover Dicatat',
        description: typeof meta.description === 'string' && meta.description ? meta.description : 'Pemasukan rollover',
        amount,
        icon: '🔄',
        badgeColor: 'text-primary bg-primary/10 border-primary/20',
      }
    case 'adjustment_recorded':
      return {
        title: 'Penyesuaian Saldo',
        description: typeof meta.description === 'string' && meta.description ? meta.description : 'Penyesuaian saldo dompet',
        amount,
        icon: '⚖️',
        badgeColor: 'text-text-muted bg-surface-raised border-border',
      }
    default:
      return {
        title: 'Aktivitas Keuangan',
        description: 'Perubahan catatan keuangan',
        amount,
        icon: 'ℹ️',
        badgeColor: 'text-text-muted bg-surface-raised border-border',
      }
  }
}

/**
 * Fetch authenticated user's financial audit activity events.
 * Read-only from the browser.
 */
export async function getFinancialAuditEvents(
  limit = 50,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseClient?: any
): Promise<AuditEventsFetchResult> {
  const supabase = supabaseClient || createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { data: [], error: authError?.message || 'Sesi tidak ditemukan. Silakan login kembali.' }
  }

  const { data, error } = await supabase
    .from('financial_audit_events')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    return { data: [], error: 'Gagal memuat catatan aktivitas keuangan.' }
  }

  return {
    data: (data || []).map(mapRowToAuditEvent),
    error: null,
  }
}
