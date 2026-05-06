// lib/auth.tsx
'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import type { UserSchema } from '@insforge/sdk'
import { insforge, db } from './insforge'
import type { User } from './types'

interface AuthContextType {
  user: UserSchema | null
  profile: User | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, name: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export async function getUserProfile(authId: string): Promise<User | null> {
  const { data, error } = await db
    .from('users')
    .select('*')
    .eq('auth_id', authId)
    .single()
  if (error || !data) return null
  return data as User
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserSchema | null>(null)
  const [profile, setProfile] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchProfile = useCallback(async (authId: string) => {
    const p = await getUserProfile(authId)
    setProfile(p)
  }, [])

  // 初始化：检查当前登录状态
  useEffect(() => {
    insforge.auth.getCurrentUser().then(async ({ data, error }) => {
      if (!error && data?.user) {
        setUser(data.user)
        await fetchProfile(data.user.id)
      }
      setLoading(false)
    })
  }, [fetchProfile])

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await insforge.auth.signInWithPassword({ email, password })
    if (error) throw error
    const { data } = await insforge.auth.getCurrentUser()
    setUser(data?.user ?? null)
    if (data?.user) {
      await fetchProfile(data.user.id)
    }
  }, [fetchProfile])

  const signUp = useCallback(async (email: string, password: string, name: string) => {
    const { error } = await insforge.auth.signUp({ email, password })
    if (error) throw error
    // 注册后自动创建业务用户记录
    const { data } = await insforge.auth.getCurrentUser()
    if (data?.user) {
      setUser(data.user)
      // 检查是否已有 profile，没有则创建
      let profile = await getUserProfile(data.user.id)
      if (!profile) {
        const { error: insertError } = await db.from('users').insert({
          auth_id: data.user.id,
          email,
          name,
          role: 'admin',
        }).select().single()
        if (!insertError) {
          profile = insertError ? null : (await getUserProfile(data.user.id))
        }
      }
      setProfile(profile)
    }
  }, [])

  const signOut = useCallback(async () => {
    await insforge.auth.signOut()
    setUser(null)
    setProfile(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be inside AuthProvider')
  return ctx
}
