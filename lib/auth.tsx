'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { UserSchema } from '@insforge/sdk'
import { insforge } from './insforge'

interface AuthContextType {
  user: UserSchema | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, name: string) => Promise<any>
  resendVerificationEmail: (email: string) => Promise<void>
  verifyEmail: (email: string, otp: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserSchema | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // 从 cookie 恢复登录状态
    insforge.auth.getCurrentUser().then(({ data, error }: { data: { user: UserSchema | null }, error: any }) => {
      if (error) {
        setUser(null)
      } else {
        setUser(data.user ?? null)
      }
      setLoading(false)
    }).catch(() => {
      setUser(null)
      setLoading(false)
    })
  }, [])

  const signIn = async (email: string, password: string) => {
    const { data, error } = await insforge.auth.signInWithPassword({ email, password })
    if (error) throw error
    if (data?.user) {
      setUser(data.user)
    }
  }

  const signUp = async (email: string, password: string, name: string) => {
    const { data, error } = await insforge.auth.signUp({ email, password, name })
    if (error) throw error
    return data
  }

  const resendVerificationEmail = async (email: string) => {
    const { error } = await insforge.auth.resendVerificationEmail({ email })
    if (error) throw error
  }

  const verifyEmail = async (email: string, otp: string) => {
    const { data, error } = await insforge.auth.verifyEmail({ email, otp })
    if (error) throw error
    if (data?.user) {
      setUser(data.user)
    }
  }

  const signInWithGoogle = async () => {
    const { data, error } = await insforge.auth.signInWithOAuth({
      provider: 'google',
      redirectTo: window.location.origin + '/dashboard'
    })
    if (error) throw error
    if (data?.url) {
      window.location.href = data.url
    }
  }

  const signOut = async () => {
    await insforge.auth.signOut()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, resendVerificationEmail, verifyEmail, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be inside AuthProvider')
  return ctx
}
