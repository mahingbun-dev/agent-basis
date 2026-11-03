import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { ReplayAdapter, WORKSPACE_RECORD_TYPE } from '../src/adapters/replay.ts'
import { parseGoldenCase } from '../src/schema.ts'
import type { GoldenCase } from '../src/types.ts'

const PACK = new URL('./fixtures/pack-mini/', import.meta.url).pathname
let workspaceRoot = ''

beforeAll(async () => {
  workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-evals-replay-'))
})

afterAll(async () => {
  await fs.rm(workspaceRoot, { recursive: true, force: true })
})

function caseOf(yaml: string): GoldenCase {
  return parseGoldenCase(yaml, 'memory://inline.yaml')
}

describe('ReplayAdapter', () => {
  it('回放 fixture:事件 + 终态文件物化 + 最终回答', async () => {
    const adapter = new ReplayAdapter()
    const caseData = { ...caseOf('id: smoke-file-plan\nuser_input: x\n'), sourceFile: `${PACK}evals/smoke-file-plan.yaml` }
    const workspace = path.join(workspaceRoot, 'c1')
    await fs.mkdir(workspace, { recursive: true })
    const result = await adapter.run({ caseData, packDir: PACK, workspaceDir: workspace })
    expect(result.sessionRef).toContain('fixtures/smoke-file-plan.jsonl')
    expect(result.events.length).toBe(10)
    expect(result.events[0]?.type).toBe('turn/start')
    expect(result.finalAnswerText).toContain('方案已生成')
    const plan = await fs.readFile(path.join(workspace, 'plan.md'), 'utf8')
    expect(plan).toContain('备用场地清单')
    expect((result.notes ?? [])[0]).toContain('物化终态文件 1 个')
  })

  it('fixture 缺失 → 抛错(harness 分类由 runner 负责)', async () => {
    const adapter = new ReplayAdapter()
    const caseData = caseOf('id: missing-fixture\nuser_input: x\n')
    await expect(adapter.run({ caseData, packDir: PACK, workspaceDir: path.join(workspaceRoot, 'c2') }))
      .rejects.toThrow(/fixture 不可读/)
  })

  it('fixture 非法 JSON 行 → 抛错带行号', async () => {
    const dir = path.join(workspaceRoot, 'pack-bad')
    await fs.mkdir(path.join(dir, 'evals'), { recursive: true })
    await fs.mkdir(path.join(dir, 'fixtures'), { recursive: true })
    await fs.writeFile(path.join(dir, 'evals', 'bad.jsonl.yaml'), 'id: bad-jsonl\nuser_input: x\n', 'utf8')
    await fs.writeFile(
      path.join(dir, 'fixtures', 'bad-jsonl.jsonl'),
      '{"type":"turn/start","seq":1,"time":1,"data":{"turn":1}}\nnot-json\n',
      'utf8',
    )
    const adapter = new ReplayAdapter()
    const caseData = caseOf('id: bad-jsonl\nuser_input: x\n')
    await expect(adapter.run({ caseData, packDir: dir, workspaceDir: path.join(workspaceRoot, 'c3') }))
      .rejects.toThrow(/:2: 不是合法 JSON/)
  })

  it('plugin 记录 data 非法(files 非映射)→ 抛错', async () => {
    const dir = path.join(workspaceRoot, 'pack-bad-plugin')
    await fs.mkdir(path.join(dir, 'evals'), { recursive: true })
    await fs.mkdir(path.join(dir, 'fixtures'), { recursive: true })
    await fs.writeFile(path.join(dir, 'evals', 'bad-plugin.yaml'), 'id: bad-plugin\nuser_input: x\n', 'utf8')
    await fs.writeFile(
      path.join(dir, 'fixtures', 'bad-plugin.jsonl'),
      `{"type":"turn/start","seq":1,"time":1,"data":{"turn":1}}\n{"type":"${WORKSPACE_RECORD_TYPE}","seq":2,"time":2,"data":{"files":[]}}\n`,
      'utf8',
    )
    const adapter = new ReplayAdapter()
    await expect(adapter.run({
      caseData: caseOf('id: bad-plugin\nuser_input: x\n'),
      packDir: dir,
      workspaceDir: path.join(workspaceRoot, 'c4'),
    })).rejects.toThrow(/缺少 files 映射/)
  })

  it('空 fixture(无事件)→ 抛错', async () => {
    const dir = path.join(workspaceRoot, 'pack-empty')
    await fs.mkdir(path.join(dir, 'evals'), { recursive: true })
    await fs.mkdir(path.join(dir, 'fixtures'), { recursive: true })
    await fs.writeFile(path.join(dir, 'evals', 'empty.yaml'), 'id: empty\nuser_input: x\n', 'utf8')
    await fs.writeFile(path.join(dir, 'fixtures', 'empty.jsonl'), '\n\n', 'utf8')
    await expect(new ReplayAdapter().run({
      caseData: caseOf('id: empty\nuser_input: x\n'),
      packDir: dir,
      workspaceDir: path.join(workspaceRoot, 'c5'),
    })).rejects.toThrow(/无会话事件/)
  })

  it('终态文件路径逃逸工作区 → 抛错', async () => {
    const dir = path.join(workspaceRoot, 'pack-escape')
    await fs.mkdir(path.join(dir, 'evals'), { recursive: true })
    await fs.mkdir(path.join(dir, 'fixtures'), { recursive: true })
    await fs.writeFile(path.join(dir, 'evals', 'escape.yaml'), 'id: escape\nuser_input: x\n', 'utf8')
    await fs.writeFile(
      path.join(dir, 'fixtures', 'escape.jsonl'),
      `{"type":"turn/start","seq":1,"time":1,"data":{"turn":1}}\n{"type":"${WORKSPACE_RECORD_TYPE}","seq":2,"time":2,"data":{"files":{"../evil.txt":"x"}}}\n`,
      'utf8',
    )
    await expect(new ReplayAdapter().run({
      caseData: caseOf('id: escape\nuser_input: x\n'),
      packDir: dir,
      workspaceDir: path.join(workspaceRoot, 'c6'),
    })).rejects.toThrow(/逃逸/)
  })
})
