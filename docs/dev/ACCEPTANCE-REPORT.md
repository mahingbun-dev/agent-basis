# T22 全功能 E2E 验收报告(agent-basis × DSH Web)

- 日期:2026-11-04 20:34–21:10(Asia/Shanghai)
- 验收人:验收总管(agent)
- 环境:DSH Web `http://127.0.0.1:3080`(重启后新 token,自 `/tmp/basis-web-app.log` 取;页面实际以 `http://localhost:3080/` 会话态访问),工作区 `/tmp/basis-ws`(dsh 宿主 cwd,记忆库 `/tmp/basis-ws/.basis/memory.sqlite3`)
- 驱动:ego-browser v2.1.0(TaskSpace `basis acceptance e2e` id=45,Page `p1`),脚本 `~/ego/basis-acceptance-20261104-2100/round-01.mjs … round-20.mjs`(每轮完整新文件,断言失败 `process.exit(1)`)
- 断言口径(严格铁律):全部落在**结构化证据**上——「轨迹」标签中工具行的输出 JSON 特征字段(`→` 之后的输出,非全页 innerText)、审批卡片 aria 按钮、`data-basis-panel*` DOM 锚点、sqlite 存储层行;未使用任何 `body.innerText.includes(工具名)` 类全文断言

## 裁决总表

| 项 | 内容 | 裁决 | 证据摘要 |
|---|---|---|---|
| A | memory:memory_write `subject=e2e:acc` + memory_search 命中 + sqlite 双证据 | **PASS** | write 输出 `"ok": true, "subject": "e2e:acc", "id": 3`;search 输出 `"source": "entity:e2e:acc/acceptance-e2e#3"`;sqlite `memory_entity` 表 id=3 行在场 |
| B | knowledge_status 含 wiki-local;knowledge_propose 提案态 fail-closed | **PASS** | status 输出 `{"id": "wiki-local", "ok": true…}`;propose 输出 `"proposal_id": "prop-2026-11-04T12:42:40.479Z-1", "state": "pending"`,无发布特征 |
| C | @event budget_change 审批卡片「允许」→allowed-once;再触发「拒绝」→rejected | **PASS** | 卡片按钮「允许一次」「拒绝」(aria 定位);允许后 `"approvalOutcome": "allowed-once"`;拒绝后轨迹 `Error: the user rejected tool "budget_change"` |
| D | @event budget_calc=budget-breakdown+59400;schedule_conflict_check 含 overlap | **PASS** | `"kind": "budget-breakdown", "totalCny": 59400`;`"overlaps": [{"a": "主论坛", "b": "午宴", "overlapMinutes": 30}]` |
| E | T1 基座面板三区块渲染 | **PASS** | `[data-basis-panel-section]` services(4 卡)/guide(7 指引)/observability(session 指标)全在场且可见 |
| F | T3 发现标签页搜 basis 见条目 | **PASS** | 搜 `basis` 后列表含「基座组合层 Glue」(@basis/glue 0.0.0,描述含 `@basis`)与「活动策划领域包」 |
| G | USER-GUIDE 与 SKILL.md 存在且内容对齐 | **PASS** | 两文件存在;按头部声明契约(正文逐字节一致、仅头部来源说明不同)验证:正文 7849 字符逐字节一致;13 触发小节+关键锚点全在场 |

**计数:PASS 7 / FAIL 0 / BLOCKED 0**。T0/T1/T3 相关验收(E 面板=T1、F 发现页=T3 侧)均实际执行且通过,无受阻项。

## 逐项证据(命令 + 输出关键行)

### A. memory(写入/检索/存储三层)

- 操作:新建会话发送 `请用 memory_write 写入一条实体记忆:subject=e2e:acc、key=acceptance-e2e,…`;随后发送 `请用 memory_search 搜索「e2e:acc 验收」…`(round-07/09)
- 作用域隔离断言:`page.evaluate` 取「轨迹」表中 `tr[role=row]` 行内文本,过滤 `startsWith('工具') && includes('memory_write')`(工具行含工具名+参数+`→`+输出 JSON,与用户回显/侧栏隔离):
  - memory_write 行输出:`{ "ok": true, "subject": "e2e:acc", "key": "acceptance-e2e", "id": 3, "confidence": 0.8, "validAt": 1793795998347, "hint": "撤销用 memory_forget(subject, key):应用逆闭包真删" }`
  - memory_search 行输出:`{ "ok": true, "query": "e2e:acc 验收", "count": 1, "hits": [ { "source": "entity:e2e:acc/acceptance-e2e#3", "kind": "entity", "title": "e2e:acc/acceptance-e2e", "summary": "E2E 验收标记" } ] }` → 命中 `e2e:acc`,含 `entity:` 出处锚点
- 存储层双证据(sqlite3 CLI):
  ```
  $ sqlite3 /tmp/basis-ws/.basis/memory.sqlite3 "SELECT id, subject, key, content, summary, confidence, invalid_at FROM memory_entity WHERE subject='e2e:acc';"
  3|e2e:acc|acceptance-e2e|E2E 验收写入 2026-11-04|E2E 验收标记|0.8|
  ```
- 过程记录:round-09 首跑 exit 1,失败原文 `A_ASSERTIONS_FAILED: [ 'memory_write 输出缺 "ok": true', 'memory_write 输出缺 subject "e2e:acc"' ]` ——原因是断言脚本过滤条件 `'memory_write '`(带尾随空格)与 innerText 实际形态 `memory_write{`(工具名与参数 JSON 无空格)不符,**属脚本缺陷非产品缺陷**;round-10 修正过滤后同一条轨迹行断言 PASS。memory_search 断言首跑即 PASS。

### B. knowledge(status / propose fail-closed)

- 操作:同会话发送「依次执行两步:1) knowledge_status;2) knowledge_propose 提案《E2E 验收知识提案》(title=e2e-acceptance-proposal)」(round-11)
- knowledge_status 行输出:`{ "ok": true, "backends": [ { "id": "wiki-local", "ok": true, "doc_count": 0, "capabilities": { "write": true, "deprecate": true, "graph": true } } ] }` → 含 `wiki-local`
- knowledge_propose 行输出:`{ "ok": true, "proposal_id": "prop-2026-11-04T12:42:40.479Z-1", "backend": "wiki-local", "state": "pending", "note": "提案已记录,等待 governance 门禁评审;未过审内容不会出现在检索结果中" }` → 提案态(`proposal_id`+`state: pending`),无 `published/approved/已发布` 特征 → fail-closed 成立(断言含反向检查)

### C. governance 审批交互闭环(允许 + 拒绝两次)

- 第一次(round-12/13):发送 `请用 budget_change 起草预算变更:基数 198000 元调整为 225000 元…`
  - 审批卡片出现:aria 按钮 `允许一次` 与 `拒绝`(evaluate 定位 `button` 的 aria-label/innerText,非全页断言)
  - 点「允许一次」后,轨迹 budget_change 行输出:`{ "ok": true, "kind": "budget-change-request", …, "riskLevel": "R3", "approvalRequired": true, "applied": false, …, "approvalOutcome": "allowed-once", "appliedAfterApprovalBy": "授权人按申请单执行预算表变更" }` → 含 `allowed-once`
- 第二次(round-14):发送 `再执行一次:budget_change 225000→260000…`
  - 审批卡片再次出现(同款 aria 按钮组)
  - 点「拒绝」后,轨迹行:`工具 budget_change{"baseBudgetCny":225000,"newBudgetCny":260000,…} → Error: the user rejected tool "budget_change"`;且卡片消失(剩余「允许一次」按钮数=0),助手文本确认「该调用被拒绝…没有生成任何申请单」→ `rejected` 闭环成立
- 说明:任务允许 `pay_deposit` 或 `budget_change` 任一触发;取 `budget_change`(同为 R3 审批门,且 `pay_*` 在 `packs/event-planning/policies/guard-rules.yml` 中另受 deny 规则管控,`budget_change` 是最纯粹的 ask 门路径)

### D. @event 只读工具(budget_calc / schedule_conflict_check)

- 操作:同会话发送「依次执行两个工具:budget_calc 计算 198000 元的 30%;schedule_conflict_check 校验时间线…」(round-15)
- budget_calc 行输出:`{ "ok": true, "kind": "budget-breakdown", "lineTotals": [ { "item": "30% 计提(基数 198,000 元)", "quantity": 1, "unitPriceCny": 59400, "subtotalCny": 59400 } ], "totalCny": 59400, … }` → `budget-breakdown` + `59400`
- schedule_conflict_check 行输出:`{ "ok": false, "kind": "schedule-check", "segmentCount": 4, …, "overlaps": [ { "a": "主论坛", "b": "午宴", "overlapMinutes": 30 } ], "outOfWindow": [], … }` → `overlaps` 特征字段(主论坛/午宴重叠 30 分钟被点名)

### E. 基座面板三区块(T1)

- 操作:点侧栏「基座面板」(aria-label),`page.evaluate` 探测结构化锚点(round-16):
  - `[data-basis-panel-section="services"]`:标题「服务清单」,`[data-basis-panel="card"]`×4(governance/memory/knowledge/@event),文本 389 字符(含治理规则/记忆实体数/最近 key)
  - `[data-basis-panel-section="guide"]`:标题「操作指引」,`[data-basis-panel-prompt]`×7(memory-write…pay-deposit-redline,与 `packages/panel/src/prompts.ts` 七 id 一致)
  - `[data-basis-panel-section="observability"]`:标题「可观测样例」,含 session 轮次/输入输出 token/缓存命中率(98.4%)数据
- 三区块均 `present && visible && 渲染内容非空` → PASS

### F. 发现页搜 basis(T3)

- 操作:点「插件」→ tablist「插件视图」切到「发现」tab → 搜索框填 `basis`(round-17/18/19/20)
- 断言(evaluate 限 tabpanel 内 `li`):搜 `basis` 后列表非空,条目含「基座组合层 Glue | 组合层 bundle:把 @basis 的 memory/knowledge/governance 服务装配… | 0.0.0 · 2026年11月4日 | 已安装」(文本含 `@basis` 特征)→ PASS
- 索引源:profile 已配置自定义索引(发现页顶部按钮「切换插件索引,当前为 Agent Basis 基座插件」),条目来自 `market/index.json`(commit 805eecf 起指向 raw.githubusercontent 长期源)

### G. 指引文件(USER-GUIDE / SKILL.md)

- 存在:`docs/USER-GUIDE.md`(12661 字节,mtime 2026-11-04 20:32)、`~/.agents/skills/agent-basis-guide/SKILL.md`(12800 字节)
- 内容对齐(按两文件头部各自声明的契约:「正文逐字节一致,仅头部来源说明不同」;USER-GUIDE 头部为 5 行 HTML 来源注释,SKILL 头部为 YAML frontmatter):
  - 去除各自头部后,正文 **7849 字符逐字节一致**(`guideBody === skillBody` 严格相等)
  - frontmatter `name: agent-basis-guide` + description 含基座关键词;触发示例 `### N.` 小节 13 个(≥8)
  - 关键锚点在场:`wiki-local` / `budget-breakdown` / `allowed-once` / `entity:` / `plugin_market` / `install_bundle` / `raw.githubusercontent.com`(长期索引源)/ `dsh-evals` / `aievo-run`
- 过程记录:首轮断言脚本 exit 1,失败原文 `G_FAILED: USER-GUIDE 与 SKILL 正文非逐字节同源(len 8005 vs 7849); USER-GUIDE 缺关键词: plugin-market` ——两处均为**断言口径错误**(整文件比对未扣除文档自述的头部来源说明;关键词拼写臆断为 `plugin-market` 而文档实际为 `plugin_market`),非产品缺陷;按文件声明的契约修正后 PASS。报告如实保留首次失败原文。

## verify 门禁(与本次验收相关包)

| 包 | 命令 | 结果 |
|---|---|---|
| @basis/governance | `pnpm --filter @basis/governance run verify` | exit 0(vitest 74/74) |
| @basis/memory | `pnpm --filter @basis/memory run verify` | exit 0(vitest 80/80) |
| @basis/knowledge | `pnpm --filter @basis/knowledge run verify` | exit 0(vitest 76/76) |
| @basis/glue | `pnpm --filter @basis/glue run verify` | exit 0(oxlint 0 错 0 警;包无单测文件属预期) |
| @basis/panel | `pnpm --filter @basis/panel run verify` | exit 0(vitest 25/25) |
| @event/pack | `pnpm -C packs/event-planning run verify` | exit 0(packctl lint + node test 40 pass / 0 fail) |

## ego 脚本清单(~/ego/basis-acceptance-20261104-2100/)

round-01/02 打开应用(127.0.0.1 超时→localhost 成功);03–07 新建会话+memory_write 发送+输入框/DOM 探测;08 轨迹标签结构确认;09/10 A 断言;11 B 断言;12–14 C 审批闭环;15 D 断言;16 E 面板断言;17–20 F 发现页断言。
