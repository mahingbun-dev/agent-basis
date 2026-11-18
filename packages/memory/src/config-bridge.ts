/**
 * 记忆配置文件桥(M-M3 T12-①,19 号 §5-T12.1 + compaction 文件桥同款形态):
 * 设置分区「记忆」经宿主 SRC 端点写 overrides 文件,glue memory-plugin 每次消费
 * (写入/索引装配)现读热应用——真相源仍是 profile patch 的 MemoryPluginConfig,
 * 本文件只承载**可热改的三个键**(画像开关/域识别开关/写入策略档位),键名与
 * 19 号 §6 配置面对齐。
 *
 * 路径纪律(多租户铁律,PLUGIN-AUTHORING §1.1):文件与 memory.sqlite3 **同目录**
 * (dbPath 派生,memory-audit.jsonl / portrait.md 缓存同款;packctl tenant-scan
 * 随 dbPath 覆盖)。glue memory-plugin 与宿主 admin 端点各以自己的 dbPath 调
 * memoryOverridesPathForDb(唯一真值)——缺省布局 dbPath=<root>/.eterna/
 * memory.sqlite3 时两端落同一 <root>/.eterna/memory.config.json(workspace 根
 * 形态 memoryOverridesPath(root) 与之恒等,断言见 config-bridge.spec)。
 *
 * 热应用语义(向用户如实展示,设置分区 hint 与此一致):
 * - writePolicy / portraitEnabled:写入与索引装配**每次现读**,保存即生效;
 * - domainEnabled=false:索引域区与 episodic 域归属盖章即停(每次装配现读);
 *   停用方向的「启用」若插件启动时域识别未挂载(config.domain.enabled=false),
 *   需重启插件生效——文件桥只关闸不建轨。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** overrides 文件名(与 memory.sqlite3 / memory-audit.jsonl 同目录:workspace 的 .eterna/)。 */
export const MEMORY_OVERRIDES_FILENAME = 'memory.config.json'

/**
 * overrides 所在目录的唯一真值:与 memory.sqlite3 **同目录**(dbPath 派生,
 * defaultMemoryAuditPath / glue portrait.md 缓存同款)。glue memory-plugin 与
 * 宿主 admin 端点各以自己的 dbPath 调用——两端 dbPath 一致(缺省布局
 * <root>/.eterna/memory.sqlite3)即落同一文件,自定义 dbPath 随之同迁。
 */
export function memoryOverridesDirForDb(dbPath: string): string {
  return dirname(dbPath)
}

/** overrides 文件全路径(dbPath 派生形态;admin 写入与 glue 热读共用)。 */
export function memoryOverridesPathForDb(dbPath: string): string {
  return join(memoryOverridesDirForDb(dbPath), MEMORY_OVERRIDES_FILENAME)
}

/** overrides 所在目录的 workspace 根形态(缺省布局=dbPath 派生形态同一目录)。 */
export function memoryOverridesDir(workspaceRoot: string = process.cwd()): string {
  return join(workspaceRoot, '.eterna')
}

/** overrides 文件全路径的 workspace 根形态(readMemoryOverridesFile 缺省值)。 */
export function memoryOverridesPath(workspaceRoot: string = process.cwd()): string {
  return join(memoryOverridesDir(workspaceRoot), MEMORY_OVERRIDES_FILENAME)
}

/**
 * 写入策略档位(T12-①「仅显式/自动+审批/全自动→映射 review 规则」;映射语义
 * 见 resolveWriteReviewState 的 policy 参数,19 号 §3-T2.5 review_state 规则之上的
 * 部署级旋钮):
 * - 'explicit-only':仅显式——只有用户显式「记住」直接生效,其余一律待审;
 * - 'auto-review'(缺省):自动+审批——现行分级规则(08 §5.4:domain+episodic
 *   静默,user 层与 semantic/procedural 待审);
 * - 'full-auto':全自动——不再产生待审(唯一例外 source='compaction' 仍强制
 *   pending,17 §7.1-L3 投毒防线不随档位放宽)。
 */
export type MemoryWritePolicy = 'explicit-only' | 'auto-review' | 'full-auto'

/** 写入策略档位全集(设置分区 radiogroup 与网关校验共用)。 */
export const MEMORY_WRITE_POLICIES: readonly MemoryWritePolicy[] = ['explicit-only', 'auto-review', 'full-auto']

/** 缺省档位(现行规则,18 §13 Q3 初始全审语义所在档)。 */
export const DEFAULT_MEMORY_WRITE_POLICY: MemoryWritePolicy = 'auto-review'

/**
 * overrides 文件的可热改键(其余键由 profile patch 拥有,不进本文件)。
 *
 * M-M4 全局蒸馏两键(18 号 §8 + §13 Q4 决议)同 schema 分文件归属,**不得混用**:
 * - `distillEnabled` 只应出现在**部署根** overrides(<根>/.eterna/)——部署级授权
 *   热改键(缺省回落 profile patch distill.enabled,再缺省 false);admin 经
 *   eternaMemory/distillEnable 写入;
 * - `distillParticipate` 只应出现在**账号** overrides(workspaces/<账号>/.eterna/)
 *   ——用户级 opt-out(缺省 true=随部署参与);本人经 eternaMemory/
 *   setDistillParticipate 写入。解析面不区分文件位置(防御面同口径),归属纪律
 *   由写入端点与蒸馏任务各读各的文件钉死。
 */
export interface MemoryOverrides {
  /** 画像开关(缺省 true;false=索引不再注入画像区,Dream 再生成跳过)。 */
  readonly portraitEnabled?: boolean
  /** 域识别开关(缺省 true;false=索引域区/episodic 域归属即停,见文件头热应用语义)。 */
  readonly domainEnabled?: boolean
  /** 写入策略档位(缺省 'auto-review')。 */
  readonly writePolicy?: MemoryWritePolicy
  /** 全局蒸馏部署级授权(仅根文件;缺省回落 profile distill.enabled→false,Q4)。 */
  readonly distillEnabled?: boolean
  /** 本人记忆参与全局蒸馏(仅账号文件;缺省 true=默认参与,可退出,18 §10)。 */
  readonly distillParticipate?: boolean
  /**
   * 跨用户交叉验证阈值 K(仅根文件;缺省 5,18 §8;本部署配 3——41 号 §2)。
   * 部署旋钮:glue apply 时解析一次,改后重启插件生效(非热改键)。
   */
  readonly distillMinUsers?: number
}

/** 防御解析 overrides 载荷(文件读出/网关入参共用一份口径):未知键忽略,类型不符拒绝。 */
export function parseMemoryOverrides(raw: unknown): MemoryOverrides | { readonly error: string } {
  if (typeof raw !== 'object' || raw === null) return { error: '配置必须是对象' }
  const input = raw as Record<string, unknown>
  const out: {
    portraitEnabled?: boolean
    domainEnabled?: boolean
    writePolicy?: MemoryWritePolicy
    distillEnabled?: boolean
    distillParticipate?: boolean
    distillMinUsers?: number
  } = {}
  if (input.portraitEnabled !== undefined) {
    if (typeof input.portraitEnabled !== 'boolean') return { error: 'portraitEnabled 必须是布尔值' }
    out.portraitEnabled = input.portraitEnabled
  }
  if (input.domainEnabled !== undefined) {
    if (typeof input.domainEnabled !== 'boolean') return { error: 'domainEnabled 必须是布尔值' }
    out.domainEnabled = input.domainEnabled
  }
  if (input.writePolicy !== undefined) {
    if (typeof input.writePolicy !== 'string' || !MEMORY_WRITE_POLICIES.includes(input.writePolicy as MemoryWritePolicy)) {
      return { error: `writePolicy 只允许 ${MEMORY_WRITE_POLICIES.join(' / ')}` }
    }
    out.writePolicy = input.writePolicy as MemoryWritePolicy
  }
  if (input.distillEnabled !== undefined) {
    if (typeof input.distillEnabled !== 'boolean') return { error: 'distillEnabled 必须是布尔值' }
    out.distillEnabled = input.distillEnabled
  }
  if (input.distillParticipate !== undefined) {
    if (typeof input.distillParticipate !== 'boolean') return { error: 'distillParticipate 必须是布尔值' }
    out.distillParticipate = input.distillParticipate
  }
  if (input.distillMinUsers !== undefined) {
    if (typeof input.distillMinUsers !== 'number' || !Number.isFinite(input.distillMinUsers) || input.distillMinUsers < 1) {
      return { error: 'distillMinUsers 必须是 ≥1 的数字' }
    }
    out.distillMinUsers = input.distillMinUsers
  }
  return out
}

/** 解析成功的窄化(错误对象 → undefined;调用方自行报错)。 */
export function parsedOverridesOf(result: MemoryOverrides | { readonly error: string }): MemoryOverrides | undefined {
  return 'error' in result ? undefined : result
}

/** 生效视图:overrides(热改键)叠加在基线(缺省值)上,字段全部给全。 */
export interface MemoryEffectiveFlags {
  readonly portraitEnabled: boolean
  readonly domainEnabled: boolean
  readonly writePolicy: MemoryWritePolicy
}

export function resolveEffectiveFlags(overrides: MemoryOverrides): MemoryEffectiveFlags {
  return {
    portraitEnabled: overrides.portraitEnabled ?? true,
    domainEnabled: overrides.domainEnabled ?? true,
    writePolicy: overrides.writePolicy ?? DEFAULT_MEMORY_WRITE_POLICY,
  }
}

/**
 * 读 overrides 文件(glue 热应用与宿主 admin 端点共用;fail-open:文件缺席/
 * 损坏/字段类型不符一律空表回落基线——热改键是展示位配置,不值得赌)。
 */
export function readMemoryOverridesFile(path: string = memoryOverridesPath()): MemoryOverrides {
  try {
    if (!existsSync(path)) return {}
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return parsedOverridesOf(parseMemoryOverrides(parsed)) ?? {}
  } catch {
    return {}
  }
}
