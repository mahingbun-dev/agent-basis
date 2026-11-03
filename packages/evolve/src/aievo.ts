/**
 * G2 ai-evo 三层门禁 CLI 包装(设计 10 §5 G2 / D3 决议)。
 *
 * - 命令构造纯函数:aievo run task <task> --wait [--base-url …] [--timeout …]
 *   三个门禁任务 release/admission/heldout 各一条命令;
 * - 退出码语义(平台契约,10 §0 D3):0=通过 / 1=不达标 / 2=平台错误;
 * - 执行器可注入:默认 child_process.spawnFile 真实执行;测试/无 CLI 环境注入 mock
 *   runner 或显式 disabled —— 「真实执行可降级跳过」(任务 T10 口径);
 * - 凭据经 credentialsRef 引用(进命令的环境变量名,secret 不进参数不进配置)。
 */

/** 单个门禁任务结果(退出码语义的平台契约)。 */
export type AievoExit = 0 | 1 | 2

export interface AievoTaskConfig {
  /** 任务名(如 task-release-gate)。 */
  readonly name: string
  /** 允许缺省:任务级禁用(如部署早期只开 release 门)。 */
  readonly disabled?: boolean
}

export interface AievoGateConfig {
  /** 平台基址;空 = 未接入(整体降级跳过)。 */
  readonly baseUrl?: string
  /** 凭据引用名(映射为 env AIEVO_API_KEY 的注入来源;不落参数)。 */
  readonly credentialsRef?: string
  readonly tasks: {
    readonly release: AievoTaskConfig
    readonly admission: AievoTaskConfig
    readonly heldout: AievoTaskConfig
  }
  readonly timeoutMin?: number
  /** CLI 可执行路径;缺省 PATH 上的 aievo。 */
  readonly cli?: string
  /** 执行器注入(单测 mock);缺省真实 child_process。 */
  readonly runner?: AievoRunner
}

/** 一次命令执行的产物(退出码 + 输出流)。 */
export type RunnerOutput = { readonly code: number; readonly stdout: string; readonly stderr: string }

/** 命令执行器接口:(file, args) → 退出码(stdout/stderr 供报告)。 */
export type AievoRunner = (file: string, args: readonly string[]) => Promise<RunnerOutput>

/** 单个门禁任务的执行结果。 */
export interface AievoTaskResult {
  readonly gate: 'release' | 'admission' | 'heldout'
  readonly task: string
  readonly status: 'pass' | 'fail-threshold' | 'error' | 'skipped'
  readonly exitCode?: number
  readonly detail: string
}

/** G2 整体结果。 */
export interface AievoGateResult {
  readonly tasks: readonly AievoTaskResult[]
  /** pass = 三任务全 pass;degraded = 全部 skipped(未接入);其余 fail。 */
  readonly verdict: 'pass' | 'fail' | 'degraded'
}

/** 构造单条门禁命令(argv 数组;不携带 secret)。 */
export function buildAievoCommand(config: AievoGateConfig, gate: 'release' | 'admission' | 'heldout'): readonly string[] {
  const task = config.tasks[gate].name
  const args = ['run', 'task', task, '--wait']
  if (config.baseUrl !== undefined && config.baseUrl.length > 0) args.push('--base-url', config.baseUrl)
  const timeout = config.timeoutMin ?? 120
  args.push('--timeout-min', String(timeout))
  return args
}

/** 执行三层门禁(每个任务一条 CLI 命令;exit 0 全过才 pass)。 */
export async function runAievoGates(config: AievoGateConfig): Promise<AievoGateResult> {
  const runner = config.runner ?? spawnRunner
  const cli = config.cli ?? 'aievo'
  const connected = config.baseUrl !== undefined && config.baseUrl.length > 0
  const gates: readonly ('release' | 'admission' | 'heldout')[] = ['release', 'admission', 'heldout']
  const tasks: AievoTaskResult[] = []
  for (const gate of gates) {
    const taskConfig = config.tasks[gate]
    if (!connected || taskConfig.disabled === true) {
      tasks.push({
        gate,
        task: taskConfig.name,
        status: 'skipped',
        detail: !connected
          ? '未配置 baseUrl(平台未接入,降级跳过;部署时填 ai-evo 访问入口后自动生效)'
          : `任务 ${taskConfig.name} 显式禁用`,
      })
      continue
    }
    const args = buildAievoCommand(config, gate)
    try {
      const run = await runner(cli, args)
      const exit = run.code
      // 退出码契约:0 通过 / 1 不达标 / 2 平台错误;其他码按平台错误归类(fail-closed)。
      const status: AievoTaskResult['status'] = exit === 0 ? 'pass' : exit === 1 ? 'fail-threshold' : 'error'
      tasks.push({
        gate,
        task: taskConfig.name,
        status,
        exitCode: exit,
        detail: summarizeOutput(status, run),
      })
    } catch (cause) {
      // CLI 不存在/不可执行(ENOENT 等)→ 平台错误 → fail(fail-closed:接入了就必须真过门)。
      tasks.push({
        gate,
        task: taskConfig.name,
        status: 'error',
        detail: `CLI 执行失败:${cause instanceof Error ? cause.message : String(cause)}`,
      })
    }
  }
  const allSkipped = tasks.every(t => t.status === 'skipped')
  const anyHardFail = tasks.some(t => t.status === 'fail-threshold' || t.status === 'error')
  return {
    tasks,
    // 语义:全部 skipped = 未接入(degraded);任一 exit≠0 = fail(fail-closed);
    // 显式 disabled 的任务是配置豁免,不参与 fail 判定(其余任务全 pass 即 pass)。
    verdict: allSkipped ? 'degraded' : anyHardFail ? 'fail' : 'pass',
  }
}

function summarizeOutput(status: AievoTaskResult['status'], run: RunnerOutput): string {
  const tail = (text: string): string => text.trim().split('\n').slice(-3).join(' ⏎ ').slice(0, 300)
  const base = `exit=${run.code}`
  if (status === 'pass') return `${base}${run.stdout.trim().length > 0 ? `:${tail(run.stdout)}` : ''}`
  return `${base}:${tail(run.stderr) || tail(run.stdout) || (status === 'fail-threshold' ? '门禁指标不达标' : '平台错误')}`
}

/** 默认执行器:真实 child_process(超时 = timeoutMin;杀进程按平台错误处理)。 */
function spawnRunner(file: string, args: readonly string[]): Promise<RunnerOutput> {
  return new Promise((resolve, reject) => {
    import('node:child_process').then(({ spawn }) => {
      const child = spawn(file, [...args], { stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk)
      })
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk)
      })
      child.on('error', reject)
      child.on('close', (code) => {
        resolve({ code: code ?? -1, stdout, stderr })
      })
    }).catch(reject)
  })
}
