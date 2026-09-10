// lib/auth.tsx
"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: 'admin' | 'member';
  created_at: string;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string) => Promise<{ requireEmailVerification: boolean }>;
  verifyEmail: (email: string, otp: string) => Promise<void>;
  resendVerificationEmail: (email: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkUser = async () => {
      try {
        const res = await fetch('/api/auth/session');
        const data = await res.json();
        if (data?.user) {
          setUser(data.user);
        }
      } catch (err) {
        console.error("Auth check failed:", err);
      } finally {
        setLoading(false);
      }
    };
    checkUser();
  }, []);

  const signIn = async (email: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '登录失败');
    if (data?.user) {
      setUser(data.user);
    }
  };

  const signUp = async (email: string, password: string, name: string) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '注册失败');
    if (data?.user) {
      setUser(data.user);
    }
    return { requireEmailVerification: false };
  };

  const signOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
  };

  const verifyEmail = async (_email: string, _otp: string) => {
    throw new Error('邮箱验证暂不支持，请直接登录');
  };

  const resendVerificationEmail = async (_email: string) => {
    throw new Error('邮箱验证暂不支持');
  };

  const signInWithGoogle = async () => {
    throw new Error('Google OAuth 暂不支持，请使用邮箱登录');
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, signIn, signUp, verifyEmail, resendVerificationEmail, signInWithGoogle, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
};
