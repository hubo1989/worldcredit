// lib/auth.tsx
"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { insforge } from "./insforge";
import type { UserSchema } from "@insforge/sdk";

interface AuthContextType {
  user: UserSchema | null;
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
  const [user, setUser] = useState<UserSchema | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 获取当前用户（OAuth 回跳时 SDK 会在初始化阶段自动完成 code 交换）
    const checkUser = async () => {
      try {
        const { data } = await insforge.auth.getCurrentUser();
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
    const { data, error } = await insforge.auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (data?.user) {
      setUser(data.user);
    }
  };

  const signUp = async (email: string, password: string, name: string) => {
    const { data, error } = await insforge.auth.signUp({
      email,
      password,
      name: name || undefined,
    });
    if (error) throw error;
    const created = data?.user ?? null;
    if (created?.emailVerified) {
      setUser(created);
    }
    return { requireEmailVerification: !created || !created.emailVerified };
  };

  const verifyEmail = async (email: string, otp: string) => {
    const { data, error } = await insforge.auth.verifyEmail({ otp, email });
    if (error) throw error;
    if (data?.user) {
      setUser(data.user);
    }
  };

  const resendVerificationEmail = async (email: string) => {
    const { error } = await insforge.auth.resendVerificationEmail({ email });
    if (error) throw error;
  };

  const signInWithGoogle = async () => {
    const { error } = await insforge.auth.signInWithOAuth({
      provider: "google",
      redirectTo: `${window.location.origin}/login`,
    });
    if (error) throw error;
  };

  const signOut = async () => {
    const { error } = await insforge.auth.signOut();
    if (error) throw error;
    setUser(null);
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
