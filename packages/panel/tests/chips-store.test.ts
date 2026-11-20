/**
 * 流程启动条配置落盘测试(2026-11-20):缺文件 fail-closed、roundtrip、CAS
 * conflict、损坏 JSON、入参校验、原子写无残留。root 用 mkdtemp 隔离,不触碰
 * 真实用户根(守卫路径解析本身由 access 侧 panel-isolation.spec 覆盖)。
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_CHIPS_CONFIG, chipsFilePath, readChipsConfig, saveChipsConfig } from '../src/chips-store.ts'

let root = ''
const created: string[] = []

function freshRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'eterna-panel-chips-'))
  created.push(dir)
  return dir
}

beforeAll(() => {
  root = freshRoot()
})

afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true })
})

const chipA = { id: 'c-a', title: '知识检索', kickoff: '启动「知识检索」流程:请先和我确认主题与关键词。', enabled: true }
const chipB = { id: 'c-b', title: '预算计算', kickoff: '启动「预算计算」流程:请先确认总额与比例口径。', note: '每日复盘用', enabled: false }

describe('readChipsConfig(fail-closed)', () => {
  it('缺文件 → 默认空配置(触发条隐藏,不抛错)', () => {
    expect(readChipsConfig(root)).toEqual(DEFAULT_CHIPS_CONFIG)
  })

  it('损坏 JSON → 默认空配置(fail-closed,绝不炸 composer)', () => {
    const dir = freshRoot()
    mkdirSync(dirname(chipsFilePath(dir)), { recursive: true })
    writeFileSync(chipsFilePath(dir), '{not json', 'utf8')
    expect(readChipsConfig(dir)).toEqual(DEFAULT_CHIPS_CONFIG)
  })

  it('结构不符(坏 revision/坏条目/重复 id)→ 默认空配置', () => {
    const dir = freshRoot()
    mkdirSync(dirname(chipsFilePath(dir)), { recursive: true })
    writeFileSync(chipsFilePath(dir), JSON.stringify({ revision: -1, visible: true, chips: [] }), 'utf8')
    expect(readChipsConfig(dir)).toEqual(DEFAULT_CHIPS_CONFIG)
    writeFileSync(chipsFilePath(dir), JSON.stringify({ revision: 1, visible: true, chips: [{ id: 'c-x', title: '', kickoff: 'k', enabled: true }] }), 'utf8')
    expect(readChipsConfig(dir)).toEqual(DEFAULT_CHIPS_CONFIG)
    writeFileSync(chipsFilePath(dir), JSON.stringify({ revision: 1, visible: true, chips: [chipA, chipA] }), 'utf8')
    expect(readChipsConfig(dir)).toEqual(DEFAULT_CHIPS_CONFIG)
  })
})

describe('saveChipsConfig(CAS + 原子写)', () => {
  beforeEach(() => {
    root = freshRoot()
  })

  it('roundtrip:首存 revision 0 → 落盘 revision 1,读回一致;目录自动创建', () => {
    const outcome = saveChipsConfig(root, { revision: 0, visible: true, chips: [chipA, chipB] })
    expect(outcome).toMatchObject({ ok: true, config: { revision: 1, visible: true } })
    if (!outcome.ok) return
    expect(outcome.config.chips).toEqual([chipA, chipB])
    expect(readChipsConfig(root)).toEqual(outcome.config)
    // trim + note 保留:文件是可读 JSON(.eterna/panel/chips.json)
    const onDisk = JSON.parse(readFileSync(chipsFilePath(root), 'utf8')) as { revision: number; chips: unknown[] }
    expect(onDisk.revision).toBe(1)
    expect(onDisk.chips).toHaveLength(2)
  })

  it('CAS:旧 revision 再存 → conflict 附当前落盘配置,内容不被覆盖', () => {
    expect(saveChipsConfig(root, { revision: 0, visible: true, chips: [chipA] }).ok).toBe(true)
    const stale = saveChipsConfig(root, { revision: 0, visible: false, chips: [chipB] })
    expect(stale).toMatchObject({ ok: false, code: 'conflict' })
    if (stale.ok) return
    expect(stale.config).toEqual({ revision: 1, visible: true, chips: [chipA] })
    expect(readChipsConfig(root).chips).toEqual([chipA])
    // 以最新 revision 重存(last-writer-wins)→ 成功
    expect(saveChipsConfig(root, { revision: 1, visible: false, chips: [chipB] })).toMatchObject({
      ok: true, config: { revision: 2, visible: false },
    })
  })

  it('入参校验:非对象/坏 revision/坏条目/重复 id/超条目数 → invalid 且不落盘', () => {
    expect(saveChipsConfig(root, null)).toMatchObject({ code: 'invalid' })
    expect(saveChipsConfig(root, { revision: 1.5, visible: true, chips: [] })).toMatchObject({ code: 'invalid' })
    expect(saveChipsConfig(root, { revision: 0, visible: 'yes', chips: [] })).toMatchObject({ code: 'invalid' })
    expect(saveChipsConfig(root, { revision: 0, visible: true, chips: [{ ...chipA, title: '  ' }] })).toMatchObject({ code: 'invalid' })
    expect(saveChipsConfig(root, { revision: 0, visible: true, chips: [chipA, chipA] })).toMatchObject({ code: 'invalid' })
    const many = Array.from({ length: 13 }, (_, i) => ({ ...chipA, id: `c-${i}` }))
    expect(saveChipsConfig(root, { revision: 0, visible: true, chips: many })).toMatchObject({ code: 'invalid' })
    expect(readChipsConfig(root)).toEqual(DEFAULT_CHIPS_CONFIG)
  })

  it('原子写:保存后目录无 *.tmp 残留', () => {
    saveChipsConfig(root, { revision: 0, visible: true, chips: [chipA] })
    const dir = join(root, '.eterna', 'panel')
    expect(existsSync(dir)).toBe(true)
    const leftovers = readdirSync(dir).filter(name => name.endsWith('.tmp'))
    expect(leftovers).toEqual([])
  })
})
