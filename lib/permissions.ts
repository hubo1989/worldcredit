// lib/permissions.ts
import type { User } from './types'

export function isAdmin(user: User | null): boolean {
  return user?.role === 'admin'
}

export function isMember(user: User | null): boolean {
  return user?.role === 'member'
}

export function asRole(user: User | null): 'admin' | 'member' {
  return user?.role === 'member' ? 'member' : 'admin'
}

export function requireRole(user: User | null, role: User['role']): void {
  if (!user) {
    throw new Error('未登录')
  }
  if (user.role !== role) {
    throw new Error(`需要 ${role} 权限，当前角色为 ${user.role}`)
  }
}

export function canManageBaseData(user: User | null): boolean {
  return isAdmin(user)
}

export function canRecordUsage(user: User | null): boolean {
  return isAdmin(user) || isMember(user)
}

export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : '操作失败'
}
