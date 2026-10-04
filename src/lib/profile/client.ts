import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/types/domain'

export async function getCurrentUserProfile(): Promise<{
  data: Profile | null
  error: string | null
}> {
  const supabase = createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { data: null, error: authError?.message || 'Not authenticated' }
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) {
    return { data: null, error: error.message }
  }

  if (!data) {
    // Lazily create profile if missing
    const fallbackName = user.user_metadata?.display_name || user.email?.split('@')[0] || 'User'
    const { data: created, error: insertError } = await supabase
      .from('profiles')
      .insert({
        user_id: user.id,
        display_name: fallbackName,
        timezone: 'Asia/Jakarta',
      })
      .select('*')
      .single()

    if (insertError) {
      return { data: null, error: insertError.message }
    }

    return {
      data: {
        id: created.id,
        userId: created.user_id,
        displayName: created.display_name,
        timezone: created.timezone,
        createdAt: created.created_at,
        updatedAt: created.updated_at,
      },
      error: null,
    }
  }

  return {
    data: {
      id: data.id,
      userId: data.user_id,
      displayName: data.display_name,
      timezone: data.timezone,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    },
    error: null,
  }
}

export async function updateUserProfile(updates: {
  displayName?: string | null
  timezone?: string
}): Promise<{
  data: Profile | null
  error: string | null
}> {
  const supabase = createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { data: null, error: authError?.message || 'Not authenticated' }
  }

  // Only allowed fields: display_name, timezone
  const payload: {
    display_name?: string | null
    timezone?: string
  } = {}

  if (updates.displayName !== undefined) {
    payload.display_name = updates.displayName ? updates.displayName.trim() : null
  }
  if (updates.timezone !== undefined) {
    payload.timezone = updates.timezone.trim()
  }

  const { data, error } = await supabase
    .from('profiles')
    .update(payload)
    .eq('user_id', user.id)
    .select('*')
    .single()

  if (error) {
    return { data: null, error: error.message }
  }

  return {
    data: {
      id: data.id,
      userId: data.user_id,
      displayName: data.display_name,
      timezone: data.timezone,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    },
    error: null,
  }
}
