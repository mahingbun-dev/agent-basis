/**
 * 规则版本化——版本 = 规则内容 hash(24a 拍板记录·C3:「版本号 = 文件内容 hash,热改即新版本;
 * 在跑工单钉旧版,新规则只影响新工单」)。
 *
 * 设计依据:34 号 §2.2 version 行(SA policy.ts:111-118 拆出)、§5-governance;
 * 35 号 A4(纯函数面)与 A10(接线);27 号 §3.2-④(权力层级:策略新版本只通知不撤销)。
 * SA 的 `key(POLICY_REVISION, JSON.stringify(...))` 已是内容派生,语义与 C3 吻合——原样保留;
 * ★C3 改造点(34 §2.2):「规则」的定义从 SA settings.rules 扩为
 * **governance rules.yaml + hitl.yaml + tasks 准入表** 的联合 hash——由 glue 层在热改时重算
 * 并调 `Engine.policyChanged`(计算归属未决前按 glue 层方案实现,35 号 §12-3 开放问题);
 * 联合 hash 的计算函数即本文件的 `jointPolicyVersion`,glue 侧只组参不重造。
 * 版本只随影响工作授权的内容变化:模型、并发、暂停、轮询间隔的变化不使既有 Decision 失效
 * (SA policy.ts:112-115 注释语义)。
 */
import { key } from '../core/ids.ts'
import type { Settings } from './settings.ts'

/** 版本域标识(SA 原样):进 hash 的首参,域内内容变则版本变、跨域不撞。 */
export const POLICY_REVISION = 'mandate-v3'

/**
 * tasks 侧进入版本 hash 的内容面:设置中影响工作授权的部分——评估规则表、Eval 受理档位与
 * 各 Source 的策略分部(realm 内名单 + 准入表)。模型/并发/暂停/Source 自身配置不进 hash。
 */
export function policyContent(settings: Settings): string {
  return JSON.stringify({ rules: settings.policy.rules, mode: settings.eval.mode, sources: settings.policy.sources })
}
/** 设置的规则内容 hash(C3):同内容同版本,内容变即版本变。 */
export function policyVersion(settings: Settings): string {
  return key(POLICY_REVISION, policyContent(settings))
}
/** C3 联合 hash 的三侧内容:governance rules.yaml、hitl.yaml 与 tasks 侧(准入表所在 settings)。 */
export interface JointPolicyParts {
  /** governance rules.yaml 的内容。 */
  governance: string
  /** hitl.yaml 的内容。 */
  hitl: string
  /** tasks 侧内容(通常传 `policyContent(settings)`,或其再 hash)。 */
  tasks: string
}
/**
 * 联合规则版本(C3):governance + hitl + tasks 三侧内容共同决定的版本——任一侧热改即新版本。
 * glue 层监听三侧变化重算之,并以之调 `Engine.policyChanged(from, to, effects)`——在跑工单钉旧版
 * (只收 `policy-changed` 通知,Mandate 不撤销),新规则只影响新工单(27 号 §3.2-④;35 号 A8/A10)。
 */
export function jointPolicyVersion(parts: JointPolicyParts): string {
  return key(POLICY_REVISION, JSON.stringify(parts))
}
