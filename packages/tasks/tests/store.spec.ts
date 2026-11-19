/**
 * Store 持久化面(35 号 A11 验收门禁;34 号 §4-C store 行)。
 *
 * 语义自 SA tests/store.spec.ts 移植并按本仓改造面适配:
 * - 表/生成列/索引建全、嵌套 atomic 回滚、afterCommit 时序、settings 版本史(SA 原有面);
 * - ★库路径必须派生自 workspaces/<账号>/(tenant-scan 级断言,34 §4-C);
 * - ★realm 首参路由的存储半边:构造签名带 realm、非法 realm 名 fail-closed(34 §2.3);
 * - receipts 回执原语(幂等 add/settle/withdraw/behind)与 reads 只读视图的直测面
 *   (完整投递行为见 outbox.spec.ts)。
 * settings 载荷为 unknown 存取(schema 校验属 policy 面 A4/A10,store.ts 文件头);
 * 版本史机制(修订指针/分块修订/最新在前)是本 spec 的被测面。
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { KV, MemoryRepositories, SCHEMA_VERSION, Store } from '../src/index.ts'
import { SettingsSchema } from '../src/policy/settings.ts'
import type { Assignment, Decision, Repositories, Thread, Ticket } from '../src/index.ts'

const REALM = 'alice'
let directory: string
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'tasks-store-')) })
afterEach(() => { rmSync(directory, { recursive: true, force: true }) })
const open = (): Store => new Store(REALM, { tenantRoot: directory })

it('拒绝新于本版本的库;失败的事务整体回滚', () => {
  const store = open()
  expect(() => store.atomic(() => { store.set(KV.store.schema, 1); throw new Error('boom') })).toThrow('boom')
  expect(store.get(KV.store.schema)).toBe(SCHEMA_VERSION)
  store.set(KV.store.schema, SCHEMA_VERSION + 1); store.close()
  expect(() => open()).toThrow('不支持的 tasks 数据库版本')
})

it('★库路径派生自租户工作区 workspaces/<账号>/.eterna/(tenant-scan 级断言)', () => {
  const store = open()
  expect(store.path).toBe(join(directory, REALM, '.eterna', 'tasks.sqlite3'))
  expect(store.realm).toBe(REALM)
  store.close()
  // 缺省派生链:$ETERNA_TENANT_ROOT → $DSH_HOME/workspaces(access TenantDeps 惯例)。
  vi.stubEnv('ETERNA_TENANT_ROOT', join(directory, 'eterena-root'))
  try {
    const envStore = new Store('bob')
    expect(envStore.path).toBe(join(directory, 'eterena-root', 'bob', '.eterna', 'tasks.sqlite3'))
    envStore.close()
  } finally { vi.unstubAllEnvs() }
  vi.stubEnv('DSH_HOME', join(directory, 'dsh-home'))
  try {
    const homeStore = new Store('carol')
    expect(homeStore.path).toBe(join(directory, 'dsh-home', 'workspaces', 'carol', '.eterna', 'tasks.sqlite3'))
    homeStore.close()
  } finally { vi.unstubAllEnvs() }
})

it('★非法 realm 名 fail-closed 拒开(路径逃逸防护)', () => {
  for (const realm of ['', '.', '..', '../escape', 'a/b', 'a\\b']) {
    expect(() => new Store(realm, { tenantRoot: directory })).toThrow('非法租户 realm')
  }
})

it('按线程找 trigger;重存 trigger 替换其线程索引', () => {
  const store = open()
  const base = { source: 'chat', actor: { source: 'chat', id: 'u' }, human: true, meta: {} }
  store.triggers.save({ ...base, id: 'a', threads: [{ source: 'chat', id: 't_%_x' }], at: '2', text: 'later' })
  store.triggers.save({ ...base, id: 'b', threads: [{ source: 'chat', id: 't_%_x' }, { source: 'git', id: '3' }], at: '1', text: 'earlier' })
  store.triggers.save({ ...base, id: 'c', threads: [{ source: 'chat', id: 't_y_x' }], at: '3', text: 'other' })
  expect(store.read.threadTriggers('chat:t_%_x').map(trigger => trigger.id)).toEqual(['b', 'a'])
  expect(store.read.threadTriggers('git:3').map(trigger => trigger.id)).toEqual(['b'])
  store.triggers.save({ ...store.triggers.get('b')!, threads: [{ source: 'git', id: '3' }] })
  expect(store.read.threadTriggers('chat:t_%_x').map(trigger => trigger.id)).toEqual(['a'])
  expect(store.read.threadTriggers('git:3').map(trigger => trigger.id)).toEqual(['b'])
  expect(store.read.subscribedThreads()).toEqual([])
  store.close()
})

const ticket = (id: string, state: 'open' | 'ended', assignments: Pick<Assignment, 'state'>[], undelivered: string[] = []): Ticket => ({
  id, title: id, decisionId: '', realm: REALM,
  mandate: { strength: 'explicit', policyVersion: '', basis: { via: 'listed' }, actor: { source: 'x', id: '' }, scope: '', realm: REALM },
  channels: [], assignments: assignments.map((item, index) => ({ id: `${id}-${index}`, createdAt: '', ...item })), inputs: [],
  ...state === 'ended' ? { ended: { at: '', by: 'executor' as const, reason: 'closed', outcome: 'closed' as const } } : {},
  undelivered, createdAt: '', updatedAt: '', origin: { triggerId: '', triggerIds: [] } })
const thread = (id: string, source: string, fields: Partial<Thread> = {}): Thread =>
  ({ key: `${source}:${id}`, ref: { source, id }, createdAt: '', subscriptions: [], correlated: [], pending: [], meta: {}, ...fields })
const ids = (items: Array<{ id?: string; key?: string }>) => items.map(item => item.id ?? item.key).sort()

it('工作集只读活跃行:SQLite 与内存一致,且随每次保存跟进', () => {
  const store = open()
  for (const repo of [store, new MemoryRepositories()] as Repositories[]) {
    repo.tickets.save(ticket('running', 'open', [{ state: 'running' }]))
    // 重试或恢复会在已结束的 Assignment 之后补一个 pending Assignment。
    repo.tickets.save(ticket('queued', 'open', [{ state: 'ended' }, { state: 'pending' }]))
    // 已结束、却有人的消息未投递的工单(等下一次 pass 唤醒)。
    repo.tickets.save(ticket('waking', 'ended', [{ state: 'ended' }], ['input']))
    repo.tickets.save(ticket('done', 'ended', [{ state: 'ended' }]))
    repo.threads.save(thread('1', 'git', { pending: ['a'] }))
    repo.threads.save(thread('2', 'git', { subscriptions: ['running'], evaluating: { id: 'e', threadKey: 'git:2', triggerIds: ['b'], strength: 'explicit',
      actor: { source: 'git', id: 'alice' }, basis: { via: 'followup' }, policyVersion: '', startedAt: '', deadline: '' } }))
    repo.threads.save(thread('oc:om', 'chat', { subscriptions: ['done'] }))
    repo.threads.save(thread('3', 'git'))
    expect(ids(repo.tickets.open())).toEqual(['queued', 'running'])
    expect(ids(repo.tickets.active())).toEqual(['queued', 'running', 'waking'])
    expect(ids(repo.threads.active())).toEqual(['git:1', 'git:2'])
    repo.tickets.save(ticket('running', 'ended', [{ state: 'ended' }]))
    repo.threads.save(thread('1', 'git'))
    expect(ids(repo.tickets.open())).toEqual(['queued'])
    expect(ids(repo.tickets.active())).toEqual(['queued', 'waking'])
    expect(ids(repo.threads.active())).toEqual(['git:2'])
  }
  expect(ids(store.read.subscribedThreads())).toEqual(['chat:oc:om', 'git:2'])
  expect(ids(store.read.subscribedThreads('git'))).toEqual(['git:2'])
  store.close()
})

it('给早于工作集列的库补列,并从存量 JSON 行回填', () => {
  const path = join(directory, REALM, '.eterna', 'tasks.sqlite3')
  mkdirSync(dirname(path), { recursive: true })
  const raw = new DatabaseSync(path)
  raw.exec(`CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE ticket (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE thread (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
  raw.prepare('INSERT INTO kv VALUES (?,?)').run('schema', String(SCHEMA_VERSION))
  raw.prepare('INSERT INTO ticket VALUES (?,?)').run('t', JSON.stringify(ticket('t', 'open', [{ state: 'running' }])))
  raw.prepare('INSERT INTO ticket VALUES (?,?)').run('e', JSON.stringify(ticket('e', 'ended', [{ state: 'ended' }])))
  raw.prepare('INSERT INTO thread VALUES (?,?)').run('git:1', JSON.stringify(thread('1', 'git', { pending: ['a'], subscriptions: ['t'] })))
  raw.close()
  const store = new Store(REALM, { tenantRoot: directory })
  expect(ids(store.tickets.open())).toEqual(['t'])
  expect(ids(store.tickets.active())).toEqual(['t'])
  expect([ids(store.threads.active()), ids(store.read.subscribedThreads('git'))]).toEqual([['git:1'], ['git:1']])
  store.close()
})

it('替换早前版本另作定义的生成列,并删掉本版本不再有的列', () => {
  const path = join(directory, REALM, '.eterna', 'tasks.sqlite3')
  mkdirSync(dirname(path), { recursive: true })
  const raw = new DatabaseSync(path)
  raw.exec(`CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE ticket (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    ALTER TABLE ticket ADD COLUMN open INTEGER AS (CASE WHEN value ->> '$.state' = 'open' THEN 1 END);
    ALTER TABLE ticket ADD COLUMN ref TEXT AS (nullif(value ->> '$.assignments[#-1].ref', ''));
    CREATE INDEX ticket_open ON ticket(open) WHERE open IS NOT NULL; CREATE INDEX ticket_ref ON ticket(ref) WHERE ref IS NOT NULL`)
  raw.prepare('INSERT INTO kv VALUES (?,?)').run('schema', String(SCHEMA_VERSION))
  raw.prepare('INSERT INTO ticket (id, value) VALUES (?,?)').run('t', JSON.stringify(ticket('t', 'open', [{ state: 'running' }])))
  raw.close()
  const store = new Store(REALM, { tenantRoot: directory })
  // open 集现在按工单的 ended 判。
  expect(ids(store.tickets.open())).toEqual(['t'])
  expect(store.db.prepare("SELECT name FROM pragma_table_xinfo('ticket') WHERE name = 'ref'").all()).toEqual([])
  store.close()
})

it('以第一条人的消息为线程命名(firstTrigger)', () => {
  const store = open()
  const base = { source: 'git', threads: [{ source: 'git', id: '5' }], actor: { source: 'git', id: 'x' }, meta: {} }
  store.triggers.save({ ...base, id: 'ci', human: false, at: '1', text: 'git PR #5 CI: {}' })
  store.triggers.save({ ...base, id: 'person', human: true, at: '2', text: 'please look' })
  expect(store.read.firstTrigger('git:5')?.id).toBe('ci')
  expect(store.read.firstTrigger('git:5', true)?.id).toBe('person')
  store.close()
})

it('按 Source 统计 trigger、最新在前列表、可只列被过滤的', () => {
  const store = open()
  const trigger = (id: string, source: string, at: string) => ({ id, source, threads: [{ source, id: 'x' }], actor: { source, id: 'a' }, human: true, at, text: id, meta: {} })
  store.triggers.save(trigger('old', 'chat', '2026-09-01T00:00:00Z'))
  store.triggers.save(trigger('kept', 'chat', '2026-09-23T00:00:00Z'))
  store.triggers.save(trigger('dropped', 'chat', '2026-09-23T01:00:00Z'))
  store.triggers.saveDisposition('dropped', { filtered: { code: 'chat_not_allowed' }, fanout: [], at: '' })
  store.triggers.save(trigger('gh', 'git', '2026-09-22T00:00:00Z'))
  expect(store.read.triggerStats('2026-09-22T12:00:00Z')).toEqual({ chat: { received: 2, filtered: 1, lastAt: '2026-09-23T01:00:00Z' }, git: { received: 0, filtered: 0, lastAt: '2026-09-22T00:00:00Z' } })
  expect(store.read.triggers({ source: 'chat' }, 0, 2)).toEqual({ items: [expect.objectContaining({ id: 'dropped' }), expect.objectContaining({ id: 'kept' })], more: true })
  expect(store.read.triggers({ filtered: true }).items.map(item => item.id)).toEqual(['dropped'])
  store.close()
})

it('读写线程 meta 的 Source 专属键', () => {
  const store = open()
  store.threads.save({ key: 'git:5', ref: { source: 'git', id: '5' }, createdAt: '', subscriptions: [], correlated: [], pending: [], meta: { isPr: true, gone: true } })
  store.threads.patchMeta('git:5', { gone: undefined, title: 'Fix' })
  expect(store.threads.get('git:5')!.meta).toEqual({ isPr: true, title: 'Fix' })
  store.threads.patchMeta('git:6', { title: 'none' })
  expect(store.threads.get('git:6')).toBeUndefined()
  store.threads.describe('git:5', { label: 'PR 5', facts: { size: { value: '+12 −3' }, gone: null } })
  expect(store.threads.get('git:5')!.meta).toMatchObject({ label: 'PR 5', facts: { size: { value: '+12 −3' } } })
  store.close()
})

it('每个 kv 键只在 KV 表里拼写一次:各记录由其条目点名', () => {
  const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
  const entries = Object.values(KV).flatMap(group => Object.values(group) as Array<string | { prefix: string }>)
  const keys = entries.map(entry => typeof entry === 'string' ? entry : entry.prefix).filter(name => /[-:]/.test(name))
  const modules = readdirSync(src, { recursive: true, encoding: 'utf8' })
    .filter(path => /\.ts$/.test(path) && path !== join('store', 'kv.ts'))
  const spelled = modules.flatMap((path) => {
    const text = readFileSync(join(src, path), 'utf8')
    return keys.filter(name => text.includes(`'${name}`) || text.includes(`\`${name}`)).map(name => `${path}: ${name}`)
  })
  expect(spelled).toEqual([])
})

it('afterCommit:最外层提交后才跑;回滚层的回调永不跑', () => {
  const store = open()
  const ran: string[] = []
  store.atomic(() => {
    store.afterCommit(() => { ran.push('outer') })
    store.atomic(() => { store.afterCommit(() => { ran.push('inner') }) })
    expect(() => store.atomic(() => { store.afterCommit(() => { ran.push('rolled back') }); throw new Error('boom') })).toThrow('boom')
    // 最外层提交前什么都不跑。
    expect(ran).toEqual([])
  })
  expect(ran).toEqual(['outer', 'inner'])
  expect(() => store.atomic(() => { store.afterCommit(() => { ran.push('failed') }); throw new Error('boom') })).toThrow('boom')
  store.afterCommit(() => { ran.push('outside') })
  expect(ran).toEqual(['outer', 'inner', 'outside'])
  store.close()
})

it('提交后失败的回调被上报,其余照跑,已提交的保留', () => {
  const reported: unknown[] = []
  const store = new Store(REALM, { tenantRoot: directory, report: (error) => { reported.push(error) } })
  const ran: string[] = []
  const value = store.atomic(() => {
    store.set(KV.store.schema, SCHEMA_VERSION)
    store.afterCommit(() => { throw new Error('cancel failed') })
    store.afterCommit(() => { ran.push('next') })
    return 'done'
  })
  expect(value).toBe('done')
  expect(ran).toEqual(['next'])
  expect(reported).toEqual([new Error('cancel failed')])
  expect(store.get(KV.store.schema)).toBe(SCHEMA_VERSION)
  store.close()
})

it('打不开的库关句柄,使同进程稍后可重试', () => {
  const store = open()
  store.set(KV.store.schema, SCHEMA_VERSION + 1)
  store.close()
  const close = vi.spyOn(DatabaseSync.prototype, 'close')
  try {
    expect(() => open()).toThrow('不支持的 tasks 数据库版本')
    expect(close).toHaveBeenCalledOnce()
  } finally { close.mockRestore() }
})

it('settings 以版本史保存:当前 settings 即当前修订的快照,不另存', () => {
  const store = open()
  expect(store.settings()).toEqual(SettingsSchema.parse({}))
  store.saveSettings({ ...store.settings(), paused: true }, { source: 'panel', block: 'pause', policyVersion: 'v', policyChanged: false, notified: [] })
  store.saveSettings({ ...store.settings(), executor: { ...store.settings().executor, maxWorkers: 5 } })
  expect(store.settings()).toMatchObject({ paused: true, executor: { maxWorkers: 5 } })
  expect(store.settingsHistory().map(version => [version.revision, version.source])).toEqual([[2, 'internal'], [1, 'panel']])
  expect([store.get(KV.settings.revision), store.blockRevision('pause'), store.keys('settings').filter(name => name === 'settings')]).toEqual([2, 1, []])
  // 分块保存乐观并发:另一块有各自的修订计数。
  store.saveSettings({ ...store.settings(), policy: { rules: [] } }, { source: 'tool', block: 'policy', policyVersion: 'v2', policyChanged: true, notified: ['T-1'] })
  expect([store.blockRevision('policy'), store.blockRevision('pause')]).toEqual([1, 1])
  expect(store.settingsHistory()[0]).toMatchObject({ revision: 3, source: 'tool', policyChanged: true, notified: ['T-1'] })
  store.close()
})

it('SQLite 与内存同序同集;失败的内层事务只回滚自己', () => {
  const store = open()
  const order = (items: Array<{ id?: string; key?: string }>) => items.map(item => item.id ?? item.key)
  const decision = (id: string): Decision => ({ id, evalId: '', threadKey: 'git:1', triggerIds: [], policyVersion: '', at: id, kind: 'ignore', reason: [],
    strength: 'explicit' })
  const run = (repo: Repositories) => {
    repo.tickets.save(ticket('first', 'open', [{ state: 'running' }]))
    repo.tickets.save(ticket('second', 'ended', [{ state: 'ended' }]))
    repo.tickets.save(ticket('third', 'open', [{ state: 'pending' }]))
    // 重存工单保位。
    repo.tickets.save({ ...repo.tickets.get('first')!, title: 'again' })
    repo.threads.save(thread('1', 'git', { pending: ['a'] })); repo.threads.save(thread('2', 'git')); repo.threads.save(thread('3', 'git', { pending: ['b'] }))
    repo.decisions.save(decision('d2'))
    repo.decisions.save(decision('d1'))
    repo.atomic(() => {
      repo.tickets.save(ticket('outer', 'open', []))
      expect(() => repo.atomic(() => { repo.tickets.save(ticket('inner', 'open', [])); throw new Error('boom') })).toThrow('boom')
    })
    return {
      tickets: order(repo.tickets.list()), open: order(repo.tickets.open()), active: order(repo.tickets.active()),
      threads: order(repo.threads.list()), activeThreads: order(repo.threads.active()), decisions: order(repo.decisions.byThread('git:1')),
    }
  }
  const memory = run(new MemoryRepositories())
  expect(memory).toEqual({ tickets: ['outer', 'third', 'second', 'first'], open: ['outer', 'third', 'first'], active: ['third', 'first'],
    threads: ['git:1', 'git:2', 'git:3'], activeThreads: ['git:1', 'git:3'], decisions: ['d2', 'd1'] })
  expect(run(store)).toEqual(memory)
  store.close()
})

it('只为属主建状态目录,库文件只属主可读', () => {
  const store = open()
  const path = store.path
  store.close()
  expect([statSync(dirname(path)).mode & 0o777, statSync(path).mode & 0o777]).toEqual([0o700, 0o600])
})

it('键前缀与搜索里的 `%` 与 `_` 按字面读,不作模式', () => {
  const store = open()
  for (const name of ['a%b', 'axb', 'a_c', 'abc']) store.set(name, 1)
  expect([store.keys('a%').sort(), store.keys('a_').sort()]).toEqual([['a%b'], ['a_c']])
  const said = (id: string, text: string) => ({ id, source: 'chat', threads: [{ source: 'chat', id: 'oc:1' }], actor: { source: 'chat', id: 'u' },
    human: true, at: '2026-10-01T00:00:00.000Z', text, meta: {} })
  for (const [id, text] of [['p', 'grew 50% today'], ['q', 'grew 500 today'], ['r', 'see a_b'], ['s', 'see axb']]) store.triggers.save(said(id!, text!))
  expect([store.read.search('50%').map(item => item.id), store.read.search('a_b').map(item => item.id)]).toEqual([['p'], ['r']])
  store.close()
})

it('回执原语:同 id 不二录、settle 三态、withdraw、behind 同工单同会话排队', () => {
  const store = open()
  const channel = { source: 'chat', thread: 't1', address: {} }
  expect(store.receipts.add({ id: 'm1', channel, text: 'a', kind: 'reply', ticketId: 'T1' })).toBe(true)
  expect(store.receipts.add({ id: 'm1', channel, text: 'changed', kind: 'reply', ticketId: 'T1' })).toBe(false)
  expect(store.receipts.get('m1')).toMatchObject({ status: 'pending', text: 'a' })
  expect(store.receipts.waiting().map(receipt => receipt.id)).toEqual(['m1'])
  store.receipts.add({ id: 'm2', channel, text: 'b', kind: 'reply', ticketId: 'T1' })
  // 同工单同会话:m2 压在 m1 之后(m1 无 effect 行 → attempts 0 < 阈值)。
  expect(store.receipts.behind('m2', 3)).toBe(true)
  // 不同会话不压;无 ticketId 的消息不参与排序复合键。
  store.receipts.add({ id: 'm3', channel: { source: 'chat', thread: 't2', address: {} }, text: 'c', kind: 'reply', ticketId: 'T1' })
  expect(store.receipts.behind('m3', 3)).toBe(false)
  store.receipts.settle(store.receipts.get('m1')!, 'sent')
  expect(store.receipts.get('m1')?.status).toBe('sent')
  expect(store.replyStatus('m1')).toBe('sent')
  store.receipts.settle(store.receipts.get('m2')!, 'channelGone')
  expect(store.receipts.get('m2')).toMatchObject({ status: 'dropped', dropped: { reason: 'channelGone' } })
  expect(store.read.droppedReplies().map(receipt => receipt.id)).toEqual(['m2'])
  expect(store.receipts.withdraw('m3')).toBe(true)
  expect(store.receipts.withdraw('m3')).toBe(false)
  expect(store.receipts.get('m3')).toBeUndefined()
  // 发送中被撤回的消息:settle 重建回执,防同 id 再次入队。
  store.receipts.settle({ id: 'm3', channel, text: 'c', kind: 'reply' }, 'sent')
  expect(store.receipts.get('m3')?.status).toBe('sent')
  store.close()
})
