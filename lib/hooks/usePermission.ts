// lib/hooks/usePermission.ts
'use client'

import { useAuth } from '../auth'
import { isAdmin, isMember, canManageBaseData, canRecordUsage } from '../permissions'
import type { User } from '../types'

export interface PermissionState {
  role: User['role'] | null
  isAdmin: boolean
  isMember: boolean
  canManage: boolean
  canRecord: boolean
  profile: User | null
}

export function usePermission(): PermissionState {
  const { profile } = useAuth()
  return {
    role: profile?.role ?? null,
    isAdmin: isAdmin(profile),
    isMember: isMember(profile),
    canManage: canManageBaseData(profile),
    canRecord: canRecordUsage(profile),
    profile,
  }
}
