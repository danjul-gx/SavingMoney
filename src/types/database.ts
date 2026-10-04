/**
 * Database types — mirrors the Supabase schema exactly.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type WalletType = 'cash' | 'digital'
export type GoalStatus = 'active' | 'completed' | 'archived'
export type BudgetCategory = 'transport' | 'food' | 'other'
export type BudgetPeriod = 'weekly' | 'monthly' | 'interval'
export type AdjustmentDirection = 'credit' | 'debit'
export type TransactionType =
  | 'income'
  | 'expense'
  | 'savings_contribution'
  | 'savings_withdrawal'
  | 'rollover'
  | 'adjustment'

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          user_id: string
          display_name: string | null
          timezone: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          display_name?: string | null
          timezone?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          display_name?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'profiles_user_id_fkey'
            columns: ['user_id']
            isOneToOne: true
            referencedRelation: 'users'
            referencedColumns: ['id']
          }
        ]
      }
      goals: {
        Row: {
          id: string
          user_id: string
          name: string
          target_amount: number
          current_amount: number
          target_year: number | null
          target_month: number | null
          status: GoalStatus
          is_primary: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          target_amount: number
          current_amount?: number
          target_year?: number | null
          target_month?: number | null
          status?: GoalStatus
          is_primary?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          target_amount?: number
          target_year?: number | null
          target_month?: number | null
          status?: GoalStatus
          is_primary?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'goals_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          }
        ]
      }
      wallets: {
        Row: {
          id: string
          user_id: string
          type: WalletType
          label: string
          balance: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          type: WalletType
          label: string
          balance?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          label?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'wallets_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          }
        ]
      }
      app_settings: {
        Row: {
          id: string
          user_id: string
          key: string
          value: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          key: string
          value: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          value?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'app_settings_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          }
        ]
      }
      budget_allocations: {
        Row: {
          id: string
          user_id: string
          wallet_id: string
          budget_year: number
          budget_month: number
          category: BudgetCategory
          custom_label: string | null
          original_amount: number
          period: BudgetPeriod
          interval_days: number | null
          normalized_monthly_amount: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          wallet_id: string
          budget_year: number
          budget_month: number
          category: BudgetCategory
          custom_label?: string | null
          original_amount: number
          period: BudgetPeriod
          interval_days?: number | null
          normalized_monthly_amount: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          original_amount?: number
          period?: BudgetPeriod
          interval_days?: number | null
          normalized_monthly_amount?: number
          custom_label?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'budget_allocations_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'budget_allocations_wallet_id_fkey'
            columns: ['wallet_id']
            isOneToOne: false
            referencedRelation: 'wallets'
            referencedColumns: ['id']
          }
        ]
      }
      transactions: {
        Row: {
          id: string
          user_id: string
          wallet_id: string
          goal_id: string | null
          type: TransactionType
          amount: number
          description: string | null
          transaction_date: string
          adjustment_direction: AdjustmentDirection | null
          reversal_of_transaction_id: string | null
          reversal_reason: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          wallet_id: string
          goal_id?: string | null
          type: TransactionType
          amount: number
          description?: string | null
          transaction_date: string
          adjustment_direction?: AdjustmentDirection | null
          reversal_of_transaction_id?: string | null
          reversal_reason?: string | null
          created_at?: string
        }
        Update: {
          description?: string | null
          transaction_date?: string
        }
        Relationships: [
          {
            foreignKeyName: 'transactions_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'transactions_wallet_id_fkey'
            columns: ['wallet_id']
            isOneToOne: false
            referencedRelation: 'wallets'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'transactions_goal_id_fkey'
            columns: ['goal_id']
            isOneToOne: false
            referencedRelation: 'goals'
            referencedColumns: ['id']
          }
        ]
      }
      savings_withdrawals: {
        Row: {
          id: string
          user_id: string
          goal_id: string
          destination_wallet_id: string
          transaction_id: string
          amount: number
          reason: string
          estimated_delay_days: number
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          goal_id: string
          destination_wallet_id: string
          transaction_id: string
          amount: number
          reason: string
          estimated_delay_days?: number
          created_at?: string
        }
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'savings_withdrawals_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'savings_withdrawals_goal_id_fkey'
            columns: ['goal_id']
            isOneToOne: false
            referencedRelation: 'goals'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'savings_withdrawals_destination_wallet_id_fkey'
            columns: ['destination_wallet_id']
            isOneToOne: false
            referencedRelation: 'wallets'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'savings_withdrawals_transaction_id_fkey'
            columns: ['transaction_id']
            isOneToOne: false
            referencedRelation: 'transactions'
            referencedColumns: ['id']
          }
        ]
      }
      transfers: {
        Row: {
          id: string
          user_id: string
          source_wallet_id: string
          destination_wallet_id: string
          amount: number
          description: string | null
          transfer_date: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          source_wallet_id: string
          destination_wallet_id: string
          amount: number
          description?: string | null
          transfer_date: string
          created_at?: string
        }
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'transfers_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'transfers_source_wallet_id_fkey'
            columns: ['source_wallet_id']
            isOneToOne: false
            referencedRelation: 'wallets'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'transfers_destination_wallet_id_fkey'
            columns: ['destination_wallet_id']
            isOneToOne: false
            referencedRelation: 'wallets'
            referencedColumns: ['id']
          }
        ]
      }
      user_financial_settings: {
        Row: {
          user_id: string
          weekly_multiplier: number
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          weekly_multiplier?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          weekly_multiplier?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'user_financial_settings_user_id_fkey'
            columns: ['user_id']
            isOneToOne: true
            referencedRelation: 'users'
            referencedColumns: ['id']
          }
        ]
      }
      monthly_summaries: {
        Row: {
          id: string
          user_id: string
          year: number
          month: number
          total_income: number
          planned_operational_budget: number
          actual_operational_spending: number
          planned_savings: number
          actual_savings: number
          savings_withdrawn: number
          leftover_operational_budget: number
          amount_added_to_savings: number
          rollover_amount: number
          saved_vs_budget: number
          finalized_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          year: number
          month: number
          total_income?: number
          planned_operational_budget?: number
          actual_operational_spending?: number
          planned_savings?: number
          actual_savings?: number
          savings_withdrawn?: number
          leftover_operational_budget?: number
          amount_added_to_savings?: number
          rollover_amount?: number
          saved_vs_budget?: number
          finalized_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          total_income?: number
          planned_operational_budget?: number
          actual_operational_spending?: number
          planned_savings?: number
          actual_savings?: number
          savings_withdrawn?: number
          leftover_operational_budget?: number
          amount_added_to_savings?: number
          rollover_amount?: number
          saved_vs_budget?: number
          finalized_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'monthly_summaries_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          }
        ]
      }
      financial_audit_events: {
        Row: {
          id: string
          user_id: string
          event_type: string
          entity_type: string
          entity_id: string | null
          transaction_id: string | null
          related_transaction_id: string | null
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          event_type: string
          entity_type: string
          entity_id?: string | null
          transaction_id?: string | null
          related_transaction_id?: string | null
          metadata?: Json
          created_at?: string
        }
        Update: {
          [_ in never]: never
        }
        Relationships: [
          {
            foreignKeyName: 'financial_audit_events_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'financial_audit_events_transaction_id_fkey'
            columns: ['transaction_id']
            isOneToOne: false
            referencedRelation: 'transactions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'financial_audit_events_related_transaction_id_fkey'
            columns: ['related_transaction_id']
            isOneToOne: false
            referencedRelation: 'transactions'
            referencedColumns: ['id']
          }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      wallet_type: WalletType
      goal_status: GoalStatus
      budget_category: BudgetCategory
      budget_period: BudgetPeriod
      transaction_type: TransactionType
      adjustment_direction: AdjustmentDirection
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
