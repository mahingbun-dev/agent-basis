/**
 * R0-R3 → DSH permission-presets 配置产物生成器(设计文档 12 §3.1:
 * 「原生 approval(ask/never)+ permission-presets(三档预设可配)| B(读 hitl.yaml 映射预设+规则)| 分档逻辑在插件,执行在内核」)。
 *
 * 产物形态对齐 @deepseek-ai/dsh-permission-presets 的插件行
 * (packages/interaction/permission-presets/README.md:34-45):
 *   - name: '@deepseek-ai/dsh-permission-presets'
 *     config:
 *       presets: { <preset名>: { sandbox, approval, name?, description? } }   # PresetSpec
 *       defaultPreset: <preset名>
 *
 * 分档映射(每档一个预设,全部进表;defaultPreset 取 hitl 的 default_grade 对应档):
 * - R0 只读   → sandbox read-only        + approval never(静默读;越权升级请求被确定性拒绝)
 * - R1 可逆写 → sandbox workspace-write  + approval never(可逆写静默+事后 diff 卡片;升级拒绝即 fail-closed)
 * - R2 需确认 → sandbox workspace-write  + approval ask(富上下文审批卡片)
 * - R3 高危   → sandbox workspace-write  + approval ask + interact 层叠加(升级指定人/冷静期/二次确认)
 *
 * 已知边界(诚实声明):DSH PresetSpec 只捆绑 sandbox/approval 两个旋钮
 * (README「Only two mechanism knobs are bundled」),R3 的升级/冷静期/二次确认无法进预设,
 * 由本包 card.ts 的 R3 附加卡片字段与组合层执行——见 README「已知边界」。
 */
import { stringify } from 'yaml'
import { InteractConfigError } from './errors.ts'
import type { HitlDocument } from './hitl.ts'
import type { RiskGrade } from './types.ts'
import type { PresetSpec } from '@deepseek-ai/dsh-permission-presets'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import type { ApprovalPolicy } from '@deepseek-ai/dsh-user-approval'

/** DSH 预设表保留名(permission-presets README:32;custom=派生态、auto=Auto review 专用)。 */
export const RESERVED_PRESET_NAMES: readonly string[] = ['custom', 'auto']

/** 档 → 预设旋钮 bundle(sandbox + approval)的规范映射。 */
export const GRADE_PRESET_BUNDLES: Readonly<Record<RiskGrade, { sandbox: SandboxMode; approval: ApprovalPolicy }>> = {
  R0: { sandbox: 'read-only', approval: 'never' },
  R1: { sandbox: 'workspace-write', approval: 'never' },
  R2: { sandbox: 'workspace-write', approval: 'ask' },
  R3: { sandbox: 'workspace-write', approval: 'ask' },
}

/** 档 → 预设名后缀。 */
const GRADE_SUFFIX: Readonly<Record<RiskGrade, string>> = {
  R0: 'r0-readonly',
  R1: 'r1-reversible',
  R2: 'r2-confirm',
  R3: 'r3-highrisk',
}

/** 档 → 客户端呈现文案(PresetSpec.name/description)。 */
const GRADE_PRESENTATION: Readonly<Record<RiskGrade, { name: string; description: string }>> = {
  R0: { name: '只读', description: '检索/读文件静默执行;任何升级请求确定性拒绝' },
  R1: { name: '可逆写', description: '工作区内写静默执行,事后 diff 卡片;升级请求确定性拒绝' },
  R2: { name: '需确认', description: '不可逆动作与对外发射走富上下文审批卡片' },
  R3: { name: '高危', description: '审批+升级指定人+二次确认(冷静期可选);升级与冷静期由 interact 层执行' },
}

/** permission-presets 插件行产物:可直接写进 profile 的配置对象 + 档→预设名映射(运行时换档用)。 */
export interface PermissionPresetArtifact {
  /** 插件行 name(固定)。 */
  readonly plugin: '@deepseek-ai/dsh-permission-presets'
  /** 插件行 config(形态即官方 Config.presets/defaultPreset)。 */
  readonly config: {
    readonly presets: Readonly<Record<string, PresetSpec>>
    readonly defaultPreset: string
  }
  /** 风险档 → 预设名(组合层按当前动作上下文换档时查此表)。 */
  readonly gradeToPreset: Readonly<Record<RiskGrade, string>>
}

export interface GeneratePresetOptions {
  /** 预设名前缀;默认 'eterna'。不得产出保留名 custom/auto。 */
  readonly namePrefix?: string
}

/**
 * 由 hitl 文档生成 permission-presets 配置产物。
 * defaultPreset 取 default_grade 对应档(文档 08 §6.1:未命中规则的动作必须走人,新会话缺省即安全档)。
 */
export function generatePresetArtifact(hitl: HitlDocument, options: GeneratePresetOptions = {}): PermissionPresetArtifact {
  const prefix = options.namePrefix ?? 'eterna'
  if (prefix === '') throw new InteractConfigError('namePrefix 不能为空')
  const gradeToPreset: Record<RiskGrade, string> = {} as Record<RiskGrade, string>
  const presets: Record<string, PresetSpec> = {}
  for (const grade of Object.keys(GRADE_SUFFIX) as RiskGrade[]) {
    const presetName = `${prefix}-${GRADE_SUFFIX[grade]}`
    if (RESERVED_PRESET_NAMES.includes(presetName)) {
      throw new InteractConfigError(`生成的预设名 "${presetName}" 撞上 DSH 保留名(custom/auto),请换 namePrefix`)
    }
    gradeToPreset[grade] = presetName
    presets[presetName] = {
      ...GRADE_PRESET_BUNDLES[grade],
      name: GRADE_PRESENTATION[grade].name,
      description: GRADE_PRESENTATION[grade].description,
    }
  }
  const defaultPreset = gradeToPreset[hitl.defaultGrade]
  return { plugin: '@deepseek-ai/dsh-permission-presets', config: { presets, defaultPreset }, gradeToPreset }
}

/** 把产物序列化为可直接粘进 profile 的插件行 YAML。 */
export function renderPresetYaml(artifact: PermissionPresetArtifact): string {
  return stringify([
    {
      name: artifact.plugin,
      config: {
        presets: artifact.config.presets,
        defaultPreset: artifact.config.defaultPreset,
      },
    },
  ])
}
