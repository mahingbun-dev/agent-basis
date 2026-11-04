# T22 全功能 E2E 验收报告(agent-basis × DSH Web)

- 日期:2026-11-04 20:34–21:20(Asia/Shanghai)
- 验收人:验收总管(agent)
- 环境:DSH Web `http://127.0.0.1:3080`(重启后新 token,自 `/tmp/basis-web-app.log` 取;浏览器以 `http://localhost:3080/` 会话态访问),宿主工作区 `/tmp/basis-ws`(dsh cwd),记忆库 `/tmp/basis-ws/.basis/memory.sqlite3`
- 驱动:ego-browser v2.1.0(TaskSpace `basis acceptance e2e` id=45,Page `p1`),脚本 `~/ego/basis-acceptance-20261104-2100/round-01.mjs … round-22.mjs`(每轮完整新文件;断言失败即 `process.exit(1)`,本报告如实记录全部 exit 1 事件)
- 断言口径(严格铁律):所有断言落在**结构化证据**——「轨迹」标签工具行 `→` 之后的输出 JSON 特征字段(按工具名过滤行,与用户消息回显/侧栏历史隔离)、审批卡片 aria 按钮、`data-basis-panel*` DOM 锚点、sqlite 存储层行、文件字节比对;**全程零** `body.innerText.includes(工具名)` 类全文断言

## 总裁决计数

**PASS 22 / FAIL 0 / BLOCKED 0**(22 = 逐子断言数,见下表;七大项 A–G 全部 PASS;T0/T1/T3 相关项 E/F 均实际执行通过,无受阻项)

## 逐项裁决表(项 / 断言 / 裁决 / 证据摘要)

| 编号 | 断言 | 裁决 | 证据摘要 |
|---|---|---|---|
| A1 | memory_write 作用域输出含 `"ok"` | **PASS** | 轨迹工具行输出 `{ "ok": true, … }` |
| A2 | 作用域断言输出含 `entity:`(出处锚点) | **PASS** | memory_search 输出 `"source": "entity:e2e:acc/acceptance-e2e#3"` |
| A3 | memory_search 命中 e2e:acc | **PASS** | 输出 `"count": 1`,hit title `e2e:acc/acceptance-e2e` |
| A4 | sqlite 存储层出现该行(双证据) | **PASS** | `/tmp/basis-ws/.basis/memory.sqlite3` 表 `memory_entity` id=3 行在场 |
| B1 | knowledge_status 含 wiki-local | **PASS** | 输出 `{"id": "wiki-local", "ok": true, …}` |
| B2 | knowledge_propose 输出为提案态 | **PASS** | 输出 `proposal_id` + `"state": "pending"` |
| B3 | 不直接发布(fail-closed) | **PASS** | 反向断言:无 `published/approved/已发布` 特征;note 明示「未过审内容不会出现在检索结果中」 |
| C1 | @event R3 触发**审批卡片**(aria/按钮「拒绝/允许」) | **PASS** | budget_change 调用后出现 aria 按钮 `允许一次` 与 `拒绝` |
| C2 | 点「允许」→ 输出含 allowed-once | **PASS** | `"approvalOutcome": "allowed-once"` |
| C3 | 再跑一次 → 审批卡片再现 | **PASS** | 第二次 budget_change 后同款按钮组再现 |
| C4 | 点「拒绝」→ rejected | **PASS** | 轨迹行 `Error: the user rejected tool "budget_change"`,卡片消失 |
| C5 | pay_deposit 路径同闭环(补测) | **PASS** | 卡片再现;允许后 `"kind": "payment-request", "amountCny": 59400, "approvalOutcome": "allowed-once", "executed": false` |
| D1 | budget_calc 输出 "budget-breakdown" | **PASS** | `"kind": "budget-breakdown"` |
| D2 | budget_calc 输出 59400 | **PASS** | `"totalCny": 59400` |
| D3 | schedule_conflict_check 含 overlap/conflict 特征字段 | **PASS** | `"overlaps": [ { "a": "主论坛", "b": "午宴", "overlapMinutes": 30 } ]` |
| E1 | 面板区块①服务清单渲染 | **PASS** | `[data-basis-panel-section="services"]` 可见,`card`×4 |
| E2 | 面板区块②操作指引渲染 | **PASS** | `[data-basis-panel-section="guide"]` 可见,`data-basis-panel-prompt`×7 |
| E3 | 面板区块③可观测样例渲染 | **PASS** | `[data-basis-panel-section="observability"]` 可见,含 session token/缓存命中率 |
| F1 | 发现标签页搜 basis 见条目 | **PASS** | 列表含「基座组合层 Glue」(@basis/glue 0.0.0,描述含 `@basis`) |
| G1 | USER-GUIDE 与 SKILL.md 存在 | **PASS** | 两文件均在(12661 / 12800 字节) |
| G2 | 内容对齐 | **PASS** | 按头部声明契约去头后正文 7849 字符逐字节相等 |
| G3 | 关键内容锚点在场 | **PASS** | 13 触发小节 + wiki-local/budget-breakdown/allowed-once/entity:/plugin_market/install_bundle/raw URL/dsh-evals/aievo-run |

## 逐项详细证据(命令 + 输出原文关键行)

### A. memory(写入 / 检索 / 存储三层)— 裁决:**PASS**

操作:新建会话发送 `请用 memory_write 写入一条实体记忆:subject=e2e:acc、key=acceptance-e2e,内容「E2E 验收写入 2026-11-04」…`;随后发送 `请用 memory_search 搜索「e2e:acc 验收」…`(round-07/09)。

作用域隔离方式:`page.evaluate` 取「轨迹」表 `tr[role=row]` 行文本,过滤 `startsWith('工具') && includes('<工具名>')`——工具行 = 工具名+参数+`→`+输出 JSON,天然排除用户回显与侧栏。

- A1/A2/A3 轨迹工具行输出原文:
  - `工具 memory_write{"subject":"e2e:acc","key":"acceptance-e2e",…} → { "ok": true, "subject": "e2e:acc", "key": "acceptance-e2e", "id": 3, "confidence": 0.8, "validAt": 1793795998347, "hint": "撤销用 memory_forget(subject, key):应用逆闭包真删" }`
  - `工具 memory_search{"query":"e2e:acc 验收"} → { "ok": true, "query": "e2e:acc 验收", "count": 1, "hits": [ { "source": "entity:e2e:acc/acceptance-e2e#3", "kind": "entity", "title": "e2e:acc/acceptance-e2e", "summary": "E2E 验收标记" } ] }`
  - `entity:` 锚点口径说明:工具契约里 `entity:` 出处锚点定义在 memory_search 命中(`packages/memory/src/memory.ts:121`,`source: entity:${subject}/${key}#${id}`);memory_write 自身输出为 ok/subject/key/id/hint(无 entity: 字样)。任务 A 所列「ok 与 entity:」在本组作用域断言中分别由上述两条工具输出命中,均为结构化字段断言。
- A4 存储层双证据(sqlite3 CLI 原样输出):
  ```
  $ sqlite3 /tmp/basis-ws/.basis/memory.sqlite3 "SELECT id, subject, key, content, summary, confidence, invalid_at FROM memory_entity WHERE subject='e2e:acc';"
  3|e2e:acc|acceptance-e2e|E2E 验收写入 2026-11-04|E2E 验收标记|0.8|
  ```
  任务给的候选路径之二(仓库 `/Users/…/agent-basis` 下)无 `.basis/` 目录(实测 `ls` 不存在)——存储按插件默认 `join(cwd,'.basis/memory.sqlite3')` 落在宿主 cwd `/tmp/basis-ws`(`packages/glue/src/plugins/memory-plugin.ts:26-27`),即两候选路径中实际在场者,断言以其为准。
- 过程记录(如实):round-09 首跑 **exit 1**,失败原文 `A_ASSERTIONS_FAILED: [ 'memory_write 输出缺 "ok": true', 'memory_write 输出缺 subject "e2e:acc"' ]`——原因是断言脚本行过滤条件 `'memory_write '`(带尾随空格)与 innerText 实际形态 `memory_write{`(工具名与参数 JSON 间无空格)不符,**属验收脚本缺陷非产品缺陷**;round-10 修正过滤条件后同一轨迹行断言 PASS。memory_search 断言首跑即命中。

### B. knowledge(status / propose fail-closed)— 裁决:**PASS**

操作:发送「依次执行两步:1) knowledge_status;2) knowledge_propose 提案(title=e2e-acceptance-proposal)」(round-11)。轨迹工具行输出原文:

- B1:`工具 knowledge_status{} → { "ok": true, "backends": [ { "id": "wiki-local", "ok": true, "doc_count": 0, "capabilities": { "write": true, "deprecate": true, "graph": true } } ] }`
- B2/B3:`工具 knowledge_propose{…} → { "ok": true, "proposal_id": "prop-2026-11-04T12:42:40.479Z-1", "backend": "wiki-local", "state": "pending", "note": "提案已记录,等待 governance 门禁评审;未过审内容不会出现在检索结果中" }`
  - 提案态特征:`proposal_id` + `"state": "pending"`(工具输出 schema `enum: ['pending']`,`packages/knowledge/src/tools.ts:257`)
  - fail-closed 反向断言:输出无 `published/approved/已发布` 任何特征 → 未直接发布

### C. governance 审批交互闭环(允许 + 拒绝,两轮都要)— 裁决:**PASS**

- C1/C2 第一轮(round-12/13):发送 `请用 budget_change 起草预算变更:基数 198000 元调整为 225000 元…`
  - 审批卡片出现:evaluate 定位 `button` 的 aria-label/innerText → `允许一次` 与 `拒绝`(任务要求的「拒绝/允许」类 aria 元素,非全文匹配)
  - 点「允许一次」后,轨迹 budget_change 行输出原文:`{ "ok": true, "kind": "budget-change-request", "baseBudgetCny": 198000, "newBudgetCny": 225000, "overrunCny": 27000, "overrunRatio": 0.1364, "isR3Overrun": true, "reason": "E2E 验收测试", "riskLevel": "R3", "approvalRequired": true, "applied": false, "note": "R3 高危动作:必须经宿主审批(allowed-once)后由财务/授权人执行;本工具只出申请单,不执行付款/不改预算。", "approvalOutcome": "allowed-once", "appliedAfterApprovalBy": "授权人按申请单执行预算表变更" }` → **allowed-once**
- C3/C4 第二轮(round-14):发送 `再执行一次:budget_change 225000→260000…`
  - 审批卡片再次出现(同款 aria 按钮组,程序化复检)
  - 点「拒绝」后,轨迹行原文:`工具 budget_change{"baseBudgetCny":225000,"newBudgetCny":260000,"reason":"E2E 验收测试第二轮"} → Error: the user rejected tool "budget_change"`;「允许一次」按钮剩余数=0(卡片已消费);助手文本确认「被拒的是这次 budget_change 调用本身…没有生成任何申请单」→ **rejected**
- C5 pay_deposit 路径补测(round-21/22):发送 `请用 pay_deposit 起草定金申请:合同 198000 元、定金比例 30%…`
  - 审批卡片同样出现(允许一次/拒绝)
  - 点「允许一次」后输出原文:`{ "ok": true, "kind": "payment-request", "amountCny": 59400, "currency": "CNY", "payee": "示例供应商", …, "riskLevel": "R3", "approvalRequired": true, "executed": false, "executor": "finance-officer", "note": "R3 高危动作:…本工具只出申请单,不执行付款/不改预算。", "approvalOutcome": "allowed-once", "paymentExecutedBy": "finance-officer(审批通过后)" }`
  - 即任务点名的两个触发器 `pay_deposit` 与 `budget_change` **双双实测闭环**(任务要求「或」,本验收两个都测)

### D. @event 只读工具 — 裁决:**PASS**

操作:发送「依次执行两个工具:budget_calc 计算 198000 元的 30%;schedule_conflict_check 校验时间线…」(round-15)。轨迹工具行输出原文:

- D1/D2:`工具 budget_calc{…} → { "ok": true, "kind": "budget-breakdown", "lineTotals": [ { "item": "30% 计提(基数 198,000 元)", "quantity": 1, "unitPriceCny": 59400, "subtotalCny": 59400 } ], "totalCny": 59400, "baseBudgetCny": 198000, "overrunCny": -138600, "overrunRatio": -0.7, "isR3Overrun": false, "hint": "超支>5% 属 R3:…" }`
- D3:`工具 schedule_conflict_check{…} → { "ok": false, "kind": "schedule-check", "segmentCount": 4, …, "invalid": [], "overlaps": [ { "a": "主论坛", "b": "午宴", "overlapMinutes": 30 } ], "outOfWindow": [], "hint": "存在冲突:必须先消除 invalid/overlaps/outOfWindow 再交付。" }`

### E. 基座面板三区块(T1)— 裁决:**PASS**

操作:点侧栏「基座面板」,`page.evaluate` 探测结构化锚点(round-16):

- E1 `[data-basis-panel-section="services"]`:present/visible,标题「服务清单」,`[data-basis-panel="card"]`×4(governance/memory/knowledge/@event),文本 389 字符(治理规则数、记忆实体数、最近 key 列表)
- E2 `[data-basis-panel-section="guide"]`:present/visible,标题「操作指引」,`[data-basis-panel-prompt]`×7(memory-write/memory-search/memory-forget/knowledge-search/knowledge-propose/budget-calc/pay-deposit-redline,与 `packages/panel/src/prompts.ts` 七 id 一致)
- E3 `[data-basis-panel-section="observability"]`:present/visible,标题「可观测样例」,含 session 轮次/输入输出 token/缓存读/缓存命中率 98.4% 数据
- 断言规则:三区块均要求 `present && visible && innerText ≥ 10 字符`,任一不满足即 FAIL

### F. 发现页搜 basis(T3)— 裁决:**PASS**

操作:点「插件」→ tablist「插件视图」切「发现」tab → 搜索框填 `basis`(round-17/18/19/20)。断言(限 `[role="tabpanel"]` 内 `li`):

- 搜索结果非空,条目原文:`基座组合层 Glue | 组合层 bundle:把 @basis 的 memory/knowledge/governance 服务装配为真实 DSH 宿主可挂载的插件。 | 0.0.0 · 2026年11月4日 | 已安装`(同列「活动策划领域包 @event/pack 0.1.0」)
- 条目含 `@basis`/基座特征 → 搜索命中成立;索引源为发现页所示自定义索引「Agent Basis 基座插件」(commit 805eecf 起指 raw.githubusercontent 长期源)

### G. 指引文件(USER-GUIDE / SKILL.md)— 裁决:**PASS**

文件断言(node 严格比对,round 外 shell 执行):

- G1 存在:`docs/USER-GUIDE.md`(12661 字节)、`~/.agents/skills/agent-basis-guide/SKILL.md`(12800 字节),mtime 2026-11-04 20:32
- G2 内容对齐:对齐口径取**两文件头部各自声明的契约**——USER-GUIDE 头部注释(1–5 行)「正文逐字节一致,仅头部来源说明不同…由 SKILL.md 去掉 YAML frontmatter 生成本文件」。按此契约:USER-GUIDE 去头部 HTML 注释、SKILL 去 YAML frontmatter 后,正文 **7849 字符逐字节相等**(`guideBody === skillBody` 严格相等)
- G3 关键锚点:frontmatter `name: agent-basis-guide`;触发示例 `### N.` 小节 13 个(≥8);关键词 `wiki-local`/`budget-breakdown`/`allowed-once`/`entity:`/`plugin_market`/`install_bundle`/`raw.githubusercontent.com`/`dsh-evals`/`aievo-run` 全部在场
- 过程记录(如实):首轮断言脚本 **exit 1**,失败原文 `G_FAILED: USER-GUIDE 与 SKILL 正文非逐字节同源(len 8005 vs 7849); USER-GUIDE 缺关键词: plugin-market`——两处均为**断言口径错误**(整文件逐字节比对未扣除文档自述的头部来源说明;关键词拼写臆断为 `plugin-market` 而文档实际作 `plugin_market`),非产品缺陷;按文件声明契约修正后同口径复跑 PASS。失败原文在此保留,未删除。

## verify 门禁(与本次验收相关包,全部实跑)

| 包 | 命令 | 结果 |
|---|---|---|
| @basis/governance | `pnpm --filter @basis/governance run verify` | exit 0(vitest 74/74) |
| @basis/memory | `pnpm --filter @basis/memory run verify` | exit 0(vitest 80/80) |
| @basis/knowledge | `pnpm --filter @basis/knowledge run verify` | exit 0(vitest 76/76) |
| @basis/glue | `pnpm --filter @basis/glue run verify` | exit 0(oxlint 0 错 0 警;该包无单测文件,`No test files found, exiting with code 0` 属预期) |
| @basis/panel | `pnpm --filter @basis/panel run verify` | exit 0(vitest 25/25) |
| @event/pack | `pnpm -C packs/event-planning run verify` | exit 0(packctl lint + node test 40 pass / 0 fail) |

## ego 脚本清单(~/ego/basis-acceptance-20261104-2100/,共 22 轮)

round-01/02 打开应用(127.0.0.1 load 超时→localhost domcontentloaded 成功);03–07 新建会话+memory_write 发送+输入框与消息 DOM 探测;08 轨迹标签结构确认;09/10 A 断言(09 首跑 exit 1 记录在案);11 B 断言;12–14 C budget_change 两轮闭环;15 D 断言;16 E 面板断言;17–20 F 发现页断言;21/22 C5 pay_deposit 补测闭环。
