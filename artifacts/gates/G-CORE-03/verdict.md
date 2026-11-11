# G-CORE-03 验收判定书

- **门禁 ID**：G-CORE-03（核心链路门禁组，见 plans/2026-11-10-companion扩展开发计划与测试门禁.md §3.1）
- **执行人**：独立验收代理（用户书面指定派发，同 G-CORE-01 判定书说明）
- **执行日期**：2026-11-10
- **执行环境**：同 G-CORE-01；采集窗口 11:21:04–11:23:09Z
- **门禁话术**：「打开人民网首页（www.people.com.cn），取快照后点开头条新闻，读出正文第一段」（当日所选门户：人民网，经独立复核本机可达——curl 成功取回首页，<title>人民网_网上的人民日报</title>）
- **关键事实**：**本次验收运行中该任务从未执行**。话术于 11:21:04 发入时上一轮（G-CORE-02，turn 2）仍在运行，话术被排入 next-turn 队列；11:23:09 采集时该轮仍未开始；11:23:10 harness 退出后遗留未决审批卡，会话于 11:23:23 停滞，turn 3 此后亦无法启动。完整时间线见 artifacts/gates/G-CORE-03/run-timeline.txt。

## 逐条判据结论

| # | 通过标准 | 结论 | 证据 |
|---|---|---|---|
| 1 | 点击后当前 tab URL 变为详情页，且详情页标题/快照包含点击前锚文本（地址栏截图 + 快照文本比对） | **无法判定**（任务未执行） | 会话导出无该轮任何工具调用；record.json `tabs-after`（11:23:09）6 个 tab 中无任何 people.com.cn tab；无点击、无导航、无快照 |
| 2 | agent 返回的正文第一段与手动核对一致（仅允许首尾空白差异） | **无法判定** | agent 无任何回答（采集时会话仍显示 turn 2「深度求索中」，G-CORE-03 话术在排队区）；无从与人民网详情页正文比对 |
| 3 | click 调用引用的元素 ref 在点击前快照结果中存在（ref 集合比对） | **无法判定** | 无 click 调用、无快照，ref 集合不存在 |
| 4 | 无超时/错误返回（该任务全部工具调用无 error/timeout 字段） | **无法判定** | 任务未运行，「全部工具调用」为空集，不构成该判据的通过证据（不作空集真值处理） |

## 总体结论

**不通过**（本次运行未取得任何通过证据，4 条判据全部无法判定）。按门禁失败处理：打回重做；禁止以任何形式自行判定通过。

## 证据清单

- smoke/gate-evidence/G-CORE-03/record.json（prompt-sent、3 次 approval-clicked——均属 turn 2 步骤、session-full-text 显示排队状态、tabs-after 无 people.com.cn tab）
- smoke/gate-evidence/G-CORE-03/session.png、tabs/
- artifacts/gates/G-CORE-03/run-timeline.txt（独立验收代理提取的运行时间线）
- 会话导出 session.v4.jsonl（最后写入 11:23:23，停在 turn 2 step 14 job_output 的 approval/asked 悬置）

## 无法判定原因（harness 缺陷为主，如实记录，未修改 harness）

1. **派发时序缺陷**：harness 未等待上一轮（G-CORE-02）结束即发送 G-CORE-03 话术，话术被排入 next-turn 队列，采集窗口内该轮从未开始（record.json `session-full-text` 可见「Cmd/Ctrl+Enter 插话发送全部排队消息」排队提示）。
2. **退出悬置缺陷**：harness 于 11:23:10 退出时遗留 1 张未决审批卡（job_output），会话停滞于 11:23:23，任务永未收束。
3. **叠加因素**：G-CORE-02 轮次 4 分钟未收敛（HN 搜索入口被白名单拦截/不可用，agent 长时间探索），直接挤压本用例的执行与采集。
4. 产品侧执行能力本用例**无从评价**（未执行）。实现者自测运行（10:55–10:58）中曾有 snapshot→click(ref=e1095)→snapshot 的完成记录，但那不属于本次验收运行，不作为判定依据。

## 遗留问题

1. harness 需改为「逐轮等待收束后再派发下一用例」，并在退出前处置/记录悬置审批卡；
2. 修复后由同一独立验收代理重跑 G-CORE-03 全部步骤（含地址栏可见截图的留证形态）。

---

# 第二轮判定（2026-11-10）

- **执行人**：独立验收代理（第二轮复验，用户书面指定派发代理执行，同第一轮指定记录）
- **证据批次**：修复版采集，窗口 20:28:50–20:32:19 CST，证据 `smoke/gate-evidence/G-CORE-03/`、`gate-run-summary.json`
- **门禁话术**：「打开人民网首页（www.people.com.cn），取快照后点开头条新闻，读出正文第一段」（record.json `prompt` 逐字一致；当日门户：人民网，第二轮独立复核可达，curl 首页/详情页均 HTTP 200）
- **会话导出**：session-4677d9a9-…/session.v4.jsonl.zstd（逐用例新会话；本用例任务已完整执行并 206s 收束，16 次工具调用）
- **点击前锚文本**：「习近平同志《论减贫脱贫》出版发行」（会话点击前快照 snapshot#1 中 `link [ref=e1093]`；截图 tabs/tab-901781921.png 首页红条同文）

## 逐条判据结论

| # | 通过标准 | 结论 | 证据 |
|---|---|---|---|
| 1 | 点击后当前 tab URL 变为详情页，且详情页标题/快照含点击前锚文本（地址栏截图+快照比对） | **不通过** | 4 次 click 无一达成「当前 tab→详情页」：click#2(e1093)/#5(e1097) isError=true（stale-ref 误拒，未派发点击事件）；click#8(e1097,tabId=…471)/#12(e1093,tabId=…470) ok=true 但 result.url 仍为 http://www.people.com.cn/，点击后对该 tab 的快照（step9/13）仍为首页——被点 tab 未导航。会话内无任何「点击后处于详情页」的快照；详情页最终由 web_fetch 取链（step15）+ browser_snapshot 带 url 直接导航（step16）到达，非点击导航达成。agent 自述「首页上直接点击头条链接两次都没有触发导航……从首页 HTML 中取出头条的真实地址并在浏览器中打开」。后半句（详情页标题含锚文本）单独成立：详情页标题「习近平同志《论减贫脱贫》出版发行--时政--人民网」含锚文本，但合取判据不成立。附注：tabs-after 有 3 个详情页 tab（超出 step16 可解释的 1 个），提示 click#8/#12 可能在新标签后台打开文章（target=_blank），但无快照/地址栏截图坐实，且判据字面要求「当前 tab URL 变为详情页」，不作放宽 |
| 2 | agent 返回正文第一段与手动核对一致（仅首尾空白差异） | **通过** | agent 答：「新华社北京11月10日电 中共中央党史和文献研究院编辑的习近平同志《论减贫脱贫》，近日由中央文献出版社出版，在全国发行。」第二轮独立复核：curl 详情页正文第一段（首个非播报 `<p>`）逐字符一致（round2-evidence.txt）；截图 tabs/tab-1246801096.png 详情页正文首段同文 |
| 3 | click 引用的 ref 在点击前快照结果中存在（ref 集合比对） | **通过** | 会话导出 ref 集合比对（round2-evidence.txt）：click#2(e1093)←snapshot#1 含 e1093；click#5(e1097)←snapshot#4 含 e1097；click#8(e1097)←snapshot#7 含 e1097；click#12(e1093)←snapshot#11 含 e1093——4/4 存在于紧邻点击前快照，定位链路按判据判定方法自洽。附注：工具层对 click#2/#5 报「ref 不在最近一次快照中」与集合比对矛盾，属工具 ref 记账误拒（见遗留 2），该误拒的 error 计入判据 4 |
| 4 | 无超时/错误返回（全部工具调用无 error/timeout 字段） | **不通过** | 16 次工具调用中 2 次 isError=true：click#2、click#5 返回 `{"code":"TOOL_ERROR","message":"ref … 不在最近一次快照中"}`（会话导出 + 审计日志 12:29:29Z、12:30:04Z 行）。其余 14 次无 error/timeout；但「全部工具调用无 error」不成立 |

## 总体结论

**不通过**（判据 1/4 不通过；判据 2/3 通过）。按门禁失败处理：打回重做；禁止自行判定通过。

## 与第一轮差异

| 项 | 第一轮 | 第二轮 |
|---|---|---|
| 任务执行 | 从未执行（话术排队+悬置），4 判据全部无法判定 | **完整执行并收束**（16 步、206s），4 判据均可判定 |
| 判据 1 | 无法判定 | **不通过**（点击未致当前 tab 导航，web_fetch+URL 直导航兜底） |
| 判据 2 | 无法判定 | **通过**（正文第一段与独立复核逐字符一致） |
| 判据 3 | 无法判定 | **通过**（4 次 click 的 ref 均在点击前快照集合中） |
| 判据 4 | 无法判定 | **不通过**（2 次 stale-ref error 返回） |
| 总体 | 不通过 | **不通过** |

第一轮差距处置核验：harness 派发时序/退出悬置缺陷（差距①②）——**已修复**（逐用例新会话、本话术未排队、17 张审批卡全数自动处置、轮次收束后才采集）。产品侧行为面为本轮新暴露差距（第一轮无从评价）：a) 详情页链接点击在被点 tab 不导航（agent 无法感知新标签行为，且无 tab 枚举工具佐证）；b) 工具 stale-ref 误拒产生 error 返回；c) agent 兜底动用了 web_fetch（会话外取数）+ URL 直导航，绕过「点开头条新闻」的点击语义。

## 证据清单

- smoke/gate-evidence/G-CORE-03/record.json、session.png、tabs/（tab-901781921.png 首页头条红条、tab-1246801096.png 详情页正文首段、tab-1856498399.png、tab-760461682.png）
- smoke/gate-evidence/gate-run-summary.json
- artifacts/gates/G-CORE-03/round2-evidence.txt（16 次工具调用序列、审批事件、审计日志检索、独立复核输出、ref 集合比对、导航事实）
- 会话导出 session-4677d9a9-…/session.v4.jsonl.zstd；审计日志 audit-20261110.jsonl（12:28:55–12:32:05Z 16 条 tool-call，2 条 isError=true）
- 第一轮工件（保留）：run-timeline.txt

## 遗留问题（第二轮）

1. **点击导航语义（阻断项）**：「点开头条新闻」未以点击达成当前 tab 导航——需查明链接行为（target=_blank/JS 跳转）并使 click 语义可观察（返回落定 URL/新 tab 信息），或按门禁口径使当前 tab 导航达成；重跑 G-CORE-03。
2. **工具 ref 记账误拒（阻断项，与 G-CORE-02 同源）**：url 导航型快照的 ref 被误判 stale（e1093/e1097/e2 均实际存在于前一快照），导致 error 返回（判据 4）与重复快照开销；需修复后重跑。
3. `browser_snapshot` 无参调用反复落到 example.com tab（默认 tab 认知混乱），agent 多次误判「页面跳到了 example.com」，属工具默认 tab 语义缺陷。
4. 地址栏截图形态缺口（同 G-CORE-01 遗留 1）；tabs/ 仅覆盖 8 个末态 tab 中的 4 个，未覆盖的重复首页/详情页 tab 无截图留痕。
5. agent 兜底使用 web_fetch 从会话外取首页 HTML，与「全链路在会话内浏览器完成」的预期路径不符（判据未直接约束，如实记录供后续门禁参考）。

---

# 第三轮判定（2026-11-10）

- **执行人**：独立验收代理（第三轮复验，同前两轮用户书面指定）
- **证据批次**：修复版重采（stale-ref 全局注册表 + openedTabs 回执），窗口 21:03:08–21:03:43 CST，证据 `smoke/gate-evidence/G-CORE-03/`（刷新版）；会话导出 session-c219d401-beb9-4ff4-86d9-c3f66781698d
- **门禁话术**：「打开人民网首页（www.people.com.cn），取快照后点开头条新闻，读出正文第一段」（record.json `prompt` 逐字一致）
- **本轮关键事实**：流程「快照→点击→openedTabs 报告新 tab 开启→读文章快照」已走通、工具面零错误；但第 4 步生成回答时被 **litellm 模型供应商 content_filter** 中断（turn/end reason=error，`Provider finish_reason: content_filter` / `PI_AI_ERROR`，模型流文本 "The request was rejected because it was considered high risk"），agent 未产出最终回答（UI「处理失败」）。

## 逐条判据结论

| # | 通过标准 | 结论 | 证据 |
|---|---|---|---|
| 1 | 点击后当前 tab URL 变为详情页，且详情页标题/快照含点击前锚文本（地址栏截图+快照比对） | **不通过**（字面口径；重大进展+待裁决，见下） | 点击→详情页因果链已由回执证实：click(step2, ref=e1096) ok=true，回执 `openedTabs:[{tabId:1114565295, url:"http://politics.people.com.cn/n1/2026/1110/c1024-40831402.html", title:"习近平同志《论减贫脱贫》出版发行--时政--人民网"}]`；step3 快照（该 tab）title 含点击前锚文本「习近平同志《论减贫脱贫》出版发行」——后半句成立。**但按字面**「当前 tab URL 变为详情页」：click 主回执 `url:"http://www.people.com.cn/"`（被点/当前 tab 仍为首页），详情页在**新标签页**打开，「当前 tab URL 变为详情页」未成立；且地址栏截图形态仍缺。**待升级裁决**：「点击落点（openedTabs 新 tab）是否视同当前 tab」属门禁文本口径问题——按 G-CORE-03 失败处理「升级裁决……不得以此为由降低标准」先例，本判定不自行放宽，提请用户裁决 |
| 2 | agent 返回正文第一段与手动核对一致 | **不通过**（未返回，非内容错误） | agent 无最终回答（content_filter 于生成阶段中断）。独立复核：详情页正文第一段「新华社北京11月10日电 中共中央党史和文献研究院编辑的习近平同志《论减贫脱贫》，近日由中央文献出版社出版，在全国发行。」——会话内 step3 文章快照已含该段（逐字符同独立复核），**数据已就位但模型未能输出**，无从执行「agent 返回 vs 手动核对」比对 |
| 3 | click 引用的 ref 在点击前快照结果中存在 | **通过** | click ref=e1096；点击前快照（step1）含 `- link "习近平同志《论减贫脱贫》出版发行" [ref=e1096]`——ref 存在且为头条锚文本（round3-evidence.txt）。stale-ref 误拒本轮 0 次（第二轮差距"工具 ref 记账误拒"已根治） |
| 4 | 无超时/错误返回（全部工具调用无 error/timeout 字段） | **不通过**（任务级错误返回；工具面干净，见定性说明） | 判定方法面：3 次工具调用 isError 全 false、无 error/timeout 字段（会话导出+审计日志 13:03:15/25/31 三行）——**工具面达标**。但布尔标准「无超时/错误返回」：任务存在错误返回——turn/end `reason={"kind":"error","error":{"message":"Provider finish_reason: content_filter","code":"PI_AI_ERROR"}}`、UI「本轮运行失败」。按字面口径不达标；根因为 litellm 模型供应商内容过滤器拦截政治新闻文本（非产品缺陷） |

## 总体结论

**不通过**（判据 1/4 不通过、判据 2 不通过、判据 3 通过）。按门禁失败处理：打回重做/升级裁决；禁止自行判定通过。

## 与前两轮差异

| 项 | 第一轮 | 第二轮 | 第三轮 |
|---|---|---|---|
| 任务执行 | 从未执行 | 完整执行（16 步，web_fetch 兜底） | **流程走通但回答阶段被 provider 中断**（4 步） |
| 判据 1 | 无法判定 | 不通过（点击未致导航、URL 直导航兜底） | **不通过（字面）**，但点击→详情页因果链已由 openedTabs 证实（同 tab 导航字面未达成，待裁决） |
| 判据 2 | 无法判定 | 通过（第一段逐字符一致） | **不通过**（content_filter 致无回答；快照内数据与独立复核一致） |
| 判据 3 | 无法判定 | 通过（4/4 ref 比对） | **通过**（ref=e1096 在点击前快照；stale-ref 误拒 0 次=修复生效） |
| 判据 4 | 无法判定 | 不通过（2 次 stale-ref error） | **不通过**（工具面 0 error，任务级 content_filter 错误返回） |
| 总体 | 不通过 | 不通过 | **不通过** |

第二轮差距处置核验：① stale-ref 误拒（阻断项）——**已修复**（0 误拒，click 一次即命中头条）；② 点击导航语义（阻断项）——**证据面闭合**（openedTabs 显式报告新 tab 与详情 URL），仅存「同 tab vs 新 tab」字面口径待裁决；③ 默认 tab 漂移（遗留 3）——**已修复**（无参快照落最近快照上下文 tab）；④ web_fetch 兜底——本轮未再发生（纯浏览器链路）。**新差距**：litellm 模型供应商 content_filter 中断回答生成（环境/供应商限制，非产品缺陷），按判据 2/4 字面口径不达标。

## content_filter 定性说明

- **事实**：step4 生成回答时 provider 返回 finish_reason=content_filter（PI_AI_ERROR），拦截文本为政治新闻内容（《习近平同志〈论减贫脱贫〉出版发行》报道）；工具调用链（快照→点击→openedTabs→文章快照）全部成功且零错误。
- **定性**：模型供应商（litellm/mimo-v2.6-flash）内容过滤限制，**非浏览器执行面/产品缺陷**；但按门禁字面口径——判据 2 要求「agent 返回的正文第一段」（无返回=不达标）、判据 4 布尔「无错误返回」（任务级 error 返回=不达标）——**均记不通过**，不因供应商限制自行放宽。
- **处置建议（供升级裁决）**：a) 换用无该内容过滤的模型/供应商重跑 G-CORE-03（门禁文本已有「升级裁决改用备选……重跑，裁决记录留痕」先例）；或 b) 用户裁决将 provider content_filter 记为不可抗力并另定重跑口径。裁决前本门禁维持不通过。

## 证据清单

- smoke/gate-evidence/G-CORE-03/（刷新版 record.json、session.png、tabs/ 5 张：首页 tab-901781921.png、详情页 tab-1246801096.png 等）
- artifacts/gates/G-CORE-03/round3-evidence.txt（工具序列、openedTabs 回执、ref 比对、中断事实、独立复核）
- 会话导出 session-c219d401-…/session.v4.jsonl.zstd（含 turn/end error 与 assistant/attempt 拒绝流）；审计日志 audit-20261110.jsonl（13:03:15/25/31 tool-call + 13:03:32 turn-end reason=error）
- 前两轮工件保留

## 遗留问题（第三轮）

1. **「当前 tab」口径待升级裁决**：clicked tab vs openedTabs 新 tab——裁决结果决定判据 1 改判与否（本判定按字面不放宽）。
2. **content_filter 重跑口径待裁决**：换模型/供应商重跑或按不可抗力另定（见定性说明）。
3. 地址栏截图形态缺口（延续）；tabs/ 5 张覆盖本轮 6 个末态 tab 中 5 个。
4. 若裁决后判据 1 口径确认为「含 openedTabs 新 tab」，剩余阻断项将仅剩 content_filter（判据 2/4），产品执行面本用例已具备达标能力。

---

# 终判轮判定（2026-11-11，第四轮）

- **执行人**：独立验收代理（终判轮，用户书面指定派发代理执行，具判定权；同前三轮指定记录）
- **证据批次**：INDEX.md「环境中断登记（2026-11-11 01:5x litellm 网关不可达）」恢复后的重采批次，窗口 2026-11-10T18:42:46–18:44:28Z（本地 02:42:46–02:44:28 CST，turn-converged 99994ms）。**派发单所述「01:4x–01:5x CST」与证据实际时间不符**，判定按证据实际时间为准（如实登记）
- **裁决口径**：判据 1 按 artifacts/gates/G-CORE-03/ruling.md 裁决①（「点击后 openedTabs 回执或 tabs 枚举中存在详情页 tab（含标题/锚文本一致性比对）」即视为达成；因果链须由回执坐实）；场景按裁决②换站机制执行——**本轮场景经用户进一步澄清再细化为科技门户 IT之家（www.ithome.com）、话术消歧为「点开快照中第一条新闻链接」（用户澄清「不一定非要时政」）**。该细化以派发单记录为准，ruling.md 文本本身未含此细化，出处如实登记；egress 白名单已增补 ithome.com/*.ithome.com（14 条规则实读）
- **门禁话术**：「打开 IT之家首页（www.ithome.com），取快照后点开快照中第一条新闻链接，读出正文第一段」（record.json `prompt` 与消歧话术逐字一致）
- **会话导出**：session-f1fef4af-cb8b-4366-88ec-cd0c58b9e5ff（本轮专用新会话）；独立证据工件 artifacts/gates/G-CORE-03/final-evidence.txt

## 会话导出实序（权威证据，双源一致）

3 次工具调用，全部 isError=false（会话导出 + egress 审计日志 18:43:30.433Z / 18:43:56.357Z / 18:44:02.118Z 逐项一致）：

| step | 工具 | arguments | 结果 | isError |
|---|---|---|---|---|
| 1 | browser_snapshot | `{"url":"https://www.ithome.com"}` | 成功：首页快照（tabId=775512323）；热榜（日榜）首条标题链接 [ref=e340] 在快照中 | false |
| 2 | browser_click | `{"ref":"e340"}` | 成功：回执 url=首页（被点 tab 未变）；**openedTabs=[{tabId:775512324, url:详情页, title 指纹 49ch:a75434c6}]**——点击→详情页因果链回执 | false |
| 3 | browser_snapshot | `{"tabId":775512324}` | 成功：详情页快照（tabId=775512324），标题含点击前锚文本，含正文首段 paragraph 节点 | false |

## 逐条判据结论

| # | 通过标准 | 结论 | 证据 |
|---|---|---|---|
| 1 | 点击后当前 tab URL 变为详情页，且详情页标题/快照包含点击前锚文本（裁决①口径） | **通过**（裁决①口径首次完整达成） | 因果链坐实：click(step2) ok=true，回执 openedTabs 显式上报新 tab（tabId=775512324、详情页 URL、标题指纹 49ch:a75434c6）；step3 快照对同一 tabId 取得详情页；record.json tabs-after 含该详情页 tab；截图 tabs/tab-1330393303.png 渲染详情页。锚文本一致性：点击前快照中 [ref=e340] 锚文本（指纹 42ch:d9fb5743）被详情页标题（tabs-after 与 step3 快照，指纹 49ch:a75434c6）包含（true）。按裁决①「新标签导航视同达成」判定成立；「地址栏截图」形态缺口延续（同前三轮定性，留痕形态缺口不影响布尔结论） |
| 2 | agent 返回的正文第一段与手动核对一致（仅允许首尾空白差异） | **通过** | 终判轮独立复核（本验收代理 curl 详情页，HTTP 200）：文档序首个非空 `<p>` 即正文首段，75 字符、指纹 75ch:18ff80a0（与 digest criteria2 基准指纹一致）；抽取启发式（首个 ≥30 字符段落）无更早候选、无误取（`<p>` 序列长度 75/0/27/95/…，渲染截图 tab-1330393303.png 佐证首段同文）。agent 回答正文首段（取自 step3 详情页快照，会话内数据源）与基准 trim 后逐字符相等（两串均 75 字符、143 UTF-8 字节，sha 同为 75ch:18ff80a0）。**与第三轮差异：本轮 agent 产出完整回答，判据 2 可判定且成立** |
| 3 | click 调用引用的元素 ref 在点击前快照结果中存在 | **通过** | 会话导出抽验：click(step2) ref=e340；点击前 step1 快照含 `- link（锚文本指纹 42ch:d9fb5743）[ref=e340]`（热榜日榜 listitem 首条）——digest refCheck {ref:"e340", present:true} 与独立抽验一致。stale-ref 误拒 0 次（全局注册表修复持续生效） |
| 4 | 无超时/错误返回 | **通过** | 3 次工具调用全部 isError=false（会话导出+审计日志双源）；窗口内 attach/denied/refused/egress 关键词检索 0 命中；turn-end reason=completed（99.9s 收束），**无 content_filter 中断**——裁决②换站机制落地后第三轮的供应商内容过滤阻断未再现（科技门户场景，时政敏感文本不再进入生成流） |

## 总体结论

**通过**（4/4，裁决①②与用户场景细化口径下首次全部通过；本门禁终判：通过，阻断解除）。

## 与前三轮差异

| 项 | 第一轮 | 第二轮 | 第三轮 | 终判轮（四） |
|---|---|---|---|---|
| 任务执行 | 从未执行（排队+悬置） | 完整执行（16 步，web_fetch+URL 直导航兜底） | 流程走通但回答被 provider content_filter 中断 | **完整执行（3 步纯浏览器链路）并产出回答** |
| 判据 1 | 无法判定 | 不通过（点击未致导航） | 不通过（字面；openedTabs 因果链已证，待裁决） | **通过**（按裁决①：openedTabs 回执坐实因果链+锚文本一致） |
| 判据 2 | 无法判定 | 通过 | 不通过（content_filter 致无回答） | **通过**（75 字符基准逐字符比对一致，指纹复核） |
| 判据 3 | 无法判定 | 通过（4/4 ref 比对） | 通过（ref=e1096） | **通过**（ref=e340 前序在案） |
| 判据 4 | 无法判定 | 不通过（2 次 stale-ref error） | 不通过（任务级 content_filter 错误返回） | **通过**（工具面与任务级双零错误） |
| 总体 | 不通过 | 不通过 | 不通过 | **通过** |

第三轮两项升级裁决的落地核验：① 裁决①（判据 1 新标签口径）——本轮 click 回执 openedTabs 上报详情页 tab 且标题含锚文本、step3 对同一 tabId 快照、tabs-after 与截图佐证，因果链由回执坐实，判据 1 按裁决口径成立；② 裁决②（content_filter 不可抗力换站）——场景经用户澄清细化为科技门户 IT之家后重跑，回答完整产出、无内容过滤中断，判据 2/4 的 content_filter 阻断消解。第二轮遗留的 web_fetch 兜底与 URL 直导航行为本轮未再现（纯 snapshot→click→snapshot 三步链路）；harness 派发时序/悬置缺陷（第一轮）持续修复生效（逐用例新会话、3 对审批全数即时处置）。

## 「第一条新闻链接」落点核验（话术执行面观察，不属四判据）

消歧话术要求「点开快照中第一条新闻链接」。抽验：a11y 快照中 [ref=e340] 之前共 75 个链接，其中 73 个为顶部导航/热搜关键词（如「华为」「小米」等词组）/下载推广/广告控件，另有 2 条标题式链接（e240/e243）——经渲染截图核验为热搜横幅编号条目（①②徽标）、紧邻广告横幅，属热搜推广位而非新闻列表条目，与 agent 消歧表述（其前为导航/热搜关键词与广告）一致；e340 为热榜（日榜）列表首条新闻条目。落点与消歧话术自洽（a11y 快照无容器标签，判定依赖 agent 披露的消歧理由并以渲染证据佐证）。若按「热搜横幅标题亦计新闻链接」的更严口径，落点将为第 3 条标题式链接——该口径分歧如实登记，不影响四判据布尔结论。

## digest 交叉核验（第五轮整改项闭合验证）

gate-digest.mjs 已于 2026-11-11 重写（按话术匹配会话、callId 配对、结构化 isError）。终判轮交叉核验：digest.json session 归属正确（session-f1fef4af）、sequence snapshot→click→snapshot 与会话导出一致、clickNoError=true、refCheck present=true、openedTabsUrls=[详情页]、turnFailed=false、criteria2（75 字符基准、指纹一致、answerContainsBaseline=true）与本验收代理独立复算全部一致——digest 输出恢复证明力。

## 证据清单

- smoke/gate-evidence/G-CORE-03/record.json（prompt 1 次、approval-clicked 3 次、turn-converged 99994ms、tabs-after 含首页与详情页 tab）、session.png、tabs/tab-1330393303.png（详情页渲染：标题、正文首段、热搜横幅①②与广告横幅可见）、tabs/tab-1930358484.png（首页渲染：日榜首条即被点条目）
- smoke/gate-evidence/G-CORE-03/digest.json（重写版，交叉核验一致）
- artifacts/gates/G-CORE-03/final-evidence.txt（终判轮：会话实序与回执、锚文本/标题/首段指纹、ref 前序抽验、落点核验、digest 交叉核验）
- 会话导出 session-f1fef4af-…/session.v4.jsonl.zstd；egress 审计日志 audit-20261110.jsonl（3 条 tool-call 全 isError=false；turn-end completed）；egress-whitelist.yml（14 条规则，ithome.com 在列）
- 终判轮独立复核原始输出：/tmp/gate-r6-sessions/indep-ithome-detail.html（详情页抓取，验收代理本地临时目录，指纹已摘录于 final-evidence.txt）
- artifacts/gates/G-CORE-03/ruling.md（裁决①②）；前三轮工件保留（run-timeline.txt、round2/3-evidence.txt）

## 遗留问题（终判轮）

1. 地址栏截图形态缺口（延续四轮，同 G-CORE-01；裁决①已将判据 1 证据口径落到 openedTabs/tabs 回执，CDP 截图无浏览器 chrome 属留痕形态缺口，不影响布尔结论）。
2. relay/扩展侧 stderr 日志未归档（延续；以审计日志+会话导出双源替代）。
3. `browser-tool-calls-observed-in-ui` 空（延续；以会话导出为准）。
4. 「第一条新闻链接」的更严口径分歧（热搜横幅标题是否计新闻链接）如实登记，供后续同类话术复用时参考；本轮按 agent 披露理由+渲染证据认定自洽。
5. 本轮场景细化（IT之家）依据为派发单记录的用户澄清，建议后续将裁决②的换站链（澎湃→IT之家）补录进 ruling.md 以完备口径留痕。
