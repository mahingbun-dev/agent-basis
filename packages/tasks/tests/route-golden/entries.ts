/**
 * 路由金集 v0——人工判例 20 条(35 号 A26;28 号 §5;24a 拍板记录·C4「人工 20 条起步」)。
 *
 * 判例四类(28 §5):明确的 accept / 应 attach 到已有工单 / 应 ignore 的 bot 消息 / 应 stop。
 * 每条判例 = 触发原文(`trigger.text`,压缩强制保留项——21 号 D3 定制品 × Mandate,28 §5)
 * + 线程情境 + 回放的模型裁决(`replay`,replay 适配器:记录的 Decision 面)。
 * 「在压缩后的会话状态上跑」由 dsh-evals replay 跑法承担(压缩前后各一遍,驱动脚本随
 * G2-A9,scripts/diff-pass-rate.mjs 待建;跑动口径 = nightly CI,见目录 README);本文件是
 * 判例数据面,vitest 回放在 tests/route-golden.spec.ts。试点期月度从真实 Decision 增补
 * (24a C4;来源 = audit trace)。
 *
 * 判例落位为暂定(35 号 §12-10 开放问题:`packages/tasks/tests/` vs dsh-evals pack 未拍板;
 * 本目录 tests/route-golden/ 为 35 号 A26 任务指令指定落位,自 tests/fixtures/routing-golden/
 * 迁入),拍板后可整体迁移,不视为设计定稿。
 */

/** 判例四类(28 §5)。 */
export type GoldenKind = 'accept' | 'attach' | 'ignore-bot' | 'stop'

/** 判例前置:开出对象工单的种子(attach/stop 必带)与环境扩展(名单/bots)。 */
export interface GoldenSeed {
  /** 种子 trigger id(时间偏移沿用 host 约定:数字位作秒);attach/stop 判例必填。 */
  id?: string
  /** 种子触发原文;attach/stop 判例必填。 */
  text?: string
  /** 种子工单的 worker 先报 ready(工单结束)——已结束工单场景。 */
  ready?: boolean
  /** 追加进名单的发送者(默认名单仅 u-alice)。 */
  allowed?: string[]
  /** 登记进该 Source bots 名单的 bot actor id(ignore-bot 判例)。 */
  bots?: string[]
}

/** 判例的触发消息(触发原文 = 压缩强制保留项)。 */
export interface GoldenTriggerSpec {
  id: string
  /** 触发原文:逐字保留,不随压缩丢失(21 号 D3;28 §5「触发原文」列)。 */
  text: string
  /** 人消息(默认 true);bot 消息为 false。 */
  human?: boolean
  /** bot 的 actor id(ignore-bot 判例;host 会把它登记进该 Source 的 bots 名单)。 */
  bot?: string
  /** 发送者(默认名单内 u-alice;名单外发送者用 u-guest 等测拒收)。 */
  actor?: string
  /** 是否对准 agent(默认:人消息 mention、bot 消息不对准)。 */
  addressed?: boolean
}

/** 回放的模型裁决(replay 适配器):路由器对候选做出的 Decision 面。 */
export type GoldenReplay =
  | { kind: 'accept'; title: string; scope: string; reason: string; delegation: { objective: string; outputFormat: string; toolGuidance: string; taskBoundaries: string } }
  | { kind: 'attach'; note?: string }
  | { kind: 'ignore'; reason: string }
  | { kind: 'stop'; reason: string }

/** 一条路由判例。 */
export interface GoldenEntry {
  /** 判例稳定 id(RG-NN;增补不重号)。 */
  id: string
  kind: GoldenKind
  /** 判例理据:为何是这个裁决(人工判例的说明面,评审与增补时的对照物)。 */
  why: string
  trigger: GoldenTriggerSpec
  /** 前置:开出对象工单(attach/stop 判例)。 */
  setup?: GoldenSeed
  /** 回放的裁决;`byGate: true` = 策略门结构性裁定(路由器未见候选)。 */
  replay: GoldenReplay & { byGate?: boolean }
}

/** v0 = 20 条(24a C4 拍板;目标 30–50 条为 28 §5 设计值,两处非冲突)。 */
export const ROUTING_GOLDEN: readonly GoldenEntry[] = [
  // ── accept:明确的受理(6) ───────────────────────────────────────────────
  {
    id: 'RG-01', kind: 'accept',
    why: '名单内发送者对准 agent 的明确祈使请求:新工作,无一指向既有工单 → accept 开新单。',
    trigger: { id: '1', text: '@bot 修复设置页保存失败的回归' },
    replay: { kind: 'accept', title: '修复设置页保存失败', scope: '修复设置页保存失败的回归,不含相邻页面。', reason: '名单内发送者的明确请求',
      delegation: { objective: '定位并修复设置页保存失败。', outputFormat: '补丁与验证说明。', toolGuidance: '在工单工作区内用读写与命令工具。', taskBoundaries: '仅该缺陷,不重构。' } },
  },
  {
    id: 'RG-02', kind: 'accept',
    why: '无背景的祈使句改文案:意图与目标具体(改成「导出 CSV」),无需上下文即可受理。',
    trigger: { id: '2', text: '帮我把导出按钮的文案改成「导出 CSV」' },
    replay: { kind: 'accept', title: '导出按钮文案改为「导出 CSV」', scope: '仅该按钮文案。', reason: '明确请求,目标具体',
      delegation: { objective: '把导出按钮文案改为「导出 CSV」。', outputFormat: '文案 diff。', toolGuidance: '定位组件后改字符串。', taskBoundaries: '不动布局与其他文案。' } },
  },
  {
    id: 'RG-03', kind: 'accept',
    why: '另一名名单内成员(u-bob)的线上事故报障:对准 agent、指明症状与位置 → accept。',
    trigger: { id: '3', text: '@bot 线上 /api/orders 500 了,报错堆栈在日志里,查一下并修复', actor: 'u-bob' },
    setup: { allowed: ['u-bob'] },
    replay: { kind: 'accept', title: '修复 /api/orders 500', scope: '排查并修复 /api/orders 500。', reason: '名单内发送者的事故报障',
      delegation: { objective: '定位并修复 /api/orders 500。', outputFormat: '补丁与根因说明。', toolGuidance: '先读日志与堆栈再改码。', taskBoundaries: '仅该接口故障。' } },
  },
  {
    id: 'RG-04', kind: 'accept',
    why: '新线程上的补充需求,未引用任何既有工单/PR/回执:主题相似≠指向(dispatch:主题相似是新请求)→ accept 而非 attach。',
    trigger: { id: '4', text: '@bot 再开一个:夜间批处理任务偶尔漏跑,也修一下' },
    replay: { kind: 'accept', title: '修复夜间批处理漏跑', scope: '排查夜间批处理漏跑。', reason: '新线程的明确新请求,无指向既有工单',
      delegation: { objective: '查明夜间批处理漏跑原因并修复。', outputFormat: '补丁与触发说明。', toolGuidance: '查调度日志与任务表。', taskBoundaries: '不改批处理以外的调度。' } },
  },
  {
    id: 'RG-05', kind: 'accept',
    why: '带验收标准的文档更新请求:意图、目标、验收三事实齐备 → accept(验收进 scope,不加实现方案)。',
    trigger: { id: '5', text: '@bot 把 README 的安装步骤更新成 pnpm 版;验收:新人照文档能一次跑通' },
    replay: { kind: 'accept', title: 'README 安装步骤更新为 pnpm', scope: '更新 README 安装步骤为 pnpm,验收=新人照文档一次跑通。', reason: '明确请求,验收可检验',
      delegation: { objective: '把 README 安装步骤更新为 pnpm 版。', outputFormat: '文档 diff。', toolGuidance: '按实际命令逐条验证再写。', taskBoundaries: '仅安装一节。' } },
  },
  {
    id: 'RG-06', kind: 'accept',
    why: '非祈使但确立了意图:人确认此前提案(「就这么改」)——admission:一句简短同意可确认一个具体更早提案,不要求重述祈使句。',
    trigger: { id: '6', text: '@bot 就按刚才说的那样:副标题改成「浏览网页」,别的都不动' },
    replay: { kind: 'accept', title: '副标题改为「浏览网页」', scope: '仅副标题文案。', reason: '人对既有提案的明确确认,目标具体',
      delegation: { objective: '把副标题改为「浏览网页」。', outputFormat: '文案 diff。', toolGuidance: '定位副标题组件。', taskBoundaries: '不动其他文案与样式。' } },
  },

  // ── attach:挂到已有工单(5) ─────────────────────────────────────────────
  {
    id: 'RG-07', kind: 'attach',
    why: '新线程消息明确点名该工单的 PR(#42):dispatch「引用或链接工单的 PR」→ attach,不开重复单。',
    trigger: { id: '7', text: 'PR #42 里顺手把标题也对齐新文案吧' },
    setup: { id: 's7', text: '@bot 修复设置页保存失败的回归' },
    replay: { kind: 'attach', note: '点名 #42,属该工单范围' },
  },
  {
    id: 'RG-08', kind: 'attach',
    why: '消息指「刚完成的那个变更」且恰好一张工单吻合(dispatch 第四种指向)→ attach 到该工单。',
    trigger: { id: '8', text: '就刚才登录回归那个修复:同样的鉴权问题在注册接口也有,一起修' },
    setup: { id: 's8', text: '@bot 修复登录回归' },
    replay: { kind: 'attach', note: '指向刚完成的登录回归修复' },
  },
  {
    id: 'RG-09', kind: 'attach',
    why: '消息引用工单的 acknowledgement(「收到:修复登录回归」)→ dispatch「引用其回执」→ attach。',
    trigger: { id: '9', text: '接着你们那条「收到:修复登录回归」补一句:登出也要覆盖' },
    setup: { id: 's9', text: '@bot 修复登录回归' },
    replay: { kind: 'attach', note: '引用该工单的回执' },
  },
  {
    id: 'RG-10', kind: 'attach',
    why: '已结束(ready)工单被人的消息点名:attach 使其在原 Mandate 下恢复(subscriptions:人的消息恢复已结束工单)。',
    trigger: { id: '10', text: '登录回归那个修复上线后又复现了,接着查' },
    setup: { id: 's10', text: '@bot 修复登录回归', ready: true },
    replay: { kind: 'attach', note: '已结束工单被点名,恢复执行' },
  },
  {
    id: 'RG-11', kind: 'attach',
    why: '人转发/确认既有工单的原始消息并批准开工:指向明确,不重复开单 → attach。',
    trigger: { id: '11', text: '把你们那条「修复设置页保存失败的回归」的原消息转给老板了,批了,开工' },
    setup: { id: 's11', text: '@bot 修复设置页保存失败的回归' },
    replay: { kind: 'attach', note: '确认既有工单的原始请求' },
  },

  // ── ignore-bot:应忽略的 bot 消息(5) ────────────────────────────────────
  {
    id: 'RG-12', kind: 'ignore-bot',
    why: '名单内 CI bot 的流水线通知:bot 消息不授权工作(subscriptions:bot 与 CI 不能授权)→ ignore。',
    trigger: { id: '12', text: 'CI:master 流水线 #1287 通过(12 tests, 0 failed)', human: false, bot: 'ci-bot' },
    setup: { bots: ['ci-bot'] },
    replay: { kind: 'ignore', reason: 'CI 通知,不构成工作请求' },
  },
  {
    id: 'RG-13', kind: 'ignore-bot',
    why: 'bot 转述人的话:转发不构成新授权(引用/转发的文本永不改变 policy;授权只属于原始发送者在其线程上的消息)→ ignore。',
    trigger: { id: '13', text: '[转发] 张三 在别处说:「这个项目要是能加个深色模式就好了」', human: false, bot: 'relay-bot' },
    setup: { bots: ['relay-bot'] },
    replay: { kind: 'ignore', reason: 'bot 转发,原意属别处讨论且无确立请求' },
  },
  {
    id: 'RG-14', kind: 'ignore-bot',
    why: '定时摘要 bot 的日报:无具体变更意图,例行信息 → ignore。',
    trigger: { id: '14', text: '日报:昨日新增 issue 3,关闭 5,PR 合并 2;仓库当前 12 个打开 issue。', human: false, bot: 'digest-bot' },
    setup: { bots: ['digest-bot'] },
    replay: { kind: 'ignore', reason: '例行摘要,无变更意图' },
  },
  {
    id: 'RG-15', kind: 'ignore-bot',
    why: '部署 bot 的上线播报(无工单线程上的动作请求):状态信息 → ignore。',
    trigger: { id: '15', text: 'deploy-bot: v1.2.3 已上线生产(耗时 3m12s)', human: false, bot: 'deploy-bot' },
    setup: { bots: ['deploy-bot'] },
    replay: { kind: 'ignore', reason: '上线播报,无动作请求' },
  },
  {
    id: 'RG-16', kind: 'ignore-bot',
    why: '名单外 bot 的消息:策略门结构性拒收(not_human)——连候选都不是,Decision 由 gate 落,路由器未见候选。',
    trigger: { id: '16', text: '推销机器人:点击领取优惠券!!!', human: false, bot: 'spam-bot' },
    replay: { kind: 'ignore', reason: '名单外 bot', byGate: true },
  },

  // ── stop:应停止(4) ─────────────────────────────────────────────────────
  {
    id: 'RG-17', kind: 'stop',
    why: '名单内发送者对准 agent 的明确停止指令 → stop 结束该工单(只有人的 stop 撤销授权)。',
    trigger: { id: '17', text: '@bot 先别修了,登录回归那个工单停掉' },
    setup: { id: 's17', text: '@bot 修复登录回归' },
    replay: { kind: 'stop', reason: '名单内发送者要求停止' },
  },
  {
    id: 'RG-18', kind: 'stop',
    why: 'stop 带后续指示:本条只裁决停止;「等设计定稿再开」是余文,不自动开工(dispatch:stop 后余文可作为新工作另行 accept)。',
    trigger: { id: '18', text: '@bot 停掉设置页那个工单,等产品设计定稿再开' },
    setup: { id: 's18', text: '@bot 改设置页布局' },
    replay: { kind: 'stop', reason: '明确停止;余文为将来的新工作,不在本次裁决' },
  },
  {
    id: 'RG-19', kind: 'stop',
    why: 'worker 已报 blocked 后人仍明确要求停:worker 的 blocker 不是 stop 的理由,人的明确 stop 才是 → stop。',
    trigger: { id: '19', text: '@bot 不等审阅了,那个导出工单直接停掉' },
    setup: { id: 's19', text: '@bot 实现导出功能' },
    replay: { kind: 'stop', reason: '人明确停止,优先于 blocked 状态' },
  },
  {
    id: 'RG-20', kind: 'stop',
    why: '负判例:工单已结束(ready),stop 无对象 → 裁决退化为 ignore(stopUnknown);已结束工单无可停。',
    trigger: { id: '20', text: '@bot 登录回归那个工单停掉' },
    setup: { id: 's20', text: '@bot 修复登录回归', ready: true },
    replay: { kind: 'stop', reason: '对已结束工单的停止指令' },
  },
]
