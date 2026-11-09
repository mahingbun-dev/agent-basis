/**
 * 异步报告任务工具(确定性桩;首场景④ 报告生成的任务队列核心,图纸⑦「报告输出异步化:
 * 任务队列+进度回报+产物落对象存储+前端下载」)。
 * 提交 → job id → 状态查询(进度回报)→ 产物引用;产物落本地对象存储桩(真实接入换
 * MiniO 存储后端,接口不变)。语义对齐 base tool-jobs(dsh):kind/label/status/detail
 * 快照形态、状态枚举 running|completed|failed(桩无 kill 通道,stopping/killed 不出现)、
 * 「完成有回报、不 busy-poll」;deviation:job id 为桩内顺序号(真实 jobs registry 为
 * `<kind>-<uuid16>`,jobs-local/src/index.ts:231),时刻为字符串桩值(真实快照 epoch ms)。
 * 报告红线在 submit 处 fail-closed:缺时间窗或缺数据出处(sources)的任务不予提交——
 * 报告缺出处 = 不通过,用户要求省略出处也不豁免。
 *
 * Cordis 纪律形态:
 * - 注册表 + 唯一 ID:@industrial-analysis/report-jobs-tool(packctl lint CORD004);
 * - 纯函数实现:无旁路全局、无裸定时器、无 Date.now(状态机由 status 查询确定性推进,
 *   CORD001);实例内可变状态(任务表)随插件实例丢弃,不落旁路全局;
 * - 副作用型工具(R1 档可逆写,产物可删):由 ../plugin.ts 注册,卸载随实例无残留。
 */

/** 唯一 ID(注册表键;@industrial-analysis/* 命名空间)。 */
export const REPORT_JOBS_TOOL_SERVICE_ID = '@industrial-analysis/report-jobs-tool'

/** 任务状态:对齐 base tool-jobs PUBLIC_JOB_SCHEMA 枚举(dsh tool-jobs src/index.ts:87);桩内流程不产生 failed。 */
export type ReportJobStatus = 'running' | 'completed' | 'failed'

/** 出处条目:报告红线的载体,kind + ref 逐条登记,渲染时写进产物页脚。 */
export interface ReportSourceRef {
  readonly kind: 'timeseries' | 'alert' | 'knowledge' | 'rule'
  /** 测点+时间窗 / 告警 id / 知识 citation(带版本)/ 规则 id(RULE-*)。 */
  readonly ref: string
}

/** 提交输入:title + window + sources 必填(缺任一 = 不予提交,fail-closed)。 */
export interface ReportJobInput {
  readonly title: string
  /** 报告时间窗(如 '2026-11-06 00:00–23:00'):报告必须带时间窗,缺窗不予提交。 */
  readonly window: string
  readonly sources: readonly ReportSourceRef[]
  /** 工作区草稿路径(选填;交付文件面板可见,产物引用随带)。 */
  readonly draftPath?: string
}

/** 任务快照(kind/label/status/detail 对齐 base tool-jobs public 形态;时间用包内字符串桩值)。 */
export interface ReportJobSnapshot {
  readonly jobId: string
  readonly kind: 'report'
  readonly label: string
  readonly status: ReportJobStatus
  /** 进度行(进度回报;对齐 tool-jobs 的 live progress line 语义)。 */
  readonly detail: string
  readonly window: string
  readonly submittedAt: string
  readonly finishedAt?: string
  readonly source: 'stub-sample'
}

/** 产物引用:对象存储桩路径 + 草稿路径 + 随带出处清单(前端下载链按 storagePath 走)。 */
export interface ReportArtifactRef {
  readonly artifactId: string
  readonly jobId: string
  readonly title: string
  readonly window: string
  /** 对象存储桩路径(本地盘;MiniO 接入后整体替换为真桶路径,接口不变)。 */
  readonly storagePath: string
  /** 工作区草稿路径(未提供时与 storagePath 同指产物)。 */
  readonly draftPath?: string
  /** 产物随带的出处清单(渲染页脚;引用如实,不虚构)。 */
  readonly sources: readonly ReportSourceRef[]
  readonly source: 'stub-sample'
}

export interface ReportJobsResult {
  readonly count: number
  readonly jobs: readonly ReportJobSnapshot[]
}

/** 可交换接口:任何提供同等 id 与能力的实现(真实 jobs 队列 + MiniO 渲染管线)可整体替换本模块。 */
export interface IndustrialReportJobsTool {
  readonly id: typeof REPORT_JOBS_TOOL_SERVICE_ID
  /** 提交渲染任务(校验 title/window/sources,缺出处与时间窗 fail-closed 拒收)→ job id。 */
  submit(input: ReportJobInput): ReportJobSnapshot
  /** 查询进度:每次查询确定性推进状态机(取数 → 渲染 → completed),对齐「进度回报」。 */
  status(jobId: string): ReportJobSnapshot
  /** 产物引用:completed 后可用;未完成抛错(产物未就绪,先查进度,不编造产物引用)。 */
  fetch(jobId: string): { readonly job: ReportJobSnapshot; readonly artifact: ReportArtifactRef }
  /** 任务列表(running 与 completed;对齐 job_list 的可见面)。 */
  list(): ReportJobsResult
}

/** 桩内固定时刻(确定性;真实实现由 jobs 侧打点)。 */
const STUB_SUBMITTED_AT = '2026-11-07 09:40'
const STUB_FINISHED_AT = '2026-11-07 09:42'

/** 源 kinds(口径不猜,非法值报错列出可用值)。 */
const SOURCE_KINDS: readonly ReportSourceRef['kind'][] = ['timeseries', 'alert', 'knowledge', 'rule']

/** 桩内任务行:快照 + 渲染输入 + 确定性状态机游标(实例内可变,卸载即弃)。 */
interface StoredJob {
  readonly jobId: string
  readonly label: string
  readonly window: string
  readonly sources: readonly ReportSourceRef[]
  readonly draftPath?: string
  /** status 查询次数:0 = 刚受理;1 = 取数完成渲染中;≥2 = 渲染完成。 */
  polls: number
}

export function createReportJobsTool(): IndustrialReportJobsTool {
  // 实例内可变状态(effect 状态):插件卸载随实例一起丢弃,不落旁路全局。
  const jobs: StoredJob[] = []
  let nextSeq = 1

  const snapshotOf = (job: StoredJob): ReportJobSnapshot => {
    const completed = job.polls >= 2
    const detail = job.polls === 0
      ? `已受理:排队取数(出处 ${job.sources.length} 条),进度 0%`
      : job.polls === 1
        ? `取数完成(出处 ${job.sources.length} 条),渲染中,进度 60%`
        : '渲染完成,产物可 fetch(对象存储桩)'
    return {
      jobId: job.jobId,
      kind: 'report',
      label: job.label,
      status: completed ? 'completed' : 'running',
      detail,
      window: job.window,
      submittedAt: STUB_SUBMITTED_AT,
      ...(completed ? { finishedAt: STUB_FINISHED_AT } : {}),
      source: 'stub-sample',
    }
  }

  const findJob = (jobId: string): StoredJob => {
    const job = jobs.find(entry => entry.jobId === jobId)
    if (job === undefined) {
      throw new Error(`report_jobs: 任务不存在: ${jobId}(可用任务见 op=list;job id 只来自 submit 返回,不编造)`)
    }
    return job
  }

  return {
    id: REPORT_JOBS_TOOL_SERVICE_ID,
    submit(input) {
      if (typeof input.title !== 'string' || input.title.trim().length === 0) {
        throw new Error('report_jobs: title(报告标题)必填')
      }
      if (typeof input.window !== 'string' || input.window.trim().length === 0) {
        throw new Error('report_jobs: 报告缺时间窗(window 必填,如 2026-11-06 00:00–23:00),不予提交(报告红线:报告必须带时间窗);补齐后重新提交')
      }
      if (!Array.isArray(input.sources) || input.sources.length === 0) {
        throw new Error('report_jobs: 报告缺数据出处(sources 必填非空),不予提交(报告红线:每个数字带出处与时间窗);补齐后重新提交')
      }
      for (const ref of input.sources) {
        if (!SOURCE_KINDS.includes(ref.kind)) {
          throw new Error(`report_jobs: 出处 kind 必须是 ${SOURCE_KINDS.join('|')},收到: ${String(ref.kind)}`)
        }
        if (typeof ref.ref !== 'string' || ref.ref.trim().length === 0) {
          throw new Error('report_jobs: 出处 ref 必填(测点+时间窗 / 告警 id / 知识 citation / RULE-*)')
        }
      }
      const jobId = `report-${String(nextSeq).padStart(4, '0')}`
      nextSeq += 1
      jobs.push({
        jobId,
        label: input.title.trim(),
        window: input.window.trim(),
        sources: input.sources.map(ref => ({ kind: ref.kind, ref: ref.ref.trim() })),
        ...(input.draftPath !== undefined && input.draftPath.trim().length > 0 ? { draftPath: input.draftPath.trim() } : {}),
        polls: 0,
      })
      return snapshotOf(jobs[jobs.length - 1]!)
    },
    status(jobId) {
      const job = findJob(jobId)
      // 确定性状态机:每次查询推进一阶段(进度回报),两次后稳定在 completed。
      if (job.polls < 2) job.polls += 1
      return snapshotOf(job)
    },
    fetch(jobId) {
      const job = findJob(jobId)
      // 只读:不推进状态机。未完成即拒——产物未就绪,先 op=status 查进度,不编造产物引用。
      if (job.polls < 2) {
        throw new Error(`report_jobs: 任务未完成(status=${snapshotOf(job).status}),产物未就绪;先 op=status 查进度,不编造产物引用`)
      }
      const snapshot = snapshotOf(job)
      const artifact: ReportArtifactRef = {
        artifactId: `ART-${job.jobId}`,
        jobId: job.jobId,
        title: job.label,
        window: job.window,
        storagePath: `stub://objects/reports/${job.jobId}.md`,
        ...(job.draftPath !== undefined ? { draftPath: job.draftPath } : {}),
        sources: job.sources,
        source: 'stub-sample',
      }
      return { job: snapshot, artifact }
    },
    list() {
      return { count: jobs.length, jobs: jobs.map(snapshotOf) }
    },
  }
}
