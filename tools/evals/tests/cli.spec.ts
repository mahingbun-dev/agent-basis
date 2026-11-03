/**
 * CLI 测试:cliMain 进程内跑 + bin/dsh-evals.mjs 真子进程跑(Node 原生 type-stripping)。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { cliMain } from '../src/index.ts'

const PACK = new URL('./fixtures/pack-mini/', import.meta.url).pathname
const BIN = new URL('../bin/dsh-evals.mjs', import.meta.url).pathname
const exec = promisify(execFile)

let outRoot = ''

beforeAll(async () => {
  outRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-evals-cli-'))
})

afterAll(async () => {
  await fs.rm(outRoot, { recursive: true, force: true })
})

describe('cliMain(进程内)', () => {
  it('run --pack --subset smoke --out → exit 0,产物存在', async () => {
    const outDir = path.join(outRoot, 'smoke')
    const code = await cliMain(['run', '--pack', PACK, '--subset', 'smoke', '--out', outDir])
    expect(code).toBe(0)
    expect(existsSync(path.join(outDir, 'report.md'))).toBe(true)
    expect(existsSync(path.join(outDir, 'sessions.jsonl'))).toBe(true)
  })

  it('全量(含负样本)→ exit 1', async () => {
    const outDir = path.join(outRoot, 'all')
    const code = await cliMain(['run', '--pack', PACK, '--out', outDir])
    expect(code).toBe(1)
  })

  it('缺 --pack → exit 2;非法 adapter → exit 2;未知命令 → exit 2', async () => {
    expect(await cliMain(['run'])).toBe(2)
    expect(await cliMain(['run', '--pack', PACK, '--adapter', 'browser'])).toBe(2)
    expect(await cliMain(['dance'])).toBe(2)
    expect(await cliMain([])).toBe(2)
  })

  it('--subset 无匹配 → exit 2', async () => {
    const code = await cliMain(['run', '--pack', PACK, '--subset', 'no-such-tag', '--out', path.join(outRoot, 'none')])
    expect(code).toBe(2)
  })

  it('--case 单跑审批红线 → exit 0', async () => {
    const code = await cliMain(['run', '--pack', PACK, '--case', 'approval-redline', '--out', path.join(outRoot, 'case')])
    expect(code).toBe(0)
  })
})

describe('bin/dsh-evals.mjs(真子进程,Node type-stripping)', () => {
  it('run --pack --subset smoke → exit 0 且打印 report 路径', async () => {
    const outDir = path.join(outRoot, 'bin-smoke')
    const { stdout } = await exec(process.execPath, [BIN, 'run', '--pack', PACK, '--subset', 'smoke', '--out', outDir])
    expect(stdout).toContain('total=4 pass=4 fail=0')
    expect(stdout).toContain('[PASS] approval-redline')
    expect(stdout).toContain(`report: ${path.join(outDir, 'report.md')}`)
    expect(existsSync(path.join(outDir, 'sessions.jsonl'))).toBe(true)
  }, 60_000)

  it('负样本在场 → exit 1,FAIL 行带失败分类首条', async () => {
    const outDir = path.join(outRoot, 'bin-all')
    // execFile 对非零退出码 reject(error.stdout 携带输出)——这正是被测行为
    const stdout = await exec(process.execPath, [BIN, 'run', '--pack', PACK, '--out', outDir])
      .then(ok => ok.stdout)
      .catch((error: unknown) => {
        const out = (error as { stdout?: string }).stdout
        expect(out).toBeDefined()
        return out ?? ''
      })
    expect(stdout).toContain('total=6 pass=5 fail=1')
    expect(stdout).toContain('[FAIL] answer-budget-fail')
    expect(stdout).toContain('[SCHEMA-FAIL]')
  }, 60_000)
})
