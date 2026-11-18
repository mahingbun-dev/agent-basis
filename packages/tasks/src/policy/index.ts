/**
 * 策略与准入 barrel——SA/src/admission.ts + SA/src/policy.ts 拆分后的五件(SA 单文件面)。
 *
 * 设计依据:34 号 §1 目录树 policy/ 行、§2.2 策略与准入映射表;35 号 A4:
 * - admission.ts:三格 × 三档矩阵与 ADMISSION_DEFAULTS(原样;名单语义升级为 realm 内名单);
 * - settings.ts:SettingsSchema(zod .strict()+.describe()+默认值)+ SettingsBlock/Origin + LIMITS 内联;
 * - gate.ts:settingsPolicy(gate/revalidate 五分支/admitsInferred 仅 auto)+ policyEffects(只通知不撤销)
 *   + allowed 名单注入端口(A10 接 access 用户表);
 * - assessment.ts:assessmentOutcome + AdmissionDirection 四方向 + R3 四要素必填 + would_accept;
 * - version.ts:policyVersion = 规则内容 hash(24a C3)+ jointPolicyVersion 联合 hash;
 * - save.ts:分块设置保存与策略同步(A10 接线的组合面——SA Settings.save 机制并入,
 *   版本面扩为联合 hash 并经 Engine.policyChanged 只通知不撤销)。
 */
export * from './admission.ts'
export * from './settings.ts'
export * from './assessment.ts'
export * from './gate.ts'
export * from './version.ts'
export * from './save.ts'
