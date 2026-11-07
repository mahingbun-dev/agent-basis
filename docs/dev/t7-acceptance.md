# T7.5 集成验收报告（真会话 E2E）

> 日期：2026-11-07 ｜ 执行：T7.5 集成验收官（动态 workflow subagent）
> 断言脚本：`scripts/t7-e2e.mjs`（可重复执行，退出码 0/1）
> 计划书：`plans/2026-11-07-agent-loop可视化与system-prompt前端管理.md` §6 T7.5 行、§8 验证方式
> 结论：**72 项断言全 PASS / 0 FAIL，exit 0，连续三次运行全部通过**

## 1. 验收环境与隔离

| 项 | 值 |
| --- | --- |
| 运行态 | `DSH_HOME=.basis-home-t7/`（仓库内隔离目录；版本库单元、兜底审计、会话日志、宿主日志全在其内，每次运行先清零复现） |
| Web 宿主 | 127.0.0.1:**3108**（`dsh --profile t7-studio`；进程清理只用 SIGTERM + `pkill -f 'profile t7-studio'` 精确模式） |
| 真模型 | `@basis/llm-openai` → LiteLLM（baseURL 读 `.secrets/litellm-base-url.txt`，`LITELLM_API_KEY` 只从 `.secrets/litellm-master-key.txt` 读进宿主进程环境，不写入任何被跟踪文件/日志/输出） |
| 被测插件 | `@basis/prompt-studio`（PLUGIN-AUTHORING §4 symlink 终态装载；cordis.patch.yml insert 行 `- id: basis-prompt-studio / name: '@basis/prompt-studio'`） |
| persona 锚点 | 基线 `T7_E2E_PERSONA_BASE alpha`（patch 层单引号标量）；新文本 = 基线 + `T7_E2E_STUDIO_V2 红线:预算超支>5%必须触发审批;对外付款不得代付;比选必须中立。`（唯一子串作断言锚点，且满足 T7.3 校验器三条红线） |
| 前端角色 | 本脚本经宿主 HTTP `/api` 通道以 `{type:'client-request',method:'loopPrompt/*',payload:{args:{input:{…}}}}` 调用——与 T7.2 浏览器半边 `ctx.connection.rpc` 同一 wire 形态 |

运行命令与结果（本报告证据全部出自「记录运行」，此前两次连跑同结论）：

```
node scripts/t7-e2e.mjs   # 第 1 次：exit 0（72 PASS / 0 FAIL，迭代前基线 43 PASS + 2 FAIL 修复后通过）
node scripts/t7-e2e.mjs   # 第 2 次：exit 0（72 PASS / 0 FAIL，可重复性）
node scripts/t7-e2e.mjs > /tmp/t7-e2e-final.log 2>&1; echo $?   # 记录运行：EXIT_CODE=0（72 PASS / 0 FAIL）
```

## 2. 断言台账（逐断言 PASS/FAIL + 证据原文）

> 证据列摘自记录运行脚本输出原文（超长行截断以 … 标示）；`[PASS]`/`[FAIL]` 为脚本逐条打印的原始标记。

### 阶段 0：装载预检（bundle / 插件 / patch 层 / dump-config）

| # | 断言 | 结果 | 证据（原文摘录） |
| --- | --- | --- | --- |
| 0.1 | 浏览器半边 bundle 构建（lib/client.js） | PASS | `[PASS] 0.1 浏览器半边 bundle 构建(lib/client.js)`（`build-client.mjs` 退出码 0） |
| 0.2 | preflight: dump-config 退出码 0 | PASS | `[PASS] 0.2 preflight: dump-config 退出码 0 — status=0` |
| 0.3 | 组合树 persona 前缀=基线标记 | PASS | `[PASS] 0.3 preflight: 组合树 persona 前缀=基线标记` |
| 0.4 | 组合树含 basis-prompt-studio 行 | PASS | `[PASS] 0.4 preflight: 组合树含 basis-prompt-studio 行` |
| 0.5 | 无 skipping/incompatible | PASS | `[PASS] 0.5 preflight: 无 skipping/incompatible` |

### 阶段 1：宿主启动 + 装载证据（G2 口径）

| # | 断言 | 结果 | 证据（原文摘录） |
| --- | --- | --- | --- |
| 1.1 | 宿主就绪（dsh web token） | PASS | `[PASS] 1.1 宿主就绪(dsh web token) — pid=72908` |
| 1.2 | pluginInventory 含 @basis/prompt-studio 行 | PASS | `[PASS] 1.2 pluginInventory: 含 @basis/prompt-studio 行 — entryId=include:basis-prompt-studio` |
| 1.3 | 行 enabled=true | PASS | `[PASS] 1.3 pluginInventory: 行 enabled=true` |
| 1.4 | 行 fiberPhase=active | PASS | `[PASS] 1.4 pluginInventory: 行 fiberPhase=active` |
| 1.5 | 启动日志无 skipping/incompatible | PASS | `[PASS] 1.5 宿主启动日志无 skipping/incompatible` |

### 阶段 2：旧会话 A（保存前开回合，LITELLM 真模型）

| # | 断言 | 结果 | 证据（原文摘录） |
| --- | --- | --- | --- |
| 2.1 | 会话 A 回合完成且系统提示含基线标记 | PASS | `[PASS] 2.1 会话 A(旧)回合完成且系统提示含基线标记 — session=session-91349102-f1da-48f3-8144-fd083c49e51e`（session/events 中 `system/message` 且 `source.kind=system-prompt` 文本含 `T7_E2E_PERSONA_BASE alpha`） |
| 2.2 | 会话 A 系统提示不含 V2 新文本（尚未保存） | PASS | `[PASS] 2.2 会话 A 系统提示不含 V2 新文本(尚未保存)` |

### 阶段 3：读端点基线（snapshot / prompt-get / prompt-versions）

| # | 断言 | 结果 | 证据（原文摘录） |
| --- | --- | --- | --- |
| 3.1 | snapshot.channel.kind=A-patch-hmr（通道 A） | PASS | `[PASS] 3.1 snapshot: channel.kind=A-patch-hmr(通道 A)` |
| 3.2 | snapshot.persona.available 且含基线标记 | PASS | `[PASS] 3.2 snapshot: persona.available 且含基线标记 — bytes=25` |
| 3.3 | snapshot.versions.ready=true（storage 栈挂载） | PASS | `[PASS] 3.3 snapshot: versions.ready=true(DSH storage 栈挂载) — count=1` |
| 3.4 | snapshot.pendingApproval=null | PASS | `[PASS] 3.4 snapshot: 无在途审批` |
| 3.5 | snapshot.trace.pipeline=v0-disk-log | PASS | `[PASS] 3.5 snapshot: trace.pipeline=v0-disk-log` |
| 3.6 | prompt-get.effectiveNote 提示新会话生效 | PASS | `[PASS] 3.6 prompt-get: effectiveNote 提示新会话生效`（effectiveNote=`保存对新会话生效(无需重启);进行中会话与 KV-cache 前缀不受影响。影响:新会话前缀将变化。`） |
| 3.7 | prompt-versions: initial 种子（seq=1/source=initial/parentId=null） | PASS | `[PASS] 3.7 prompt-versions: initial 种子(seq=1,source=initial,parentId=null) — id=v-000001-dfa77aa1` |
| 3.8 | initial checksum=sha256(content) 且内容=基线 | PASS | `[PASS] 3.8 prompt-versions: initial checksum=sha256(content) 且内容=基线 — total=1` |

### 阶段 4：断言链①——前端发起 persona 修改 → R3 审批卡出现（两段式第一段）

| # | 断言 | 结果 | 证据（原文摘录） |
| --- | --- | --- | --- |
| 4.1 | 乐观锁取 prompt-versions.versions[0].id 作 baseVersionId | PASS | `[PASS] 4.1 乐观锁取最新版本作 baseVersionId(versions[0]=seq 最大) — baseVersionId=v-000001-dfa77aa1 seq=1` |
| 4.2 | prompt-save 一段 status=approval-required | PASS | `[PASS] 4.2 prompt-save(一段): status=approval-required` |
| 4.3 | R3 审批卡（grade=R3 + ruleId） | PASS | `[PASS] 4.3 prompt-save(一段): R3 审批卡(grade=R3 + ruleId) — ruleId=basis.prompt-studio.persona-write` |
| 4.4 | doubleConfirm→2 个 questionItems | PASS | `[PASS] 4.4 prompt-save(一段): doubleConfirm→2 个 questionItems — items=2` |
| 4.5 | patch 未落盘（V2 未写，等审批） | PASS | `[PASS] 4.5 prompt-save(一段): patch 未落盘(V2 未写,等审批)` |
| 4.6 | snapshot.pendingApproval 出现且 id 一致（R3 卡在途） | PASS | `[PASS] 4.6 snapshot: pendingApproval 出现且 id 一致(R3 卡在途) — approvalId=ap-2fb29faf-745d-41c5-b854-06cb73440341` |

### 阶段 5：断言链②——允许一次 → 版本 +1（checksum 变化）（两段式第二段）

| # | 断言 | 结果 | 证据（原文摘录） |
| --- | --- | --- | --- |
| 5.1 | prompt-save 二段 status=committed | PASS | `[PASS] 5.1 prompt-save(二段): status=committed` |
| 5.2 | 版本 +1（source=save，seq=写前+1） | PASS | `[PASS] 5.2 prompt-save(二段): 版本 +1(source=save, seq=写前+1) — seq=2 prevTotal=1` |
| 5.3 | checksum 变化（=sha256(新文本)，≠写前基线） | PASS | `[PASS] 5.3 版本 checksum 变化(=sha256(新文本),≠写前基线)`（新版本 checksum=`01e4bd353996bce9…`，审计 `prompt-save.committed` 同值，见 11.x） |
| 5.4 | patch 层已原子更新（含 V2 文本） | PASS | `[PASS] 5.4 prompt-save(二段): patch 层已原子更新(含 V2 文本)` |
| 5.5 | 在途审批已清 | PASS | `[PASS] 5.5 prompt-save(二段): 在途审批已清` |
| 5.6 | 保存后 8s 宿主日志无 skipping/incompatible（HMR 洁净） | PASS | `[PASS] 5.6 保存后宿主日志无 skipping/incompatible(HMR 洁净)` |
| 5.7 | 宿主进程 pid 未变（未重启，通道 A） | PASS | `[PASS] 5.7 宿主进程 pid 未变(未重启) — pid=72908`（与 1.1 同 pid） |

### 阶段 6：断言链③——新会话系统提示含新文本（真模型回合 + bash 工具 + 宿主审批点应答）

> 审批点驱动方式：会话 B 回合内模型按指示以 `sandbox_permissions: danger-full-access + justification` 调 bash（严格更宽升级必经 `ctx.approval.request`）→ 宿主 `approval/asked` 审计对 → 审批瀑布经官方 `$events` 流（`/api/remote.mux` WebSocket mux，owner client + interactions=answer）投递本脚本 → 以 HTTP `/api/$events/result` 应答 `allowed-once`——与浏览器 owner client 同一协议。

| # | 断言 | 结果 | 证据（原文摘录） |
| --- | --- | --- | --- |
| 6.1 | 官方 $events 流就绪（owner client） | PASS | `[events] $events stream ready clientId=cf63cf8c-fb76-45ce-9e59-d7a7a15a9f02` → `[PASS] 6.1 官方 $events 流就绪(owner client,interactions=answer)` |
| 6.2 | 会话 B（新）系统提示含新文本 V2（保存即对新会话生效，无需重启） | PASS | `[events] waterfall approval/request eventId=0953a972-c7db-46ad-9531-f700c4f02105 request={"toolName":"bash","callId":"call_00_RqxoTlpCGNCeCQBD7u0u1030","reason":"escalate sandbox to danger-full-access: T7.5 e2e 审批点留痕",…}` → `[events] approval answered allowed-once (#1 …)` → `[PASS] 6.2 会话 B(新)系统提示含新文本 V2(通道 A:保存即对新会话生效) — session=session-6366de4d-5db6-4cdd-a814-697e4b341639` |
| 6.3 | 宿主审批点已应答 allowed-once | PASS | `[PASS] 6.3 会话 B 宿主审批点已应答 allowed-once(approval 瀑布走官方 $events) — answered=1` |

### 阶段 7：断言链④——循环轨迹端点返回该会话轮次树（含工具调用与审批点）

| # | 断言 | 结果 | 证据（原文摘录） |
| --- | --- | --- | --- |
| 7.1 | trace(sessionId=B) 返回该会话轮次树（selected 非空，sessions 空） | PASS | `[PASS] 7.1 trace(sessionId=B): 返回该会话轮次树(selected 非空,sessions 空) — turns=1` |
| 7.2 | 轮次树含工具调用（callId/name/argsPreview/durationMs 结构） | PASS | `[PASS] 7.2 trace(B): 轮次树含工具调用(callId/name/argsPreview/durationMs) — tools=bash` |
| 7.3 | 轮次树含审批点（outcome=allowed-once，decidedAt 回填） | PASS | `[PASS] 7.3 trace(B): 轮次树含审批点(outcome=allowed-once,decidedAt 回填) — points=[{"name":"bash","outcome":"allowed-once"}]` |
| 7.4 | 真模型 usage 计入轮次（inputTokens/outputTokens/totalTokens） | PASS | `[PASS] 7.4 trace(B): 真模型 usage 计入轮次(inputTokens/outputTokens/totalTokens) — usageTurns=1` |
| 7.5 | 事件投影计数（total≥projected，skipped 记坏行） | PASS | `[PASS] 7.5 trace(B): 事件投影计数(total>=projected,skipped 记坏行) — total=30 projected=8 skipped=0` |
| 7.6 | trace 列表模式：最近会话清单含会话 B | PASS | `[PASS] 7.6 trace 列表模式: 最近会话清单含会话 B(标题/轮次/usage 折叠) — sessions=session-6366de4d-5db6-4cdd-a814-697e4b341639,session-91349102-f1da-48f3-8144-fd083c49e51e` |
| 7.7 | snapshot.trace.recent 同步含会话 B | PASS | `[PASS] 7.7 snapshot.trace.recent 同步含会话 B — recent=2` |

### 阶段 8：断言链⑤——旧会话不含新文本

| # | 断言 | 结果 | 证据（原文摘录） |
| --- | --- | --- | --- |
| 8.1 | 旧会话 A 补轮后系统提示仍不含新文本 V2（进行中会话不受影响） | PASS | `[PASS] 8.1 旧会话 A 补轮后系统提示仍不含新文本 V2(进行中会话不受影响) — session=session-91349102-f1da-48f3-8144-fd083c49e51e` |

### 阶段 9：断言链⑥——回滚产生新版本且旧版本仍在

| # | 断言 | 结果 | 证据（原文摘录） |
| --- | --- | --- | --- |
| 9.1 | prompt-rollback 一段 status=approval-required | PASS | `[PASS] 9.1 prompt-rollback(一段): status=approval-required` |
| 9.2 | 二段 committed 且 source=rollback | PASS | `[PASS] 9.2 prompt-rollback(二段): committed 且 source=rollback — seq=3` |
| 9.3 | parentId=被回滚版本 | PASS | `[PASS] 9.3 prompt-rollback(二段): parentId=被回滚版本 — parentId=v-000001-dfa77aa1` |
| 9.4 | 新版本内容=被回滚内容（checksum 一致） | PASS | `[PASS] 9.4 prompt-rollback(二段): 新版本内容=被回滚内容(checksum 一致)` |
| 9.5 | 版本只增不删：total=写前+1 且 initial 版本仍在 | PASS | `[PASS] 9.5 版本只增不删:total=写前+1 且 initial 版本仍在 — total=3 prev=2` |
| 9.6 | 回滚后 patch 层回到被回滚内容（无 V2 文本） | PASS | `[PASS] 9.6 回滚后 patch 层回到被回滚内容(无 V2 文本)` |

### 阶段 10：断言链⑦⑧⑨——导出 checksum 正确 → 篡改导入被拒 → 原样导入成新版本

| # | 断言 | 结果 | 证据（原文摘录） |
| --- | --- | --- | --- |
| 10.1 | pack.checksum=sha256(persona)（UTF-8 口径，与源版本一致） | PASS | `[PASS] 10.1 prompt-export: pack.checksum=sha256(persona)(UTF-8 口径) — checksum=01e4bd353996…` |
| 10.2 | 包字段（schemaVersion=1/sourceVersionId/exportedBy/exportedAt） | PASS | `[PASS] 10.2 prompt-export: 包字段(schemaVersion=1/sourceVersionId/exportedBy/exportedAt)` |
| 10.3 | 缺省导出=最新版本 | PASS | `[PASS] 10.3 prompt-export: 缺省=最新版本 — latest=v-000003-27677488` |
| 10.4 | 导出只读不走审批（版本数不变、无在途卡） | PASS | `[PASS] 10.4 prompt-export: 只读不走审批(版本数不变、无在途卡) — total=3 pending=null` |
| 10.5 | 删除导出内一行再导入 → rejected（checksum 强校验拒收） | PASS | `[PASS] 10.5 prompt-import(删一行篡改): status=rejected(checksum 强校验拒收) — issues=["导入包校验和不符:期望 01e4bd353996bce93beadc472d21c0991c3369a73594cd9621ea7ae3dc2f4d59,实际 ab5dab88fcf21b35618426abcfd0401a640b0122acda8f646bd57256854de0e4(persona 与 checksum 不配套,拒收)"]` |
| 10.6 | rejected issues 明示校验和不符 | PASS | `[PASS] 10.6 rejected issues 明示校验和不符 — issues=["导入包校验和不符:…(persona 与 checksum 不配套,拒收)"]` |
| 10.7 | 拒收未入库（版本数不变） | PASS | `[PASS] 10.7 拒收未入库(版本数不变) — total=3` |
| 10.8 | 原样导入一段 status=approval-required | PASS | `[PASS] 10.8 prompt-import(原样,一段): status=approval-required` |
| 10.9 | 导入一段 R3 审批卡（与保存同门，doubleConfirm 2 问） | PASS | `[PASS] 10.9 prompt-import(一段): R3 审批卡(与保存同门)` |
| 10.10 | 原样导入二段 committed 且 source=import | PASS | `[PASS] 10.10 prompt-import(二段): committed 且 source=import — seq=4` |
| 10.11 | 导入新版本 checksum=原包 checksum（与 save 版本同内容） | PASS | `[PASS] 10.11 导入新版本 checksum=原包 checksum(与 save 版本同内容)`（= `01e4bd353996bce9…`，见审计表） |
| 10.12 | 版本链完整：total=拒收前+1，initial 仍在，新→旧有序 | PASS | `[PASS] 10.12 版本链完整:total=拒收前+1,initial 仍在,新→旧有序 — total=4 latest=v-000004-cf13d327` |

### 阶段 11：断言链⑩——governance 审计事件含以上每次写操作（G5）

> 审计落点：本 profile 无 glue governance 插件 → 走包内兜底 `AuditProjector + FileAuditSink`，落 `<DSH_HOME>/basis-prompt-studio/audit.jsonl`（NDJSON 包络 `{kind:'governance',at,detail:{system,action,operator,…}}`，与 governance sink 契约同形；glue 在场时同一载荷经 `reportGovernance` 走既有 sink 链）。

| # | 断言 | 结果 | 证据（原文摘录） |
| --- | --- | --- | --- |
| 11.1 | 兜底审计 NDJSON 存在 | PASS | `[PASS] 11.1 兜底审计 NDJSON 存在(无 glue governance 场景) — /Users/sunny/code/agent-basis/.basis-home-t7/basis-prompt-studio/audit.jsonl` |
| 11.2 | 包络形态（kind=governance + at + detail.action） | PASS | `[PASS] 11.2 审计记录为包络形态({kind:governance,at,detail:{action,…}}) — records=7 sample={"kind":"governance","at":"2026-11-06T20:30:27.136Z","detail":{"system":"basis-prompt-studio","action":"prompt-save.approval-requested",…` |
| 11.3 | save 写链路留痕：approval-requested + committed | PASS | `[PASS] 11.3 save 写链路留痕:approval-requested + committed` |
| 11.4 | rollback 写链路留痕：approval-requested + committed | PASS | `[PASS] 11.4 rollback 写链路留痕:approval-requested + committed` |
| 11.5 | import 写链路留痕：rejected(篡改) + approval-requested + committed(原样) | PASS | `[PASS] 11.5 import 写链路留痕:rejected(篡改)+ approval-requested + committed(原样)` |
| 11.6 | committed 事件含 G5 字段（system/operator/versionId/at/checksum） | PASS | `[PASS] 11.6 committed 事件含 G5 字段(system/operator/versionId/at/checksum) — committed=3 operators=t7-e2e`（逐条：`prompt-save.committed versionId=v-000002-fddb0ecd checksum=01e4bd353996bce9`；`prompt-rollback.committed versionId=v-000003-27677488 checksum=ab5dab88fcf21b35`；`prompt-import.committed versionId=v-000004-cf13d327 checksum=01e4bd353996bce9`） |
| 11.7 | approval-requested 事件含操作者与在途审批 id | PASS | `[PASS] 11.7 approval-requested 事件含操作者与在途审批 id — requested=3` |
| 11.8 | rejected 事件含校验失败明细（issues） | PASS | `[PASS] 11.8 rejected 事件含校验失败明细(issues) — issues=["导入包校验和不符:…"]` |

审计文件全文（记录运行，7 条，`kind|action|operator|versionId|at|checksum` 摘要）：

```
governance | prompt-save.approval-requested      | operator=t7-e2e | versionId=None        | at=2026-11-06T20:30:27.136Z | checksum=None
governance | prompt-save.committed               | operator=t7-e2e | versionId=v-000002-fddb0ecd | at=2026-11-06T20:30:27.266Z | checksum=01e4bd353996bce9
governance | prompt-rollback.approval-requested  | operator=t7-e2e | versionId=None        | at=2026-11-06T20:30:39.546Z | checksum=None
governance | prompt-rollback.committed           | operator=t7-e2e | versionId=v-000003-27677488 | at=2026-11-06T20:30:39.676Z | checksum=ab5dab88fcf21b35
governance | prompt-import.rejected              | operator=t7-e2e | versionId=None        | at=2026-11-06T20:30:39.699Z | checksum=None
governance | prompt-import.approval-requested    | operator=t7-e2e | versionId=None        | at=2026-11-06T20:30:39.705Z | checksum=None
governance | prompt-import.committed             | operator=t7-e2e | versionId=v-000004-cf13d327 | at=2026-11-06T20:30:39.808Z | checksum=01e4bd353996bce9
```

### 阶段 12+13：磁盘证据与清理

| # | 断言 | 结果 | 证据（原文摘录） |
| --- | --- | --- | --- |
| 12.1 | 版本库单元落 DSH storage 栈（一文档一记录，数=total） | PASS | `[PASS] 12.1 版本库单元落 DSH storage 栈(一文档一记录,数=total) — docs=4 total=4`（盘面 `<home>/storages/basis_prompt_studio/versions/`：`v-000001-dfa77aa1.json / v-000002-fddb0ecd.json / v-000003-27677488.json / v-000004-cf13d327.json`） |
| 13.1 | 清理：宿主已停、端口 3108 已释放 | PASS | `[PASS] 13.1 清理:宿主进程已停止、端口 3108 已释放`（收尾复核 `lsof -iTCP:3108 -sTCP:LISTEN` 空、`pgrep -fl 't7-studio'` 空） |

## 3. 断言链覆盖对照（计划书 §6 T7.5 行）

| 计划书断言链 | 覆盖断言 | 结果 |
| --- | --- | --- |
| 修改 → R3 审批 | 4.1–4.6（两段式第一段：R3 卡 + doubleConfirm + patch 未落盘 + 在途卡可见） | 全 PASS |
| 允许一次 → 版本 +1（checksum 变化） | 5.1–5.5（committed、seq=2、checksum=sha256(新文本)≠基线、patch 原子更新） | 全 PASS |
| 新会话系统提示含新文本（旧会话不含） | 6.2（会话 B 含 V2）+ 8.1（会话 A 补轮不含 V2）；通道 A 全程 pid 不变（5.7） | 全 PASS |
| 循环轨迹端点返回该会话轮次树（含工具调用与审批点） | 7.1–7.7（turns 树 + `tools=bash` + `points=[{"name":"bash","outcome":"allowed-once"}]` + usage + 投影计数 + 列表/recent 同步） | 全 PASS |
| 回滚产生新版本且旧版本仍在 | 9.1–9.6（seq=3、parentId=被回滚版本、total=3、initial 仍在、patch 回落） | 全 PASS |
| 导出 JSON 包 checksum 正确 | 10.1–10.4（pack.checksum=sha256(persona)=源版本 checksum；缺省=最新；只读不走审批） | 全 PASS |
| 删除该导出内一行再导入应被校验拒绝 | 10.5–10.7（rejected + issues 明示校验和不符 + 未入库） | 全 PASS |
| 重新原样导入成功成为新版本 | 10.8–10.12（两段式 committed、source=import、checksum=原包、版本链完整 total=4） | 全 PASS |
| governance 审计事件含以上每次写操作 | 11.1–11.8（7 条记录覆盖 save/rollback/import 的 approval-requested/committed/rejected，G5 字段齐全） | 全 PASS |

## 4. 遗留说明（非阻塞）

1. **审批点的触发方式**：默认组合（`approval/policy=ask` + `sandbox=workspace-write`）下，沙箱内 bash 命令（如 `echo`）**不触发**宿主审批（首次运行实证：工具直跑，`approvalPoints=[]`）。验收里审批点由「bash 升级到 `danger-full-access`（严格更宽模式必经 `ctx.approval.request`）」确定性触发，经官方 `$events` 瀑布协议应答——这是真实浏览器 owner client 的同一链路，不是测试专用旁路。
2. **审计落点**：验收 profile 未装 glue（`@basis/governance` 服务缺席），审计走包内兜底 FileAuditSink；glue 在场时 `StudioAudit.write` 优先经 `ctx.governance.audit.reportGovernance` 走既有 sink 链（`packages/prompt-studio/src/audit.ts:56-70`），载荷形态不变。
3. **E2E 与其他门禁的关系**：本报告只覆盖 T7.5 集成 E2E；verify/smoke/replay 三道门禁由编排脚本统一跑（G1 `@basis/prompt-studio verify`、G2 `scripts/t7-smoke.mjs`、G4 replay 金集），本验收未重跑、亦未改动 `scripts/t7-smoke.mjs`。
