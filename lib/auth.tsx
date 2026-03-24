// lib/auth.tsx
'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { insforge } from './insforge'
import type { UserSchema } from '@insforge/sdk'

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

  useEffect(() => {
    // 获取当前用户
    const checkUser = async () => {
      try {
        const { data, error } = await insforge.auth.getCurrentUser()
        if (data?.user) {
          setUser(data.user)
        }
      } catch (err) {
        console.error('Auth check failed:', err)
      } finally {
        setLoading(false)
      }
    }

    checkUser()
  }, [])

  const signIn = async (email: string, password: string) => {
    const { data, error } = await insforge.auth.signInWithPassword({ email, password })
    if (error) throw error
    if (data?.user) {
      setUser(data.user)
    }
  }

  const signOut = async () => {
    const { error } = await insforge.auth.signOut()
    if (error) throw error
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
