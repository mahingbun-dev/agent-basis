/**
 * 准入矩阵——三格 × 三档分类表:把进入的消息判为显式请求(explicit)、推断候选(inferred)或忽略(ignore)。
 *
 * 设计依据:34 号 §2.2 admission 行、§1 目录树 policy/ 行;35 号 A4。
 * 语义自 SA/src/admission.ts:8-13 重写级校对移植,矩阵与 `ADMISSION_DEFAULTS` 原样;
 * ★维度升级(34 §2.2;24 §5.2「准入表按租户分 realm」;24a 拍板 A1「一租户一 SQLite」):
 * 名单语义从 SA 的「单团队名单」升级为「realm 内名单」——矩阵本身与格子取值不变,
 * 变的是查表的 settings 属于哪个租户库、allowed 名单数据源接 access 用户表(接线见 gate.ts
 * 的名单注入口与 35 号 A10;存储在租户库,34 §2.2 store 行)。
 * 名单上的发送者对 agent 说话恒为显式请求(不查任何格子);未对 agent 说话的消息不可能显式。
 */
import type { AdmissionCell } from '../core/model.ts'

export type { AdmissionCell }
/** 准入档位:显式请求 / 推断候选 / 忽略。 */
export type Admission = 'explicit' | 'inferred' | 'ignore'
/** 三格 × 三档矩阵:每格允许的档位。未对 agent 说话的两格不允许 explicit——未说话不可能显式。 */
export const ADMISSION_OPTIONS = { listedUnaddressed: ['inferred', 'ignore'], unlistedAddressed: ['explicit', 'inferred', 'ignore'],
  unlistedUnaddressed: ['inferred', 'ignore'] } as const satisfies Record<AdmissionCell, readonly Admission[]>
/** 准入表的一行(对应某接收 scope,如某个会话):每格可选地覆写默认档。 */
export type AdmissionRow = { [C in AdmissionCell]?: typeof ADMISSION_OPTIONS[C][number] }
/**
 * 默认准入规则(与引入矩阵前的行为一致,SA 原样):
 * 名单内发送者的未对准消息为推断候选;名单外发送者一律忽略。
 */
export const ADMISSION_DEFAULTS: Readonly<Record<AdmissionCell, Admission>> = { listedUnaddressed: 'inferred', unlistedAddressed: 'ignore', unlistedUnaddressed: 'ignore' }
