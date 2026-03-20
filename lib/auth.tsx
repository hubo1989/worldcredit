// lib/auth.tsx
'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import type { UserSchema } from '@insforge/sdk'
import { insforge } from './insforge'

interface AuthContextType {
  user: UserSchema | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserSchema | null>(null)
  const [loading, setLoading] = useState(true)

  // 初始化：检查当前登录状态
  useEffect(() => {
    insforge.auth.getCurrentUser().then(({ data, error }) => {
      if (!error && data?.user) setUser(data.user)
      setLoading(false)
    })
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await insforge.auth.signInWithPassword({ email, password })
    if (error) throw error
    // 登录成功后获取用户信息
    const { data } = await insforge.auth.getCurrentUser()
    setUser(data?.user ?? null)
  }, [])

  const signOut = useCallback(async () => {
    await insforge.auth.signOut()
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be inside AuthProvider')
  return ctx
}
