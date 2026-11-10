# @basis/prompt-studio(T7.1)契约笔记

> 面向 T7.2(浏览器半边)/T7.3(导入导出与回滚体验)/T7.4(trace 升级)的接口与
> 事实笔记。权威线类型:packages/prompt-studio/src/types.ts(线上载荷唯一事实源)。

## 1. 端点契约(Typert SRC;namespace = `loopPrompt`)

全部经官方 `dsh-api-gateway` SRC 模式暴露,result mode = `src-json`(纯 JSON 返回)。
SRC 参数绑定按运行时形参名:所有带参端点参数名一律 `input`,wire 载荷
`payload.args = { input: { … } }`;无参端点 `payload.args = {}`。

| 端点 | 入参 | 出参 |
| --- | --- | --- |
| `loopPrompt/snapshot` | 无 | `LoopPromptSnapshot { generatedAt, persona, versions, pendingApproval, trace{sessions, pipeline, recent[]}, channel{kind:'A-patch-hmr',note} }`;T7.4 起 `trace.recent` = 最近 20 条会话清单(id/标题/时间/轮次/usage,与 trace 列表同投影),`trace.sessions` 数 = recent 长度 |
| `loopPrompt/trace` | `{ sessionId?, limit? }` | `TraceReport { generatedAt, sessionsRoot, pipeline, sessions[], selected }`;无 sessionId → 最近会话列表(默认 20),有 → `selected: SessionTrace`(其余 sessions=[]) |
| `loopPrompt/prompt-get` | 无 | `PromptGetResult { persona, versions, effectiveNote, composedNote }` |
| `loopPrompt/prompt-save` | `{ content, baseVersionId?, summary?, author?, approvalId?, approved? }` | `PromptSaveResult { status, issues?, approval?, version?, effectiveNote }` |
| `loopPrompt/prompt-versions` | `{ limit? }`(默认 50) | `VersionsResult { total, ready, versions[] }`(versions 新→旧) |
| `loopPrompt/prompt-rollback` | `{ versionId(必填), baseVersionId?, summary?, author?, approvalId?, approved? }` | `PromptRollbackResult`(同 save 形态) |
| `loopPrompt/prompt-export` | `{ versionId?, exportedBy? }`(缺省=最新) | `PromptExportResult { pack{schemaVersion:1,exportedAt,exportedBy,sourceVersionId,persona,checksum}, version }`(只读,不走审批) |
| `loopPrompt/prompt-import` | `{ pack, summary?, author?, approvalId?, approved? }` | `PromptImportResult`(同 save 形态) |

关键共享类型:

- `PersonaState { available, text, bytes, patchPath, updatedAt, error }`
- `VersionOverview { ready, count, latestId, latestAt }`
- `PromptVersionRecord { id, seq, createdAt, author, source, parentId, bytes, checksum, summary, content }`
  - `source ∈ initial | save | rollback | import`;`parentId`:回滚=被回滚版本,保存/导入=写前最新版本,首版 null
  - `checksum` = sha256 hex(UTF-8 口径;导出包同口径,导入强校验)
- `WriteStatus = approval-required | committed | rejected | approval-declined | approval-mismatch | storage-unavailable`
- `WriteApprovalView { approvalId, kind, card: ApprovalCard, questionItems: AskUserQuestionItem[] }`

### 写链路两段式(R3;save/rollback/import 共用)

1. 第一段(无 `approvalId`):校验器(T7.3 全集:非空/UTF-8 合法/≤64KB/红线段
   三条锚点;回滚豁免内容校验,见 §4)→ diff 非空 → 乐观锁(可选
   `baseVersionId` 对比最新版本)→ 生成 R3 审批卡(`@basis/interact`
   buildApprovalCard,ruleId `basis.prompt-studio.persona-write`,doubleConfirm →
   2 个 questionItems)→ 返回 `status='approval-required'`,**不落盘**。
2. 第二段(带 `approvalId` + `approved: true`):
   - **必须回显同内容**(TOCTOU 防线):save 回显 `content`;rollback 回显
     `versionId`;import 回显同一 `pack`。不符 → `approval-mismatch`。
   - 通过 → patch 原子写(写前 YAML 解析自检 `selfCheckNextPatchText` + 写后宿主内
     `dsh --dump-config` 干跑自检,失败自动还原/零磁盘改动,见 §4)
     → 版本追加 → 审计 committed → `status='committed'` + 新版本记录。
   - `approved: false` → `approval-declined`,无副作用。
3. `rejected` 携带 `issues[]`(人话校验明细);在途审批未决时再次第一段会替换旧卡。

### 版本库(只增不删)

- 存储:DSH storage 栈 json backend kv 单元 `basis_prompt_studio`(per-record,表
  `versions`),盘面 `<DSH_HOME>/storages/basis_prompt_studio/versions/<id>.json`
  一文档一记录;单写者 promise 链串行化(读也上链)。
- 无删除原语;回滚=追加新记录。挂载经官方 inject seam
  (`storage.backend.json` 服务键),未挂载时 snapshot 降级 `versions.ready=false`、
  写端点抛 `gateway/bad-request`。
- 首次挂载种子 `source='initial'` v1(内容=patch 层当前 persona,空则不种)。

### 审计(G5)

`ctx.governance.audit.reportGovernance` 存在则上报 glue;否则兜底
AuditProjector+FileAuditSink 写 `<DSH_HOME>/basis-prompt-studio/audit.jsonl`
(NDJSON,包络 `{kind:'governance', at, detail:{…}}`,detail 含
`system:'basis-prompt-studio'`/`action`/`operator`/`versionId` 等——每条写事件
带操作者与版本号)。

## 2. 装载事实(smoke 实证,scripts/t7-smoke.mjs)

- **peerDependencies 不能用 `catalog:`**:宿主兼容门把 peer 声明当 semver range
  校验,`catalog:` 不是合法 range → 行被强制 disabled("Plugin … is incompatible
  with dsh 0.2.2-rc.1: requirements …")。本包与 panel/glue/governance/interact
  同款:**dsh 家族依赖一律放 `dependencies` + `catalog:`**,不声明 peerDependencies。
- **网关调用接收者是 fork-shadow**:`receiverContext.extend({invocation}).get(service)`
  可返回原型链 shadow(原型=实例)。端点类(LoopPromptGateway)的状态与方法必须
  全部 public——私有槽(`#field`)在 shadow 上读取即抛
  "Cannot read private member …"。panel 网关零实例状态正是该约束的既有配方。
  未打 Remote 标记的公开方法对网关不可见,不构成额外端点。
- **装载 = symlink 终态**:`profile/node_modules/@basis/prompt-studio → repo 源树`。
  §4 配方的 `pnpm add file:` 一步对本包不可行(workspace:* deps + catalog: peers
  被 pnpm v11 在隔离 profile 拒载,已实测两种报错;把 repo 包声明成 profile
  workspace 成员会反向接管 packages/ 其他包的 node_modules)。Loader 按组合行名经
  node_modules 解析 + realpath 落 repo 工作区;dsh-client-modules 扫 Loader 条目的
  包清单——两个消费方都不读 profile 依赖表。
- 版本库幂等清场 = 删 `<home>/storages/basis_prompt_studio/`(smoke 每轮先清)。
- smoke 断言(38 项 → **54 项**,exit 0 可重复;2026-11-11 T1.4 读侧按条目泛化
  扩 16 项,基线只增不减):pluginInventory 行 enabled+active、启动与
  HMR 后日志无 skipping/incompatible、snapshot/prompt-get/versions/trace、
  save/rollback 两段式全链、盘面单元目录、审计 G5 字段;T1.4 新增——snapshot
  entries[] 注册表全景、prompt-get/prompt-versions {entryId} 三型采样(块标量
  plan-mode `|` 值与 dump-config 组合树一致 / 领域 personaPrefix `>-` 与 pack
  文件逐字一致 / time-context 只读型「上游运行时生成」标注)、未知 entryId
  not-found 明示、persona per-entry 与旧口径互证、跨条目回滚 fail-closed、
  磁盘文档 entryId 分链对账(persona 链 3 + 六条目链首各 1 = 9 文档)。
- **已知过渡限制(T1.4 评审 2026-11-11)**:写通道(回滚/导出包)仍是 persona
  单口径——`prompt-rollback {versionId}` 与 `prompt-export {versionId}` 对
  `entryId !== preset.standard.persona` 的版本 fail-closed 拒绝(回滚拒绝/
  导出 badRequest)。原因:回滚按设计跳过内容校验,跨条目目标会把领域/plan 文本
  绕过红线校验写进 persona 前缀行(污染全部标准会话);导出包 schemaVersion=1
  是 persona 口径。按条目写链路(回滚/导出/保存)随 **T1.6** 泛化落地;T1.5
  前端接按条目版本列表时,对非默认条目的回滚入口应隐藏或提示「待 T1.6 支持」。

## 3. T7.2 接入要点

- 客户端 bundle:`lib/client.js`(esbuild CJS,`scripts/build-client.mjs` 产物,
  banner 带 `__ModuleLoader__.load({ id: "@basis/prompt-studio", … })`);占位
  `src/client/index.ts` 待替换。构建纳入 `verify`。
- 端点调用走 `ctx.connection.rpc`,载荷见 §1;写链路 UI 义务:
  1) 渲染 `approval.card` + `questionItems`(R3 双问)→ 2) 用户确认后带
  `approvalId+approved+原内容回显` 重发 → 3) `committed` 后按 `effectiveNote`
  提示「新会话生效,8s 级等待/轮询 HMR」。乐观锁:`prompt-versions` 取最新
  `versions[0].id` 作 `baseVersionId` 传入。
- UI 只用官方语义令牌;审批卡 detail 已是渲染好的 markdown
  (`card.renderedDetail`)。

## 4. T7.3 版本管理(校验器全集 / diff / 导出 / 导入 / 不可删)

### 校验器全集(`src/validator.ts`;vitest 逐条钉住,tests/validator-diff.test.ts)

| 规则 | 口径 | 拒收文案(人话) |
| --- | --- | --- |
| 非字符串 | typeof string | 「persona 内容必须是字符串」 |
| 非空 | trim 后非空 | 「persona 内容不能为空(全空白亦视为空)」 |
| UTF-8 合法 | 无孤立代理项( lone surrogate )——编码到 UTF-8 会被静默替换成 U+FFFD,checksum/字节口径漂移 | 「persona 含无法无损编码为 UTF-8 的孤立代理项(位置 n,U+XXXX)…拒收」 |
| ≤64KB | 65536 UTF-8 字节(agent-instructions maxBytes 口径) | 「persona 内容超出上限:n 字节 > 65536 字节」 |
| 红线段必须存在 | 三条锚点(宽容正则,措辞可改语义锚点必须在):预算不超支 `/预算.{0,6}超支/`、不代付 `/不.{0,2}代付/`、比选中立 `/比选.{0,6}中立/`,对齐 packs/event-planning/persona.md「全局硬约束」 | 「缺少红线段「预算不超支」:…」逐条给出 |
| diff 非空才可保存 | `diffLines(before, after).isEmpty`(写链路 handleWrite 把守,非本模块) | 「diff 为空:新内容与当前 persona 完全一致…」 |

- 红线锚点对齐事实源有交叉钉住:tests/validator-diff.test.ts 直读
  packs/event-planning/persona.md 跑 `validatePersonaText` 必须通过。
- **红线只把守「新文本进入」(save/import);回滚豁免**:rollback 的 content 是
  版本库存量记录逐字恢复,不过内容校验——否则「回滚到无红线的历史基线(含
  initial 种子)」被永久锁死,违背「初始版本永久保留」的逃生门语义。
  这也是 smoke 门禁(scripts/t7-smoke.mjs)回滚到 MARKER 基线仍须 committed 的原因;
  对应地,smoke 的 save fixture(v2)已带三条红线锚点。

### 导出包校验(`src/export-pack.ts` validateExportPack)

- pack 非 JSON 对象(含数组)/`schemaVersion !== 1`/缺 `persona`/缺 `checksum`
  → 逐条 issue 拒收;`sha256hex(persona) !== checksum` → 「校验和不符:期望…实际…」拒收。
- 包层放行 ≠ 写入放行:persona 文本还要过 validatePersonaText 全集(同一套校验)。
- 导出端点只读不走审批;pack 形状 `{schemaVersion:1, exportedAt, exportedBy,
  sourceVersionId, persona, checksum}`。

### 前端版本管理(T7.3 UI;src/client/StudioPage.tsx)

- 版本对比:每行「与上一版对比」→ `lineDiffOps`(`src/diff.ts`,LCS 全表回溯 +
  MAX_OPS_CELLS=1e6 兜底整块 del+add)逐行投影 `+新增/−移除`,锚点
  `data-t7-diff*`;计数口径与 diffLines 一致(单测钉住)。
- 导出:「导出最新版本」(`data-t7-export-latest`,versionId 缺省)或每行
  「导出」(`data-t7-export-btn`)→ `loopPrompt/prompt-export` → Blob+`<a download>`
  下载 `persona-v<seq>-<id>.json`;只读不走审批。
- 导入:`<input type=file>`(`data-t7-import-input`,本地只做 JSON 形状预检)→
  `loopPrompt/prompt-import` 两段式(第二段原样回传同一 pack)→ R3 审批 →
  `source='import'` 新版本。
- 回滚入口沿用 T7.2(每行「回滚到此版本」,两段式 R3)。
- **删除操作不存在**:UI 无删除入口(不可删断言在 tests/client-bundle.test.ts:
  bundle 无 prompt-delete/data-t7-delete/删除版本);宿主 PromptVersionStore 原型
  方法面钉死为 `append/close/ensureInitial/get/list`(tests/version-governance.test.ts),
  无任何删除原语,initial 版本在任何写链路后仍在。

### 保存链路纪律(T7.3 ⑦,src/persona-patch.ts)

单写者 promise 链 → 语义等价短路 → **保存前 YAML 解析自检**
(`selfCheckNextPatchText`:行数不变/仅 prefix 行变更/新 prefix 行经
unquoteYamlScalar 反引逐字还原目标 persona——零依赖;失败即抛,此时零磁盘改动)
→ 备份(copyFile)→ 原子写(tmp+fsync+rename)→ 宿主内 `dsh --dump-config`
干跑(全文档级解析兜底)→ 失败自动还原。write-failed 审计与
RemoteError(gateway/bad-request)文案为「现值未变:写前自检拦截或已自动还原」。

## 5. T7.4 运行态轨迹管线(src/trace.ts;vitest 快照钉死,tests/trace.test.ts)

- **数据源与事件口径**(官方 SessionEventMap,0.2.2-rc.1 实证):
  `turn/start{turn}`、`turn/end{turn,reason{kind}}`(kind ∈ completed/aborted/
  blocked/error/max-tokens/interrupted/forked,merge-extensible)、
  `tool/call{turn,step,callId,name,arguments(原始 JSON 串)}`、
  `tool/result{turn,step,message{toolCallId,isError},error?{name,code}}`、
  `assistant/message{turn,step,message,usage?,interrupted?}`(usage 在 data 层,
  与 message 平级)、`approval/asked{id,toolName,callId?,reason?}` /
  `approval/decided{id,outcome}`(@deepseek-ai/dsh-user-approval,outcome ∈
  allowed-once/rejected/cancelled/unavailable)、`session/title{title,source}`、
  容器头行 `type:'session'`(无 data 字段)。
- **投影规则**:审批点 = `approval/asked` 审计事件(ask_user_question 是普通
  工具调用,只出现在 tools,不再充当审批点——T7.4 起);asked 不带 turn,归轮
  顺序 = callId 对上某轮工具调用 > 最近一个 turn/start > 0 号未知节点;
  decided 同 id 配对,补 `outcome/decidedAt`(未配对不计 projected);
  `reasoningPreview` = 最后一条携带 reasoning 块(type='reasoning',dsh-llm
  ContentBlockMap)的 assistant 消息,拼接后截断 240。
- **容错(钉死口径)**:坏行计 skipped;缺 turn 落 0 号未知节点;缺起止
  durationMs=null;无标题会话 title='';未折叠事件与容器头行不计 projected 也不计
  skipped;无任何可解码帧(缺失/空/损坏)→ 列表跳过、详情 null;一律不抛错。
- **大文件防御**:只读文件尾部窗口(默认 8MB,`TraceReadOptions.maxLogBytes`
  可注入);位置式读,窗口起点可能切进帧中间——帧扫描带魔数重同步(indexOf
  0x28B52FFD 后重走查),只投影窗口内整帧,计数反映窗口;zstd 坏帧跳过。
- **真实日志 fixture**:tests/fixtures/t7-session-fa97514a-sanitized.jsonl ←
  T7.0 spike 真实会话(session.v4.jsonl.zstd,29 行/两轮)经
  scripts/gen-trace-fixture.mjs 脱敏(宿主系统提示/技能目录/工具 schema 长文本
  截断,/Users/sunny → /Users/[user]);type/seq/time/usage/stream 逐字保留,
  投影快照逐字段钉死(durationMs 758/855、usage 10070/2/18520 等)。
- **snapshot 契约增量**:`trace.recent`(最近 20 条 TraceSessionCard,新增
  `title` 字段=最后一条 session/title,provider 精修标题胜出);`trace.sessions`
  数值语义不变(T7.2 Stat 瓦片消费 `String(snapshot.trace.sessions)`)。
