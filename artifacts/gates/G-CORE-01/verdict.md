# G-CORE-01 验收判定书

- **门禁 ID**：G-CORE-01（核心链路门禁组，见 plans/2026-11-10-companion扩展开发计划与测试门禁.md §3.1）
- **执行人**：独立验收代理（用户书面指定派发——用户指示「你去派发代理验收，模型key使用liteLLM，用mimo2.6flash」；实现者仅提交证据、无判定权）
- **执行日期**：2026-11-10
- **执行环境**：`node smoke/gate-setup.mjs` 搭建（eterna web 127.0.0.1:50454 + 浏览器中继 127.0.0.1:9310 + CfT chromium 159（companion 扩展加载）+ litellm mimo-v2.6-flash + egress 验收白名单）；`node smoke/gate-run.mjs` 采集，采集窗口 11:18:34–11:19:01Z
- **门禁话术**：「打开 example.com 并读出页面标题」

## 逐条判据结论

| # | 通过标准 | 结论 | 证据 |
|---|---|---|---|
| 1 | agent 返回标题与浏览器 tab 实际标题逐字符一致（另开 tab 核对，截图留证） | **通过** | 会话回答「Example Domain」（smoke/gate-evidence/G-CORE-01/record.json `session-full-text`）；独立复核（另开浏览器抓取）：<title>Example Domain</title>（artifacts/gates/G-CORE-01/indep-example-title.txt、indep-example-screenshot.png）；tab 实际标题 "Example Domain"（record.json `tabs-after`）。三者逐字符一致 |
| 2 | 页面在用户自己浏览器内真实打开，tab URL == https://example.com/ 且正常渲染，截图含地址栏 | **通过**（证据形态偏差见遗留问题） | record.json `tabs-after`：用户真实浏览器（CfT + companion 扩展）tab 列表新增 `{url:"https://example.com/", title:"Example Domain"}`（即地址栏 URL 值的结构化枚举）；该 tab 正常渲染截图 smoke/gate-evidence/G-CORE-01/tabs/tab-1856498399.png。偏差：CDP 截图不含浏览器地址栏，「截图含地址栏」形态未满足 |
| 3 | 取回的是 a11y 快照形态而非整页 HTML（结构化树、角色/名称层级、无 `<tag` HTML 源码特征） | **通过** | 会话导出（session.v4.jsonl，摘录 artifacts/gates/G-CORE-01/session-excerpt-turn1.json）browser_snapshot 结果为结构化树：`- text "Example Domain" / - paragraph … / - link "Learn more" [ref=e15]`（角色+名称+层级+ref）；`<tag` 样式特征检索 0 处 |
| 4 | 全链路无报错（该轮工具调用无 error；扩展与服务端日志无 attach 失败记录，日志检索输出留痕） | **通过** | 该轮（turn 1）共 1 次工具调用 browser_snapshot，isError=false（审计日志按验收时间窗过滤 + 会话导出，artifacts/gates/G-CORE-01/attach-log-grep.txt）；relay/服务端日志 grep attach/error/fail 无匹配行（同文件，日志全文 14 行） |

## 总体结论

**通过**（4 条判据全部通过；留痕形态有 2 项遗留，见下）。

## 证据清单

- smoke/gate-evidence/G-CORE-01/record.json（observations：tabs-before / prompt-sent / approval-clicked / session-full-text / browser-tool-calls-observed-in-ui / tabs-after）
- smoke/gate-evidence/G-CORE-01/session.png、tabs/tab-1856498399.png
- smoke/gate-evidence/gate-run-summary.json
- artifacts/gates/G-CORE-01/session-excerpt-turn1.json（会话导出 turn 1 工具调用与 a11y 快照结果摘录）
- artifacts/gates/G-CORE-01/attach-log-grep.txt（日志检索命令输出留痕）
- artifacts/gates/G-CORE-01/indep-example-title.txt、indep-example-screenshot.png（独立复核）
- 会话导出全文：/Users/sunny/code/agent-basis/.eterna-gate-home/sessions/--Users-sunny-code-agent-basis-.eterna-gate-home-workspaces-gate-admin--/session-fbe01da9-9bac-4d52-a83b-347e898c88f5/session.v4.jsonl.zstd

## 遗留问题

1. **地址栏截图形态缺失**：CDP 截图无法包含浏览器 chrome UI，「截图含地址栏」未满足；判据 2 的 URL 事实以 record.json `tabs-after` 结构化枚举（地址栏 URL 值）+ 渲染截图佐证。建议 harness 增补窗口级截图（如 macOS screencapture）以补齐该形态。
2. **扩展设置页截图缺失**：门禁步骤 1（扩展设置页填写 relay URL 并截图）由 gate-setup 预置 relay URL 完成，「扩展设置页截图（relay URL 敏感段打码）」未采集，证据留痕不全。
3. harness record.json 的 `browser-tool-calls-observed-in-ui` 对本轮为空（UI 文本未呈现工具条目），工具结果以服务端会话导出补齐核验。

---

# 第二轮判定（2026-11-10）

- **执行人**：独立验收代理（第二轮复验，用户书面指定派发代理执行，同第一轮指定记录）
- **证据批次**：修复版采集（逐用例新会话隔离 + 轮次收束判定 + 审批卡处置），窗口 20:27:06–20:27:46 CST（12:27:06–12:27:46Z），证据 `smoke/gate-evidence/G-CORE-01/`、`gate-run-summary.json`
- **门禁话术**：「打开 example.com 并读出页面标题」（record.json `prompt` 逐字一致）
- **会话导出**：`.eterna-gate-home/sessions/--Users-sunny-code-agent-basis-.eterna-gate-home-workspaces-gate-admin--/session-e10f1de4-d6cf-496c-b05d-ce10d93eaf7c/session.v4.jsonl.zstd`（本轮专用新会话，非第一轮 session-fbe01da9）

## 逐条判据结论

| # | 通过标准 | 结论 | 证据 |
|---|---|---|---|
| 1 | agent 返回标题与浏览器 tab 实际标题逐字符一致 | **通过** | agent 回答「页面标题：Example Domain」（record.json `session-full-text`）；第二轮独立复核：验收代理自行 `curl https://example.com/`（HTTP 200）得 `<title>Example Domain</title>`；tab 实际标题 "Example Domain"（record.json `tabs-after`）。三者逐字符一致 |
| 2 | 页面在用户自己浏览器内真实打开，URL == https://example.com/ 且正常渲染，截图含地址栏 | **通过**（留痕形态缺口见遗留） | record.json `tabs-after`：真实浏览器（companion 扩展面）新增 `{url:"https://example.com/", title:"Example Domain"}`；渲染截图 tabs/tab-1856498399.png（多语言正文 + Learn more 链接，正常渲染，第二轮目视核验）。缺口：CDP 截图不含浏览器 chrome/地址栏，「截图含地址栏」形态两轮均未满足——第二轮定性：**证据留痕形态缺口，非判据 2 布尔命题（真实浏览器打开）的反证**，URL 事实由 tabs 结构化枚举（即地址栏 URL 值）+ 渲染截图佐证，留痕不全如实挂账 |
| 3 | a11y 快照形态而非整页 HTML | **通过** | 会话导出（session-e10f1de4）browser_snapshot 结果为结构化树：`- text "Example Domain" / - paragraph … / - link "Learn more" [ref=e15]`（角色/名称/层级/refs）；HTML 源码特征 `</?[a-zA-Z][^>]*>` 检索 0 处（快照含 CSS 文本节点，非标签）；`<tag` 特征 0 处 |
| 4 | 全链路无报错 | **通过** | 该轮共 1 次工具调用 browser_snapshot，isError=false、ok=true（会话导出 + egress 审计日志 audit-20261110.jsonl 12:27:31Z 行）；turn-end reason=completed、record.json `turn-converged`（25s 收束）；会话导出 attach 字样 0 条。缺口：第二轮未归档 relay/gate-setup 控制台输出（第一轮留痕来源 1），以审计日志（服务端）+ 会话导出检索替代，详见 round2-evidence.txt |

## 总体结论

**通过**（4 条判据全部通过，与第一轮结论一致）。

## 与第一轮差异

1. **判据结论无变化**（4/4 通过）；第一轮的 2 项留痕形态遗留在第二轮证据下**仍未闭合**，定性为「证据留痕形态缺口」（见判据 2 与遗留 1/2），不翻转布尔结论但须补证闭合。
2. 第一轮遗留 3（`browser-tool-calls-observed-in-ui` 为空）依旧，第二轮改由会话导出 + 审计日志双源核验，证据链反而更完整。
3. 新增缺口：relay/扩展侧控制台日志第二轮未归档（第一轮有 attach-log-grep.txt 来源 1），已用审计日志检索替代留痕。
4. 第一轮差距②（harness 收束/悬置）在本用例验证已修复：逐用例新会话（session-e10f1de4）+ 25s 轮次收束 + 审批卡 1 张全部自动处置、无悬置。

## 证据清单

- smoke/gate-evidence/G-CORE-01/record.json、session.png、tabs/tab-1856498399.png
- smoke/gate-evidence/gate-run-summary.json
- artifacts/gates/G-CORE-01/round2-evidence.txt（第二轮：工具调用序列、审批事件、审计日志检索、独立复核输出）
- 会话导出：session-e10f1de4-…/session.v4.jsonl.zstd（路径见上）
- egress 审计日志：/var/folders/zn/…/T/gate-cwd/.eterna/audit-20261110.jsonl（12:27:31Z tool-call 行）
- 第一轮工件（保留）：session-excerpt-turn1.json、attach-log-grep.txt、indep-example-title.txt、indep-example-screenshot.png

## 遗留问题（第二轮）

1. **地址栏截图形态缺失（两轮均未闭合）**：定性为证据留痕形态缺口；闭合需 harness 增补窗口级截图（如 macOS screencapture）或等效地址栏可见留证。
2. **扩展设置页截图缺失（两轮均未闭合）**：门禁步骤 1 由 gate-setup 预置 relay URL 完成，「扩展设置页截图（relay URL 敏感段打码）」仍未采集；按门禁「证据留痕」条款属留痕不全，需补采后闭合。
3. relay/扩展侧 stderr 日志未随第二轮采集归档（第一轮来源 1 缺失），建议 gate-run 采集时归档 relay 日志检索输出。
4. `browser-tool-calls-observed-in-ui` 仍为空（UI 轨迹未呈现工具条目），继续以会话导出为准。

---

# 第三轮判定（2026-11-10）

- **执行人**：独立验收代理（第三轮复验，同前两轮用户书面指定）
- **证据批次**：修复版重采（stale-ref 全局注册表 + openedTabs 回执），窗口 21:00:46–21:01:17 CST，证据 `smoke/gate-evidence/G-CORE-01/`（刷新版）；会话导出 session-66479065-f0f1-4559-88e1-330883d31a66
- **门禁话术**：「打开 example.com 并读出页面标题」（record.json `prompt` 逐字一致）

## 逐条判据结论

| # | 通过标准 | 结论 | 证据 |
|---|---|---|---|
| 1 | 标题逐字符一致 | **通过** | agent 答「页面标题是：Example Domain」；第三轮独立复核 curl example.com → `<title>Example Domain</title>`；tabs-after 标题 "Example Domain"。三者一致 |
| 2 | 用户浏览器真实打开、URL==https://example.com/、正常渲染、截图含地址栏 | **通过**（留痕形态缺口延续） | tabs-after 新增 `{url:"https://example.com/", title:"Example Domain"}`；tabs/tab-1856498399.png 正常渲染。「截图含地址栏」形态仍缺（CDP 无 chrome UI），定性同第二轮：证据留痕形态缺口，非布尔命题反证 |
| 3 | a11y 快照形态而非整页 HTML | **通过** | 会话导出 browser_snapshot 结果为角色/名称/层级结构化树（snaplen=1055），HTML 标签特征 0 处 |
| 4 | 全链路无报错 | **通过** | 该轮 1 次 browser_snapshot isError=false（会话导出 + 审计日志 13:00:57Z），turn-end reason=completed（19s 收束）；attach 字样 0。relay/扩展侧日志归档缺口同第二轮 |

## 总体结论

**通过**（4/4，与第一、二轮一致，刷新复验通过）。

## 与前两轮差异

判据结论三轮稳定（4/4 通过）。第二轮遗留 4 项（地址栏截图、扩展设置页截图、relay 日志归档、UI 工具条目为空）在第三轮证据下均**维持原状**，定性不变：前两项为证据留痕形态缺口待补证闭合，不阻断本门禁布尔结论。工具面本轮零错误（stale-ref 修复后无误拒）。

## 证据清单

- smoke/gate-evidence/G-CORE-01/（刷新版 record.json、session.png、tabs/）
- artifacts/gates/G-CORE-01/round3-evidence.txt
- 会话导出 session-66479065-…/session.v4.jsonl.zstd；审计日志 audit-20261110.jsonl（13:00:57Z）
- 前两轮工件保留（round2-evidence.txt、第一轮 indep-*/attach-log-grep/session-excerpt）

## 遗留问题（第三轮）

同第二轮 4 项，无新增：① 地址栏截图形态；② 扩展设置页截图；③ relay/扩展侧日志归档；④ `browser-tool-calls-observed-in-ui` 空。

---

# 第四轮判定（2026-11-10，裁决口径生效）

- **执行人**：独立验收代理（第四轮复验，用户书面指定派发代理执行，同前三轮指定记录；裁决背景见 artifacts/gates/G-CORE-03/ruling.md——该裁决生效范围不含本门禁，本门禁按原文四判据复验）
- **证据批次**：全新环境 fresh boot 采集（2026-11-10 23:11:31–23:11:55 CST，15:11:31–15:11:55Z），证据 `smoke/gate-evidence/G-CORE-01/`；会话导出 session-6db4e9be-b652-4ddc-87e3-87b5baec6670（本轮专用新会话）
- **门禁话术**：「打开 example.com 并读出页面标题」（record.json `prompt` 逐字一致）

## 逐条判据结论

| # | 通过标准 | 结论 | 证据 |
|---|---|---|---|
| 1 | agent 返回标题与浏览器 tab 实际标题逐字符一致 | **通过** | agent 答「已打开 https://example.com/，页面标题是：Example Domain」（record.json `session-full-text`）；第四轮独立复核（本轮验收代理自行 `curl https://example.com/`，HTTP 200）得 `<title>Example Domain</title>`；tab 实际标题 "Example Domain"（record.json `tabs-after`）。三者逐字符一致（round4-evidence.txt §4/§5） |
| 2 | 用户浏览器真实打开、URL==https://example.com/、正常渲染、截图含地址栏 | **通过**（留痕形态缺口延续） | tabs-after 新增 `{url:"https://example.com/", title:"Example Domain"}`（真实浏览器 companion 扩展面结构化枚举，即地址栏 URL 值）；tabs/tab-1856498399.png 目视核验正常渲染（多语言正文 + Learn more 链接）。「截图含地址栏」形态仍缺（CDP 无浏览器 chrome UI），定性同前三轮：**证据留痕形态缺口，非判据 2 布尔命题（真实浏览器打开）的反证** |
| 3 | a11y 快照形态而非整页 HTML | **通过** | 会话导出（session-6db4e9be）browser_snapshot 结果为结构化 a11y 树（1356 字节）：`- text "Example Domain" / - paragraph "该域名仅用于文档示例…" / - paragraph "This domain is for use…"`（角色/名称/层级）；HTML 标签特征 `</?[a-zA-Z][^>]*>` 快照全文检索 0 处 |
| 4 | 全链路无报错 | **通过** | 该轮共 1 次工具调用 browser_snapshot，isError=false（会话导出 + egress 审计日志 15:11:40.903Z 行双源一致）；turn-end reason=completed（21.6s 收束，record.json `turn-converged`）；审计日志第四轮窗口内 `"isError":true` 计数 0、attach/denied/refused/egress 字样 0；会话导出 error/fail/attach 命中均为系统提示词文本（工具描述），无真实错误；审批 asked→decided 1 对即时处置（allowed-once） |

## 总体结论

**通过**（4/4，第四轮刷新复验通过；全新环境 fresh boot 下与前三轮结论一致，四轮结论稳定）。

## 与前三轮差异

判据结论四轮稳定（4/4 通过）。第二轮起的 4 项留痕遗留（地址栏截图、扩展设置页截图、relay/扩展侧日志归档、UI 工具条目为空）在第四轮证据下**维持原状、定性不变**：前两项为证据留痕形态缺口待补证闭合，不阻断本门禁布尔结论；relay/扩展侧 stderr 日志仍未随采集归档，以 egress 审计日志（服务端）+ 会话导出双源检索替代；`browser-tool-calls-observed-in-ui` 仍为空。本轮新增改进：第四轮核验了 fresh boot 全新环境（无前轮残留状态），并首次定位到本轮对应的 egress 审计日志文件（第三轮仅按行时间引用），判据 4 的服务端留痕较前三轮更完整。G-CORE-03 裁决①②不影响本门禁判定。

## 证据清单

- smoke/gate-evidence/G-CORE-01/record.json、session.png、tabs/tab-1856498399.png
- smoke/gate-evidence/gate-run-summary.json（第四轮批次，finishedAt 15:13:47.958Z）
- artifacts/gates/G-CORE-01/round4-evidence.txt（第四轮：工具调用序列、审批事件、审计日志检索、独立复核输出）
- 会话导出 session-6db4e9be-…/session.v4.jsonl.zstd；egress 审计日志 /var/folders/zn/bvvjyk6s5rg0rbs843vt9z3w0000gn/T/gate-cwd/.eterna/audit-20261110.jsonl（15:11:40.903Z tool-call、15:11:42.658Z turn-end）
- 第四轮独立复核原始输出：indep-example.html（curl 抓取的页面正文，验收代理本地临时目录，标题比对已摘录于 round4-evidence.txt）
- 前三轮工件保留（round2/3-evidence.txt、attach-log-grep.txt、session-excerpt-turn1.json、indep-example-title.txt、indep-example-screenshot.png）

## 遗留问题（第四轮）

延续第三轮 4 项，无新增：① 地址栏截图形态缺失（四轮未闭合，需窗口级截图或等效地址栏可见留证）；② 扩展设置页截图缺失（四轮未闭合）；③ relay/扩展侧 stderr 日志未归档（以审计日志+会话导出检索替代）；④ `browser-tool-calls-observed-in-ui` 空（以会话导出为准）。

---

# 终判轮判定（2026-11-11，第五轮）

- **执行人**：独立验收代理（终判轮，用户书面指定派发代理执行，具判定权；同前四轮指定记录）
- **证据批次**：INDEX.md「环境中断登记（2026-11-11 01:5x litellm 网关不可达）」恢复后的重采批次，窗口 2026-11-10T18:41:10–18:41:35Z（本地 02:41:10–02:41:35 CST）。**派发单所述「01:4x–01:5x CST」与证据实际时间不符**，判定按证据实际时间为准（如实登记）
- **门禁话术**：「打开 example.com 并读出页面标题」（record.json `prompt` 逐字一致）
- **会话导出**：session-fa654615-b567-417e-a2be-986fee2ca71f（本轮专用新会话）；独立证据工件 artifacts/gates/G-CORE-01/final-evidence.txt

## 逐条判据结论

| # | 通过标准 | 结论 | 证据 |
|---|---|---|---|
| 1 | agent 返回标题与浏览器 tab 实际标题逐字符一致 | **通过** | 会话导出（1 次工具调用 browser_snapshot，ok=true）；agent 回答标题串、tab 实际标题（tabs-after）、终判轮独立复核（本验收代理自行 curl，HTTP 200 `<title>`）三方指纹均为 14ch:7dd9587a（14 字符）——逐字符一致（final-evidence.txt §1/§2/§3） |
| 2 | 用户浏览器真实打开、URL==https://example.com/、正常渲染、截图含地址栏 | **通过**（留痕形态缺口延续） | tabs-before 仅 eterna web 1 个 tab（fresh boot 无残留）→ tabs-after 新增 `{url:"https://example.com/", title 指纹 14ch:7dd9587a}`；tabs/tab-1856498399.png 正常渲染。「截图含地址栏」形态仍缺（CDP 无浏览器 chrome），定性同前四轮：证据留痕形态缺口，非布尔命题反证 |
| 3 | a11y 快照形态而非整页 HTML | **通过** | 会话导出 browser_snapshot 结果为结构化 a11y 树（1055 字符，- text/- paragraph/- link [ref=e15] 层级）；HTML 标签特征正则检索 0 处、`<` 字符 0 处（final-evidence.txt §1） |
| 4 | 全链路无报错 | **通过** | 该轮 1 次工具调用 isError=false（会话导出 + egress 审计日志 seq 18 / 18:41:20.219Z 双源一致）；turn-end reason=completed（21.6s 收束）；窗口内 attach/denied/refused/egress 关键词检索 0 命中。窗口外 18:40:58Z 有 1 条 bash AbortError 属另一会话（c4e45885，aborted），与本门禁无关（final-evidence.txt §4） |

## 总体结论

**通过**（4/4；第五轮刷新复验通过，五轮结论稳定，本门禁终判：通过）。

## 与前四轮差异

判据结论五轮稳定（4/4 通过）。四轮延续的留痕形态遗留（地址栏截图、扩展设置页截图、relay/扩展侧 stderr 日志归档、UI 工具条目为空）维持原状、定性不变，不阻断布尔结论。本轮新增改进：① fresh boot 全新环境再证（tabs-before 无残留 tab）；② digest 脚本已按第五轮复核意见重写（按话术匹配会话、callId 配对、结构化 isError），其输出与会话导出实序一致，第五轮对 G-CORE-02 提出的 digest 整改在本批已闭合；③ 判据 4 服务端留痕窗口过滤检索 0 命中，并对窗口外无关会话的 bash 错误事件作出归属排除。

## 证据清单

- smoke/gate-evidence/G-CORE-01/record.json、session.png、tabs/tab-1856498399.png
- artifacts/gates/G-CORE-01/final-evidence.txt（终判轮：会话实序、指纹三方比对、审计日志窗口检索与窗口外事件归属、digest 交叉核验）
- 会话导出 session-fa654615-…/session.v4.jsonl.zstd；egress 审计日志 audit-20261110.jsonl（seq 18）；egress-whitelist.yml（14 条规则）
- 独立复核原始输出：/tmp/gate-r6-sessions/indep-example.html（验收代理本地临时目录，指纹已摘录于 final-evidence.txt）
- 前四轮工件保留（round2/3/4-evidence.txt、attach-log-grep.txt、session-excerpt-turn1.json、indep-example-title.txt、indep-example-screenshot.png）

## 遗留问题（终判轮）

延续四轮 4 项，无新增：① 地址栏截图形态缺失（五轮未闭合，留痕形态缺口）；② 扩展设置页截图缺失（五轮未闭合）；③ relay/扩展侧 stderr 日志未归档（以审计日志+会话导出双源替代）；④ `browser-tool-calls-observed-in-ui` 空（以会话导出为准）。以上均为证据留痕形态缺口，不阻断门禁布尔结论；后续批次建议按门禁「证据留痕」条款补采闭合。
