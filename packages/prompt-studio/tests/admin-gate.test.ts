/**
 * 管理员门测试(2026-11-17):工坊=系统提示词全局管理面,仅管理员可见可操作。
 * - eterna-user principal(approver/user)调任意 loopPrompt/* 端点 → 结构化拒绝
 *   (gateway/bad-request,文案「提示词工坊仅管理员可用」),先于任何读/写/审计副作用;
 * - eterna-user principal(admin)与无 principal(owner/本地流)→ 放行判定为真,
 *   端点继续走各自业务面(本测只断言拒绝门不触发,业务面正确性由既有测试覆盖);
 * - access store 缺席时 eterna-user fail-closed 拒绝(角色不可判定≠放行)。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LoopPromptGateway } from '../src/index.ts'
import type { PromptExportPack, StudioContextLike } from '../src/types.ts'

/** 角色样本:eterna-user principal 的 userId → access store 角色(getUserById 面)。 */
const USERS: Readonly<Record<number, string | undefined>> = { 1: 'admin', 2: 'user', 3: 'approver' }

let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ps-admin-gate-'))
  // 端点前置(patch/审计/会话根)全部指进临时目录:门放行后的业务面不在本测范围。
  writeFileSync(join(dir, 'cordis.patch.yml'), '- id: preset-standard\n  config: {}\n')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** 构造带 invocation principal 与 eternaAccessStore 反射面的网关(测试注入口)。 */
function gatewayFor(principal: { kind: string; userId: number } | undefined, withStore = true): LoopPromptGateway {
  const ctx = new Context() as Context & {
    invocation?: { principal?: { kind: string; userId: number } }
    reflect?: { get(name: string, strict?: boolean): unknown }
  }
  ;(ctx as { invocation?: unknown }).invocation = principal === undefined ? {} : { principal }
  // 只包一层 reflect.get(cordis 基类构造器还要用 reflect.provide 等原方法,不可整体替换)。
  const reflect = ctx.reflect as unknown as { get(name: string, strict?: boolean): unknown }
  const originalGet = reflect.get.bind(reflect)
  reflect.get = (name: string, strict?: boolean) => (withStore && name === 'eternaAccessStore'
    ? { getUserById: (id: number) => (USERS[id] === undefined ? undefined : { role: USERS[id] }) }
    : originalGet(name, strict))
  return new LoopPromptGateway(ctx as unknown as StudioContextLike, {
    patchPath: join(dir, 'cordis.patch.yml'),
    sessionsRoot: dir,
    auditFilePath: join(dir, 'audit.jsonl'),
    repoRoot: dir,
  })
}

/** 13 个端点的直调面(名称仅测试报告可读;直调不经 SRC 绑定,门在方法体第一语句)。 */
const ENDPOINT_CALLS: ReadonlyArray<readonly [name: string, run: (gw: LoopPromptGateway) => unknown]> = [
  ['snapshot', gw => gw.snapshot()],
  ['trace', gw => gw.trace({})],
  ['prompt-get', gw => gw.promptGet({})],
  ['prompt-save', gw => gw.promptSave({ content: 'x', author: 't' })],
  ['prompt-versions', gw => gw.promptVersions({})],
  ['prompt-rollback', gw => gw.promptRollback({ versionId: 'v1', author: 't' })],
  ['prompt-export', gw => gw.promptExport({})],
  ['prompt-import', gw => gw.promptImport({ pack: {} as PromptExportPack, author: 't' })],
  ['session-snapshot', gw => gw.sessionSnapshot({})],
  ['ai-status', gw => gw.aiStatus()],
  ['ai-polish', gw => gw.aiPolish({})],
  ['ai-review', gw => gw.aiReview({})],
  ['ai-proposal', gw => gw.aiProposal({ entryId: '', content: 'x', baseVersionId: '', summary: '', author: 't' })],
]

/** 统一收尾:同步 throw 与 async reject 都折进 { error }(工坊两类端点形态并存)。 */
async function settle(run: (gw: LoopPromptGateway) => unknown, gw: LoopPromptGateway): Promise<{ error?: unknown }> {
  try {
    await run(gw)
    return {}
  } catch (error) {
    return { error }
  }
}

/** 门拒绝的结构化形状(结构标记跨 realm;消息含中文文案)。 */
function isGateDenial(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const shaped = error as { isDSHRemoteError?: unknown; code?: unknown; message?: unknown }
  return shaped.isDSHRemoteError === true
    && shaped.code === 'gateway/bad-request'
    && typeof shaped.message === 'string'
    && shaped.message.includes('提示词工坊仅管理员可用')
}

describe('loopPrompt/* 管理员门(eterna-user principal)', () => {
  it('普通用户与审批人调全部 13 端点 → 一律门拒绝(零业务副作用)', async () => {
    for (const userId of [2, 3]) {
      const gw = gatewayFor({ kind: 'eterna-user', userId })
      for (const [name, run] of ENDPOINT_CALLS) {
        const { error } = await settle(run, gw)
        expect(isGateDenial(error), `${name} as userId=${userId}`).toBe(true)
      }
    }
  })

  it('admin 账号与 owner(无 principal)全部端点不触发拒绝门(其余失败属业务面)', async () => {
    for (const principal of [{ kind: 'eterna-user', userId: 1 } as const, undefined]) {
      const gw = gatewayFor(principal)
      for (const [name, run] of ENDPOINT_CALLS) {
        const { error } = await settle(run, gw)
        expect(isGateDenial(error), `${name} as ${principal === undefined ? 'owner' : 'admin'}`).toBe(false)
      }
    }
  })

  it('access store 缺席时 eterna-user fail-closed 拒绝(角色不可判定≠放行)', async () => {
    const gw = gatewayFor({ kind: 'eterna-user', userId: 1 }, false)
    const { error } = await settle(gw => gw.snapshot(), gw)
    expect(isGateDenial(error)).toBe(true)
  })

  it('adminAllowed 判定矩阵(owner 放行/eterna-user 按角色/store 缺席拒)', () => {
    expect(gatewayFor(undefined).adminAllowed()).toBe(true)
    expect(gatewayFor({ kind: 'eterna-user', userId: 1 }).adminAllowed()).toBe(true)
    expect(gatewayFor({ kind: 'eterna-user', userId: 2 }).adminAllowed()).toBe(false)
    expect(gatewayFor({ kind: 'eterna-user', userId: 3 }).adminAllowed()).toBe(false)
    expect(gatewayFor({ kind: 'eterna-user', userId: 99 }).adminAllowed()).toBe(false)
    expect(gatewayFor({ kind: 'eterna-user', userId: 1 }, false).adminAllowed()).toBe(false)
  })
})
