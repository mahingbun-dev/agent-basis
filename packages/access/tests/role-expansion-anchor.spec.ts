/**
 * M-5(37 号 §3,B10/33 §2.1【T】形态):B2 领域专家角色共用机制的静态锚——零行为
 * 改动,只钉「一次立住角色模型」的三处单点,旁路加值/加分支即红:
 * ① UserRole 单点定义(store.ts),联合值集 ≡ users 建表 CHECK 值集(逐字一致);
 * ② visibilityScopeOf 三档映射 + 未知值 fail-closed 判 'self'(exhaustive switch 行为面);
 * ③ client/index.tsx registerSections 角色分支恰一处(approver 落 user 分支=天然
 *   fail-closed,不得另立第二分支)。
 * 专家角色(G2-F4)值/档/面属 M4-M5 批次,本文件不预设任何专家值。
 */
import { readFileSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { visibilityScopeOf } from '../src/mux.ts'
import type { UserRole } from '../src/store.ts'
import { UserStore } from '../src/store.ts'

const storeSrc = readFileSync(join(import.meta.dirname, '..', 'src', 'store.ts'), 'utf8')
const clientIndexSrc = readFileSync(join(import.meta.dirname, '..', 'src', 'client', 'index.tsx'), 'utf8')

function quotedValues(text: string): string[] {
  return [...text.matchAll(/'([^']+)'/g)].map(match => match[1]!)
}

describe('M-5 B2 扩展锚:角色模型单点(零行为改动,旁路即红)', () => {
  it('① UserRole 单点定义恰一处,联合值集 ≡ 建表 CHECK 值集 ≡ 迁移默认值集(逐字)', () => {
    const typeDecls = [...storeSrc.matchAll(/export type UserRole = ([^\n]+)/g)]
    expect(typeDecls).toHaveLength(1)
    const union = quotedValues(typeDecls[0]![1] ?? '')
    expect(union).toEqual(['admin', 'approver', 'user'])
    // 建表值集:构造器 roleCheckOf 实参(源文本单点)
    const ctorCalls = [...storeSrc.matchAll(/roleCheckOf\(\[([^\]]*)\]\)/g)]
    expect(ctorCalls).toHaveLength(1)
    expect(quotedValues(ctorCalls[0]![1] ?? '')).toEqual(union)
    // 迁移默认值集(migrateRoleConstraint 默认参数;B2 二次迁移的复用面)
    const migrateDefaults = [...storeSrc.matchAll(/migrateRoleConstraint\(db: DatabaseSync, allowedRoles: readonly string\[\] = \[([^\]]*)\]\)/g)]
    expect(migrateDefaults).toHaveLength(1)
    expect(quotedValues(migrateDefaults[0]![1] ?? '')).toEqual(union)
    // 运行时核对:新建库 sqlite_master 里 users 表 CHECK 真值集(SQLite 实际强制面)
    const dir = mkdtempSync(join(tmpdir(), 'eterna-role-anchor-'))
    const store = new UserStore(join(dir, 'users.db'))
    try {
      const db = new DatabaseSync(join(dir, 'users.db'))
      try {
        const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get() as { sql: string }
        const check = [...row.sql.matchAll(/CHECK\(role IN \(([^)]*)\)\)/g)]
        expect(check).toHaveLength(1)
        expect(quotedValues(check[0]![1] ?? '')).toEqual(union)
      } finally {
        db.close()
      }
    } finally {
      store.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('② visibilityScopeOf 三档映射 + 未知值 fail-closed 判 self', () => {
    expect(visibilityScopeOf('user')).toBe('self')
    expect(visibilityScopeOf('approver')).toBe('tenant-pending')
    expect(visibilityScopeOf('admin')).toBe('all')
    // 未知值(B2 专家值先行旁路注入的形态)fail-closed:宁可少可见,不可多可见
    expect(visibilityScopeOf('expert' as UserRole)).toBe('self')
  })

  it('③ client 角色分支单一:registerSections 三元恰一处,无第二处角色分支', () => {
    const branch = clientIndexSrc.match(/me\.role === 'admin' \? 'admin' : 'user'/g)
    expect(branch).toHaveLength(1)
    // me.role 仅此一处消费(approver 天然落 user 分支,不见任何 admin 面)
    expect(clientIndexSrc.match(/me\.role/g)).toHaveLength(1)
    // 无按 approver(或其它角色值)另立的分支
    expect(clientIndexSrc).not.toMatch(/role === 'approver'/)
    expect(clientIndexSrc).not.toMatch(/role === 'expert'/)
  })
})
