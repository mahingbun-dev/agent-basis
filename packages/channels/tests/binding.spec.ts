import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, describe, expect, it } from 'vitest'
import { ChannelBindingStore, bindingKey } from '../src/index.ts'

const dir = mkdtempSync(join(tmpdir(), 'eterna-channels-binding-'))
const dbPath = join(dir, 'bindings.db')

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('ChannelBindingStore:绑定收敛(多渠道 → 同一会话)', () => {
  it('三个渠道身份收敛到同一 session_id', () => {
    const store = ChannelBindingStore.open(dbPath)
    try {
      expect(store.bind('email', 'u1@x.com', 'sess-1').created).toBe(true)
      expect(store.bind('wechat', 'wx-u2', 'sess-1').created).toBe(true)
      expect(store.bind('feishu', 'fs-u3', 'sess-1').created).toBe(true)

      expect(store.resolveSession('email', 'u1@x.com')).toBe('sess-1')
      expect(store.resolveSession('wechat', 'wx-u2')).toBe('sess-1')
      expect(store.resolveSession('feishu', 'fs-u3')).toBe('sess-1')

      const converged = store.sessionBindings('sess-1')
      expect(converged).toHaveLength(3)
      expect(new Set(converged.map(record => record.channelType))).toEqual(new Set(['email', 'wechat', 'feishu']))
      expect(converged.every(record => record.sessionId === 'sess-1')).toBe(true)
    } finally {
      store.close()
    }
  })

  it('同渠道身份 re-bind 即移绑续接:旧会话让位、收敛面收缩', () => {
    const store = ChannelBindingStore.open(dbPath)
    try {
      const outcome = store.bind('email', 'u1@x.com', 'sess-2')
      expect(outcome.created).toBe(false)
      expect(outcome.previousSessionId).toBe('sess-1')
      expect(store.resolveSession('email', 'u1@x.com')).toBe('sess-2')
      // 收敛面:sess-1 只剩 wechat+feishu,sess-2 新收 email
      expect(store.sessionBindings('sess-1').map(r => r.channelType).sort()).toEqual(['feishu', 'wechat'])
      expect(store.sessionBindings('sess-2')).toHaveLength(1)

      // 再绑同一会话:不产生 previousSessionId(exactOptionalPropertyTypes 语义)
      const again = store.bind('email', 'u1@x.com', 'sess-2')
      expect(again.created).toBe(false)
      expect('previousSessionId' in again).toBe(false)
    } finally {
      store.close()
    }
  })

  it('bindIfAbsent 不抢已有绑定(续接优先)', () => {
    const store = ChannelBindingStore.open(dbPath)
    try {
      const outcome = store.bindIfAbsent('wechat', 'wx-u2', 'sess-other')
      expect(outcome.sessionId).toBe('sess-1')
      expect(store.resolveSession('wechat', 'wx-u2')).toBe('sess-1')
    } finally {
      store.close()
    }
  })

  it('unbind 与 size', () => {
    const store = ChannelBindingStore.open(':memory:')
    try {
      store.bind('dingtalk', 'dt-1', 's')
      expect(store.size).toBe(1)
      expect(store.unbind('dingtalk', 'dt-1')).toBe(true)
      expect(store.unbind('dingtalk', 'dt-1')).toBe(false)
      expect(store.size).toBe(0)
      expect(store.resolveSession('dingtalk', 'dt-1')).toBeUndefined()
    } finally {
      store.close()
    }
  })

  it('绑定跨连接持久化(重开同一库文件)', () => {
    const first = ChannelBindingStore.open(dbPath)
    first.bind('wecom', 'wecom-9', 'sess-persist')
    first.close()
    const second = ChannelBindingStore.open(dbPath)
    try {
      expect(second.resolveSession('wecom', 'wecom-9')).toBe('sess-persist')
    } finally {
      second.close()
    }
  })

  it('asDomainKvTable:get/put/delete/entries/keys/size 与主存储一致', async () => {
    const store = ChannelBindingStore.open(':memory:')
    try {
      store.bind('feishu', 'fs-kv', 'sess-kv')
      const kv = store.asDomainKvTable()
      const key = bindingKey('feishu', 'fs-kv')
      expect(kv.size).toBe(1)
      expect(kv.get(key)?.sessionId).toBe('sess-kv')
      expect([...kv.keys()]).toEqual([key])
      expect([...kv.entries()]).toHaveLength(1)

      const record = kv.get(key)
      expect(record).toBeDefined()
      if (record !== undefined) {
        void kv.put(key, { ...record, sessionId: 'sess-moved' })
        expect(store.resolveSession('feishu', 'fs-kv')).toBe('sess-moved')
      }

      await expect(kv.delete(key)).resolves.toBe(true)
      expect(kv.get(key)).toBeUndefined()
      expect(store.resolveSession('feishu', 'fs-kv')).toBeUndefined()
    } finally {
      store.close()
    }
  })
})

describe('ChannelBindingStore:binding 增补 → thread/ticket(39 号 E1,24 §5.2 Source 行)', () => {
  it('① 多渠道身份 bindThread 同一 thread_key → threadBindings 收敛两行(27 §3.3 情况 A)', () => {
    const store = ChannelBindingStore.open(':memory:')
    try {
      expect(store.bindThread('feishu', 'fs-u1', 'web:conv-9').created).toBe(true)
      expect(store.bindThread('webhook', 'hook-u2', 'web:conv-9').created).toBe(true)

      const converged = store.threadBindings('web:conv-9')
      expect(converged).toHaveLength(2)
      expect(new Set(converged.map(record => record.channelType))).toEqual(new Set(['feishu', 'webhook']))
      expect(converged.every(record => record.threadKey === 'web:conv-9')).toBe(true)
      // thread-only 绑定:无 session 目标,不污染 session 维度
      expect(store.resolveSession('feishu', 'fs-u1')).toBeUndefined()
      expect(store.sessionBindings('sess-web-1')).toHaveLength(0)
    } finally {
      store.close()
    }
  })

  it('② 同身份 re-bind 新 thread:移绑续接返回 previousThreadKey;再绑同 thread 不产生 previous', () => {
    const store = ChannelBindingStore.open(':memory:')
    try {
      store.bindThread('feishu', 'fs-u1', 'web:conv-9')
      const outcome = store.bindThread('feishu', 'fs-u1', 'web:conv-42')
      expect(outcome.created).toBe(false)
      expect(outcome.previousThreadKey).toBe('web:conv-9')
      expect(store.resolveThread('feishu', 'fs-u1')?.threadKey).toBe('web:conv-42')
      expect(store.threadBindings('web:conv-9')).toHaveLength(0)

      const again = store.bindThread('feishu', 'fs-u1', 'web:conv-42')
      expect(again.created).toBe(false)
      expect('previousThreadKey' in again).toBe(false)
    } finally {
      store.close()
    }
  })

  it('③ session 维度与 thread 维度正交:bind 不动 thread、bindThread 不动 session', () => {
    const store = ChannelBindingStore.open(':memory:')
    try {
      store.bind('feishu', 'fs-both', 'sess-1')
      store.bindThread('feishu', 'fs-both', 'web:conv-7')
      const target = store.resolveThread('feishu', 'fs-both')
      expect(target).toEqual({ sessionId: 'sess-1', threadKey: 'web:conv-7' })

      // re-bind session(thread 保持);re-bind thread(session 保持)
      store.bind('feishu', 'fs-both', 'sess-2')
      expect(store.resolveThread('feishu', 'fs-both')).toEqual({ sessionId: 'sess-2', threadKey: 'web:conv-7' })
      store.bindThread('feishu', 'fs-both', 'web:conv-8')
      expect(store.resolveThread('feishu', 'fs-both')).toEqual({ sessionId: 'sess-2', threadKey: 'web:conv-8' })
    } finally {
      store.close()
    }
  })

  it('resolveThread 无绑定为 undefined;bindThread 空参数拒绝', () => {
    const store = ChannelBindingStore.open(':memory:')
    try {
      expect(store.resolveThread('feishu', 'nobody')).toBeUndefined()
      expect(() => store.bindThread('feishu', 'u', '')).toThrow(/不能为空/)
    } finally {
      store.close()
    }
  })

  it('旧库补列:ALTER 带存在性检查,既有 session 行为与新列共存', () => {
    const legacy = new DatabaseSync(':memory:')
    legacy.exec(`
      CREATE TABLE IF NOT EXISTS channel_bindings (
        channel_type TEXT NOT NULL,
        channel_user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        bound_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (channel_type, channel_user_id)
      );
    `)
    legacy.prepare('INSERT INTO channel_bindings (channel_type, channel_user_id, session_id, bound_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('feishu', 'fs-legacy', 'sess-legacy', '2026-11-17T00:00:00Z', '2026-11-17T00:00:00Z')
    const store = new ChannelBindingStore(legacy)
    try {
      // 既有 session 行为不回归
      expect(store.resolveSession('feishu', 'fs-legacy')).toBe('sess-legacy')
      // 新列已补:thread 维度可用
      store.bindThread('feishu', 'fs-legacy', 'web:conv-1')
      expect(store.resolveThread('feishu', 'fs-legacy')).toEqual({ sessionId: 'sess-legacy', threadKey: 'web:conv-1' })
    } finally {
      store.close()
    }
  })

  it('asDomainKvTable 扩展:thread/ticket 维度经 put 覆写,空串拒绝', async () => {
    const store = ChannelBindingStore.open(':memory:')
    try {
      store.bindThread('feishu', 'fs-kv2', 'web:conv-5')
      const kv = store.asDomainKvTable()
      const key = bindingKey('feishu', 'fs-kv2')
      const record = kv.get(key)
      const anyIso = expect.any(String) as unknown as string
      expect(record).toEqual({ channelType: 'feishu', channelUserId: 'fs-kv2', threadKey: 'web:conv-5', boundAt: anyIso, updatedAt: anyIso })
      if (record !== undefined) {
        await kv.put(key, { ...record, ticketId: 't-100' })
        expect(store.resolveThread('feishu', 'fs-kv2')).toEqual({ threadKey: 'web:conv-5', ticketId: 't-100' })
        expect(() => {
          void kv.put(key, { ...record, threadKey: '' })
        }).toThrow(/threadKey 不能为空/)
      }
    } finally {
      store.close()
    }
  })
})
