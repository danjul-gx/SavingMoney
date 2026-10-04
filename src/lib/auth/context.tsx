'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/types/domain'

interface AuthContextType {
  user: User | null
  session: Session | null
  profile: Profile | null
  isLoading: boolean
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const supabase = createClient()

  const fetchProfile = async (currentUser: User): Promise<Profile | null> => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', currentUser.id)
        .maybeSingle()

      if (error) {
        console.error('Failed to fetch profile:', error.message)
        return null
      }

      if (data) {
        return {
          id: data.id,
          userId: data.user_id,
          displayName: data.display_name,
          timezone: data.timezone,
          createdAt: data.created_at,
          updatedAt: data.updated_at,
        }
      }

      // If profile does not exist yet (e.g. first login), lazily create it
      const fallbackName = currentUser.user_metadata?.display_name || currentUser.email?.split('@')[0] || 'User'
      const { data: newProfile, error: insertError } = await supabase
        .from('profiles')
        .insert({
          user_id: currentUser.id,
          display_name: fallbackName,
          timezone: 'Asia/Jakarta',
        })
        .select('*')
        .single()

      if (insertError) {
        // If conflict happened concurrently, retry fetch
        if (insertError.code === '23505') {
          const { data: retryData } = await supabase
            .from('profiles')
            .select('*')
            .eq('user_id', currentUser.id)
            .single()
          if (retryData) {
            return {
              id: retryData.id,
              userId: retryData.user_id,
              displayName: retryData.display_name,
              timezone: retryData.timezone,
              createdAt: retryData.created_at,
              updatedAt: retryData.updated_at,
            }
          }
        }
        console.error('Failed to create default profile:', insertError.message)
        return null
      }

      return {
        id: newProfile.id,
        userId: newProfile.user_id,
        displayName: newProfile.display_name,
        timezone: newProfile.timezone,
        createdAt: newProfile.created_at,
        updatedAt: newProfile.updated_at,
      }
    } catch (err) {
      console.error('Unexpected error fetching profile:', err)
      return null
    }
  }

  const refreshProfile = async () => {
    if (!user) return
    const p = await fetchProfile(user)
    setProfile(p)
  }

  useEffect(() => {
    let isMounted = true

    // Initial session load
    const initializeAuth = async () => {
      try {
        const {
          data: { session: initialSession },
        } = await supabase.auth.getSession()

        if (!isMounted) return

        setSession(initialSession)
        setUser(initialSession?.user ?? null)

        if (initialSession?.user) {
          const p = await fetchProfile(initialSession.user)
          if (isMounted) setProfile(p)
        }
      } catch (err) {
        console.error('Error initializing auth:', err)
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }

    initializeAuth()

    // Listen for auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, currentSession) => {
      if (!isMounted) return

      setSession(currentSession)
      setUser(currentSession?.user ?? null)

      if (currentSession?.user) {
        const p = await fetchProfile(currentSession.user)
        if (isMounted) setProfile(p)
      } else {
        setProfile(null)
      }

      setIsLoading(false)
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const signOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
    setSession(null)
    setProfile(null)
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        isLoading,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
