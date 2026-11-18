/**
 * 规则版本化——governance 侧(G2-A15 验收门禁第①句:「规则版本 = 规则文件内容 hash」;
 * 24a 拍板记录·C3;24 号 §9-2 版本化落点 = governance/src/rules.ts)。
 *
 * 覆盖面:
 * - rulesVersion:同内容同版本、内容变即版本变(热改即新版本)、重排/注释等原始文本差异
 *   不虚增版本(语义内容粒度,与 tasks 侧 policyContent 同构口径);
 * - 域标识 RULES_REVISION 跨域防撞(tasks 侧 POLICY_REVISION 同构,不 import——31 号 §2.2
 *   铁律 1「Tier1 永不 import Tier2」,本包依赖方向只出不进);
 * - glue 组参口径:rulesVersion 产物作为 tasks `jointPolicyVersion` 的 governance 侧
 *   (A10 联合 hash,34 号 §2.2 version 行)——本 spec 只断言本包面,联合行为由
 *   packages/tasks/tests/policy.spec.ts 与 settings.spec.ts 以注入串覆盖(依赖方向禁反查)。
 * G2-A15 第②句(Mandate 固化创建时版本、热改只通知不撤销)的被测对象在 tasks 包——
 * packages/tasks/tests/mandate-policy.spec.ts(35 号 A10 门禁点名文件,任务侧承接)。
 */
import { describe, expect, it } from 'vitest'
import { RuleEngine, RULES_REVISION, rulesVersion } from '../src/index.ts'

const POLICY = `
default: ask
rules:
  - id: deny-rm-rf
    effect: deny
    tools: ['shell*', 'bash*']
    argsContains: ['rm -rf']
    reason: '破坏性命令'
  - id: allow-readonly
    effect: allow
    tools: ['read_*', 'glob_*', 'grep_*']
`

describe('规则版本 = 解析后策略文档的内容 hash(C3/G2-A15)', () => {
  it('同内容同版本:同一份 YAML 两次 parse 的版本逐字相等(跨进程稳定)', () => {
    expect(rulesVersion(RuleEngine.parse(POLICY))).toBe(rulesVersion(RuleEngine.parse(POLICY)))
    expect(rulesVersion(RuleEngine.parse(POLICY))).toMatch(/^[0-9a-f]{32}$/)
  })
  it('语义内容粒度:YAML 重排/注释增删不改版本(不虚增),规则实质变化即新版本(热改即新版本)', () => {
    const reformatted = POLICY.replace('\n', '\n\n').replace('default: ask', 'default: ask # 注释增删不进 hash')
    expect(rulesVersion(RuleEngine.parse(reformatted))).toBe(rulesVersion(RuleEngine.parse(POLICY)))
    const hot = RuleEngine.parse(POLICY.replace('- id: allow-readonly\n    effect: allow', '- id: allow-readonly\n    effect: ask'))
    expect(rulesVersion(hot)).not.toBe(rulesVersion(RuleEngine.parse(POLICY)))
  })
  it('default 裁决进版本面:fail-closed 缺省变化即新版本', () => {
    const changed = RuleEngine.parse(POLICY.replace('default: ask', 'default: deny'))
    expect(rulesVersion(changed)).not.toBe(rulesVersion(RuleEngine.parse(POLICY)))
  })
  it('域标识 RULES_REVISION 是稳定导出的版本域契约(glue 组参跨版本恒定;tasks 侧 POLICY_REVISION 同构)', () => {
    expect(RULES_REVISION).toBe('governance-rules-v1')
  })
})
