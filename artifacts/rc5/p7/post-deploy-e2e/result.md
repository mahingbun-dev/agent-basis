# 生产端到端回归验证结果（rc.5 上线后 · 2026-11-21）

> 目标：「部署完成后，对整个系统进行端到端回归验证；出现问题马上修复，再走提交合并和部署流程，直到完全没问题」。
> 结论：**API 面 12/12 PASS + 浏览器面 PASS + verify.sh 14/0；未发现产品缺陷，无需返工部署**。
> 生产态：`eterna-agent`（`eterna-agent:0.2.0-rc.5` = `sha256:57ab618f…`，main `343ea70` 构建）healthy / restarts=0 / OOM=false。

## 1. 执行面

| 面 | 入口 | 结果 |
|---|---|---|
| API 端到端（PDE-01..12） | 公网 `https://eternity-electricity.cn:3210`（真链路：NAS 反代/TLS/trusted-host） | **12 PASS / 0 FAIL**（`summary.json`） |
| 浏览器端到端（UI 真回合） | 同上，系统 Chrome headless（cookie 注入 eterna_session + dsh-auth） | **PASS**：落地根路径未弹登录、composer 出现、UI 发送「只回复 UI-E2E-OK」→ **14s 内页面出现 mimo 助手回复**（`ui-result.json` + `ui-evidence-*.png`） |
| `deploy/verify.sh` | 本机 3210 | **14 过 / 0 败**（复查两轮） |
| 容器健康 | — | healthy、restarts=0、无 OOM |

## 2. API 面逐项（摘要，全文见 `summary.json`）

| id | 断言 | 实测 |
|---|---|---|
| PDE-01 | 匿名门禁 | `me` 401；根 302 → /login |
| PDE-02 | 管理员登录 | eterna_session 下发、me 200 |
| PDE-03 | dsh 铸票 + 会话清单 | /connect 换 dsh-auth + 合并罐 → `session/list` ok（127 items） |
| PDE-04 | 模型面 | routable 含 mimo；默认 `mimo/mimo-v2.6-pro` |
| PDE-05 | 建会话+改名 | ok（`E2E-PROD-回归-<ts>`） |
| PDE-06 | **真·模型回合** | admitted → cursor 推进 → assistant 文本含 `PROD-E2E-OK` |
| PDE-07 | terminal churn ×2 | create/close 全成功；list 无 running |
| PDE-08 | 个人 MCP 管理面 | catalog ok（items 空 + hostWhitelist） |
| PDE-09 | chat-import 门 | 匿名 401；登录后过门（无载荷 400 属处理器预期） |
| PDE-10 | companion 中继 | 9310 `/api/status` 200 + `/companion/guide` 200 |
| PDE-11 | 测试会话清理 | `workspace/archiveSession` ok |
| PDE-12 | 审计追加 | 行数 103 → 110（+7） |

## 3. 浏览器面

- cookie 注入后打开公网根路径：**未重定向登录页**（eterna_session 生效）；
- composer 出现（textarea）；输入并发送后 **11–14s** 页面渲染出助手回复——断言严格化：**页面标记出现 ≥2 处（用户气泡 + 助手回复）且服务端 `session/events` 里存在 `role=assistant` 且文本含 `UI-E2E-OK`**，双确认通过（真实 UI → 真实 webchat Trigger → mimo 回合 → 投影上屏，全链路真组件）；
- UI 落点：应用会把回合写进「最近会话」；三次落点 `fc347f08 / d2164842 / c74de867` 均为**迁移前创建、零事件的空白会话**（无用户内容），测试回合后已全部归档出主列表；
- console 噪声：仅 `ws://127.0.0.1:9230/ingest` 连接失败 ×6–7 —— 上游 web-app 对本机 inspector 端口的上报，浏览器侧必然不可达，**非功能错误**（与 rc.5 合并无关的既知上游行为）；
- 证据：`ui-result.json`（loggedIn/composerFound/turnOk/serverAssistantHit 全 true）+ `ui-evidence-loaded.png` / `ui-evidence-reply.png`。

## 4. 生产足迹与清理

- 会话：API 面每轮 1 个标注会话（跑完即归档）；诊断轮 4 个散会话已归档；UI 面 3 个落点（均为迁移前空白会话）已归档——生产会话列表无测试残留；
- 终端：create/close 全部回收（list=0 running）；无 settings 写（模型面只读）；
- 审计：+7 行留痕。

## 5. 排障记录（runner 侧修正，非产品缺陷）

1. dsh-auth 与 eterna_session 必须**合并 cookie 罐**调用（单罐 → `tenant/unauthenticated`）；
2. `workspace/list` 在 rc.5 **不存在**（E2 provision 的 workspaceList 本就是从未断言的软探针，恒 null）→ 改用守卫专路 `session/list`；
3. `session/events` 守卫形状是 `{request:{address:{kind:'session',sessionId},maxMessages}}`；assistant 文本在 `records[].event.data.message.content[].text`；
4. `terminal/list` 载荷为顶层 `{sessionId}`、返回数组；`session/delete` 不存在 → 清理用 `workspace/archiveSession`；
5. companion 中继面在宿主映射端口 **9310**（web 3210 上为 404）。

## 6. 判定

部署后系统端到端回归**全部通过**；无产品问题需要修复，故「修复→再合并→再部署」循环未触发。
剩余为文档性收尾：本结果入库（PR）+ 上线后 24h 观察（承担 24h 豁免残余风险）+ 四方补签。