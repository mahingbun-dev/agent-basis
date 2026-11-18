/**
 * D1 subagent_policies(35 号 A18 验收门禁;33 号 §1.3 G2-A16 全条;24a 拍板记录·D1;
 * 27 号 §2.1-1「subagent 永不越过 Mandate」;26 §4.1 worker 段 / §7-1 schema 待拍板):
 * - 声明段含 `subagent_policies`:消费面 types seam + 默认只读 reviewer 类——
 *   引用 packages/extra reviewer preset 平台资产(preset id 与只读词汇表单一真值在 extra);
 * - worker 派 subagent 受约束:借权不越 Mandate——派生请求被钳进声明策略
 *   (未声明的由策略补齐,越权的 fail-closed 拒绝,再派生一律禁止);
 * - 声明段校验 fail-closed(装配期拒收);schema 格式不在本包预设(G2-A18 占位)。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildReviewerPreset, DEFAULT_REVIEWER_ALLOW, READ_ONLY_TOOL_VOCABULARY } from '@eterna/extra'
import { createTasks } from '../src/plugin.ts'
import {
  DEFAULT_SUBAGENT_POLICIES, REVIEWER_PRESET_ID, SubagentPolicyViolation, constrainForWorker,
  resolveSubagentPolicy, validateSubagentPolicies,
} from '../src/executor/subagent-policies.ts'

describe('声明段 subagent_policies:默认只读 reviewer 类(D1;G2-A16)', () => {
  it('默认策略引用 extra reviewer preset 平台资产(preset id 单一真值取自 extra)', () => {
    expect(REVIEWER_PRESET_ID).toBe(buildReviewerPreset().preset.id)
    expect(DEFAULT_SUBAGENT_POLICIES.default).toEqual({
      preset: REVIEWER_PRESET_ID, allow: [...DEFAULT_REVIEWER_ALLOW], nested: false,
    })
  })

  it('默认 allow 是只读词汇表子集(read/grep/glob;无变更型/出网型工具)', () => {
    for (const tool of DEFAULT_SUBAGENT_POLICIES.default.allow) {
      expect(READ_ONLY_TOOL_VOCABULARY).toContain(tool)
    }
    expect(DEFAULT_SUBAGENT_POLICIES.default.nested).toBe(false)
  })
})

describe('validateSubagentPolicies:fail-closed 校验(装配期拒收违规声明)', () => {
  it('合法声明零错误;默认声明合法', () => {
    expect(validateSubagentPolicies(DEFAULT_SUBAGENT_POLICIES)).toEqual([])
    expect(validateSubagentPolicies({ default: { preset: 'eterna-reviewer', allow: ['read'] } })).toEqual([])
  })

  it('违规逐条报:词汇表外/变更型工具、空名单、preset 形态、嵌套非 false', () => {
    // 故意违规的声明(nested:true 非法)——校验面按消费对象逐条报,不静默修正。
    const invalid = {
      default: { preset: 'Eterna Reviewer', allow: ['bash', 'web_fetch'] },
      policies: { writer: { preset: 'ok-writer', allow: [], nested: true } },
    } as unknown as Parameters<typeof validateSubagentPolicies>[0]
    const errors = validateSubagentPolicies(invalid)
    expect(errors).toContain('default.preset 必须是小写 kebab-case 平台资产 id:"Eterna Reviewer"')
    expect(errors.some(error => error.includes('default.allow 含只读词汇表外工具 "bash"'))).toBe(true)
    expect(errors.some(error => error.includes('"web_fetch"'))).toBe(true)
    expect(errors).toContain('policies.writer.allow 不能为空名单(subagent 无法工作)')
    expect(errors).toContain('policies.writer.nested 只接受 false(27 号 §2.1-1:subagent 不得再派 subagent)')
  })
})

describe('worker 派 subagent 受约束(constrainForWorker;借权不越 Mandate,27 §2.1-1)', () => {
  it('未点名/未声明的字段由默认策略补齐:preset 与只读 allow 来自声明段,nested 恒 false', () => {
    expect(constrainForWorker(DEFAULT_SUBAGENT_POLICIES, {})).toEqual({
      policy: 'default', preset: REVIEWER_PRESET_ID, allow: [...DEFAULT_REVIEWER_ALLOW], nested: false,
    })
    const declared: Parameters<typeof constrainForWorker>[0] = {
      default: { preset: REVIEWER_PRESET_ID, allow: [...DEFAULT_REVIEWER_ALLOW], nested: false },
      policies: { reviewer: { preset: REVIEWER_PRESET_ID, allow: ['read'] } },
    }
    expect(constrainForWorker(declared, { policy: 'reviewer' }))
      .toEqual({ policy: 'reviewer', preset: REVIEWER_PRESET_ID, allow: ['read'], nested: false })
  })

  it('收紧方向放行:请求 allow ⊆ 策略白名单;生效 allow = 声明策略的白名单', () => {
    const constrained = constrainForWorker(DEFAULT_SUBAGENT_POLICIES, { allow: ['read', 'grep'] })
    expect(constrained.allow).toEqual([...DEFAULT_REVIEWER_ALLOW])
    expect(constrained.allow).toEqual(['read', 'grep', 'glob'])
  })

  it('越权 fail-closed:preset 越出声明、allow 越出白名单、再派生一律拒绝(不静默钳改)', () => {
    expect(() => constrainForWorker(DEFAULT_SUBAGENT_POLICIES, { preset: 'powerful-writer' }))
      .toThrow(SubagentPolicyViolation)
    expect(() => constrainForWorker(DEFAULT_SUBAGENT_POLICIES, { allow: ['bash'] }))
      .toThrow(/借权不越 Mandate/)
    expect(() => constrainForWorker(DEFAULT_SUBAGENT_POLICIES, { nested: true }))
      .toThrow(/不得再派 subagent/)
    expect(() => constrainForWorker(DEFAULT_SUBAGENT_POLICIES, { policy: '未声明的策略名' }))
      .toThrow(/未声明的 subagent 策略/)
  })

  it('resolveSubagentPolicy:点名未知策略抛违规(而非静默落默认)', () => {
    expect(resolveSubagentPolicy(DEFAULT_SUBAGENT_POLICIES).preset).toBe(REVIEWER_PRESET_ID)
    expect(() => resolveSubagentPolicy(DEFAULT_SUBAGENT_POLICIES, 'ghost')).toThrow(SubagentPolicyViolation)
  })
})

describe('装配面:声明段经 TasksOptions 注入,缺省默认,违规拒收(35 号 A18)', () => {
  it('缺省 = DEFAULT_SUBAGENT_POLICIES(只读 reviewer 类)暴露在服务面', () => {
    const root = mkdtempSync(join(tmpdir(), 'tasks-d1-'))
    try {
      const runtime = createTasks({ tenantRoot: root })
      try { expect(runtime.subagentPolicies).toEqual(DEFAULT_SUBAGENT_POLICIES) }
      finally { runtime.dispose() }
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('违规声明装配期即抛(fail-closed,不带病上岗)', () => {
    const root = mkdtempSync(join(tmpdir(), 'tasks-d1-'))
    try {
      expect(() => createTasks({ tenantRoot: root,
        subagentPolicies: { default: { preset: REVIEWER_PRESET_ID, allow: ['bash'] } } }))
        .toThrow(/subagent_policies 声明段未过校验/)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
