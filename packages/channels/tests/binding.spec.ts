import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
