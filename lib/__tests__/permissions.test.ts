import { describe, it, expect } from 'vitest'
import { isAdmin, isMember, requireRole, canManageBaseData, canRecordUsage, asRole, getErrorMessage } from '../permissions'
import type { User } from '../types'

const adminUser: User = {
  id: 'admin-1',
  auth_id: 'auth-admin-1',
  email: 'admin@test.com',
  name: '管理员',
  role: 'admin',
  created_at: '2026-01-01',
}

const memberUser: User = {
  id: 'member-1',
  auth_id: 'auth-member-1',
  email: 'member@test.com',
  name: '成员',
  role: 'member',
  created_at: '2026-01-01',
}

describe('isAdmin', () => {
  it('returns true for admin user', () => {
    expect(isAdmin(adminUser)).toBe(true)
  })

  it('returns false for member user', () => {
    expect(isAdmin(memberUser)).toBe(false)
  })

  it('returns false for null', () => {
    expect(isAdmin(null)).toBe(false)
  })
})

describe('isMember', () => {
  it('returns true for member user', () => {
    expect(isMember(memberUser)).toBe(true)
  })

  it('returns false for admin user', () => {
    expect(isMember(adminUser)).toBe(false)
  })

  it('returns false for null', () => {
    expect(isMember(null)).toBe(false)
  })
})

describe('requireRole', () => {
  it('does not throw when role matches', () => {
    expect(() => requireRole(adminUser, 'admin')).not.toThrow()
    expect(() => requireRole(memberUser, 'member')).not.toThrow()
  })

  it('throws when user is null', () => {
    expect(() => requireRole(null, 'admin')).toThrow('未登录')
  })

  it('throws when role does not match', () => {
    expect(() => requireRole(memberUser, 'admin')).toThrow('需要 admin 权限')
    expect(() => requireRole(adminUser, 'member')).toThrow('需要 member 权限')
  })
})

describe('canManageBaseData', () => {
  it('returns true for admin', () => {
    expect(canManageBaseData(adminUser)).toBe(true)
  })

  it('returns false for member', () => {
    expect(canManageBaseData(memberUser)).toBe(false)
  })

  it('returns false for null', () => {
    expect(canManageBaseData(null)).toBe(false)
  })
})

describe('canRecordUsage', () => {
  it('returns true for admin', () => {
    expect(canRecordUsage(adminUser)).toBe(true)
  })

  it('returns true for member', () => {
    expect(canRecordUsage(memberUser)).toBe(true)
  })

  it('returns false for null', () => {
    expect(canRecordUsage(null)).toBe(false)
  })
})

describe('asRole', () => {
  it('returns member for member user', () => {
    expect(asRole(memberUser)).toBe('member')
  })

  it('returns admin for admin user', () => {
    expect(asRole(adminUser)).toBe('admin')
  })

  it('returns admin for null', () => {
    expect(asRole(null)).toBe('admin')
  })
})

describe('getErrorMessage', () => {
  it('extracts message from Error', () => {
    expect(getErrorMessage(new Error('test error'))).toBe('test error')
  })

  it('returns default for non-Error', () => {
    expect(getErrorMessage('string error')).toBe('操作失败')
  })

  it('returns default for null', () => {
    expect(getErrorMessage(null)).toBe('操作失败')
  })
})
