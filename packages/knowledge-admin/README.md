# @eterna/knowledge-admin

知识底座插件(**唯一宿主**;2026-11-19 与 glue `knowledge-plugin` 融合):本地知识库四工具
`knowledge_search / knowledge_read / knowledge_status / knowledge_propose` + 管理工具
`knowledge_admin` + 侧栏「知识库」keyed 工作台(文档浏览/编辑/废弃与撤销、提案审批、检索问答、
Markdown 与仓库导入、成员权限、审计、DeepWiki 源探测)。

- **装载形态**:内置 baked row —— profile 模板 / `profiles/eterna-{web,super}` 内
  `- id: eterna-knowledge` / `name: '@eterna/knowledge-admin'`。装载 id 与显示名「知识底座」
  保持历史值;不再走 bundle 安装(旧卷遗留的 `dsh.profile.bundles` 登记由 entrypoint 幂等清理)。
- **后端**:`wiki-local`(复用 `@eterna/knowledge` 的 `WikiLocalBackend`,单 `BackendPool`
  按绝对路径 keyed)+ DeepWiki / DeepWiki-Open(可选,`baseUrl` 缺省 `http://127.0.0.1:8001`)。
- **账号隔离**:按 DSH 登录账号物理分库(`<tenantRoot>/<account>/knowledge.wiki`);插件内
  **不做登录**、不写 access 的 `users.db`(只读查询会话归属)。

## 安装形态

| 项 | 值 |
|---|---|
| 装载行 | `- id: eterna-knowledge` / `name: '@eterna/knowledge-admin'`(模板 + web/super profiles) |
| Host 入口 | `exports["."] = ./src/index.ts`(Node 24 type-stripping 直读;`dist/` 仅排查用) |
| Client 入口 | `dsh.client` → `./lib/client.js`(`scripts/build-client.mjs` = esbuild 打包,`@eterna/ui/icon-data` 构建期内联,react 家族外置) |
| 自检 | `pnpm verify`(= `build:client` + render-smoke + `oxlint` + `tsc --noEmit` + `vitest run`) |

## 门禁口径(2026-11-19 融合拍板)

| 通道 | caller 形态 | 能做 |
|---|---|---|
| 浏览器面板(access 守卫) | `{ account, admin, userId, human:true }` | 单篇保存**直接发布**;审批/拒绝/丢弃提案;废弃与 30 分钟内撤销 |
| Agent 工具 / Remote 网关 | `{ account, admin, userId, human:false }` | 只读检索/阅读/状态;`knowledge_propose` 与 `knowledge_admin save` **一律 pending**;`review` 已从工具面移除(调用返回 `forbidden`) |

> `human:true` **只由** `packages/access/src/tenant.ts` 的 `knowledgeAdmin/*` 守卫铸出;
> 服务面不信任调用方自觉(`saveDoc`: `publish = caller.human === true && args.publish !== false`;
> `reviewProposal`: `caller.human !== true` → `forbidden`)。

## 三张脸(同一个 service 实例)

| 面 | 入口 | 身份来源 |
|---|---|---|
| Remote 网关 | `EternaKnowledgeAdminGateway extends TypertRemoteService`,`eternaKnowledgeAdmin/<method>` × 18 | 网关无 cookie 身份 → 恒 `LOCAL_CALLER`(Agent/SRC 面,`human:false`) |
| 路由面 | `KnowledgeAdminRouteFace`,`/api/knowledgeAdmin/<method>` × 18 | **access 守卫**注入 `{ account, admin, userId, human:true }` |
| 工具面 | 库层四工具(facade 复用同一 pool)+ `knowledge_admin` | `exec.agent.session.id` → users.db 反查账号(`routing.ts`) |

浏览器**只走**路由面(守卫注入真人身份);网关面给 Agent/SRC。

## 18 个方法与字段契约(wire 参数键 `args`)

统一封套:`{ ok: true, value }` | `{ ok: false, code, message }`,`code ∈ forbidden | unauthorized | invalid | unavailable | not_found | state | internal`。
所有分库方法通用可选字段 `account`(目标账号;缺省 = 管理员全局库 `*`、普通账号本人)。

| # | method | 写 | args 字段 | value 字段 |
|---|---|---|---|---|
| 1 | `listAccounts` | 否 | `includeAll?` | `accounts: AccountInfo[]`(`global`/`self`/`available` 标记) |
| 2 | `overview` | 否 | `account?` | `account, doc_count, proposal_pending, proposal_approved, proposal_rejected, last_sync?, sources[], degraded?` |
| 3 | `listDocs` | 否 | `account?, query?, status?, limit?, offset?` | `items, offset, limit, total, has_more` |
| 4 | `readDoc` | 否 | `account?, doc_id` | `doc_id, title, body, tags, provenance, citation, changelog[], wikilinks[]` |
| 5 | `saveDoc` | **写** | `account?, doc_id?, title, body, tags?, origin?, path?, changelog_note?, publish?` | `proposal_id, state, published?, note` |
| 6 | `deprecateDoc` | **写** | `account?, doc_id, reason, superseded_by?` | `doc_id, deprecated, undo_token, undo_available, undo_hint` |
| 7 | `undoDeprecate` | **写** | `account?, undo_token` | `undone: true` |
| 8 | `listProposals` | 否 | `account?, state?, limit?, offset?` | `items, total, has_more` |
| 9 | `reviewProposal` | **写** | `account?, proposal_id, decision: 'approve'\|'reject', reason?` | `proposal_id, state, published?, note?` |
| 10 | `discardProposal` | **写** | `account?, proposal_id` | `proposal_id, discarded` |
| 11 | `search` | 否 | `account?, query, top_k?, mode?, include_sources?` | `hits, contributed, degraded[]` |
| 12 | `ask` | 否 | `account?, question, top_k?` | `answer, citations[], model{provider,model}` |
| 13 | `importMarkdown` | **写** | `account?, documents: {title,body,tags?,origin?,path?}[]` | `created, failed, proposals[]` |
| 14 | `importRepo` | **写** | `account?, repo_path, engine?, max_files?` | `engine, created, failed, reason, proposals[]` |
| 15 | `listMembers` | 否 | `account?` | `members: {member_user_id,level,updated_at}[]` |
| 16 | `setMember` | **写** | `account?, member_user_id, level: 'owner'\|'editor'\|'viewer'\|'remove'` | `member?, removed?` |
| 17 | `listAudit` | 否 | `account?, action?, since?, until?, limit?, offset?` | `items, total, has_more` |
| 18 | `testSource` | 否 | `account?, source?, base_url?, bearer_ref?, owner?, repo?` | `source: SourceStatus` |

### 语义要点

- `saveDoc` 仅真人通道(`human:true`)且未显式 `publish:false` 时直接发布;Agent/网关即使传
  `publish:true` 也落 **pending**(note 写明「非人工通道不直接发布」)。批量导入恒 pending。
- `reviewProposal` 只接受显式 `approve` / `reject`;非真人通道一律 `forbidden`。
- `knowledge_propose` / `knowledge_admin save` 都映射到 `saveDoc(publish:false)`。
- `ask` 无命中或无 LLM/模型选择 → `{ ok:false, code:'unavailable' }`,**不编造答案**。
- `testSource` 的 `base_url`/`bearer_ref` 只做本次探测覆盖;令牌**只**经
  `ctx.get('credentials').resolve(ref)`,永不回显、永不落日志。
- 越权:非管理员的目标账号只能是本人(或空),`*` 仅管理员 → 否则 `forbidden`。
- `deprecateDoc` 返回 30 分钟一次性 `undo_token`;面板的「撤销废弃」按钮回传
  `undoDeprecate({ account, undo_token })`。

## 工具面(5 个)

| 工具 | 行为 |
|---|---|
| `knowledge_search` | 检索当前身份分库(本地 + 可选 DeepWiki),带 `citation` |
| `knowledge_read` | 读单篇(标题/正文/tags/provenance/citation) |
| `knowledge_status` | 后端健康与文档计数(`statusBackends`) |
| `knowledge_propose` | 落 pending 提案(不发布;审批在面板) |
| `knowledge_admin` | action:`list / read / search / save / propose / deprecate / status / import_markdown / list_proposals`(`save` 恒 pending;`review` 已移除) |

账号路由:`mode=auto`(缺省,无会话/users.db → 全局库;解析失败 fail-closed)/
`per-account`(身份源缺失一律拒绝)/ `global`(恒全局)。admin → 全局库 `*`,
普通账号 → 本人;绝不静默退回全局库。

## 数据落点(不进 access 目录)

| 内容 | 路径 |
|---|---|
| 账号分库 | `<tenantRoot>/<account>/knowledge.wiki` + `.eterna/knowledge.sqlite3` |
| 全局库(管理员) | `<cwd>/knowledge.wiki` + `<cwd>/.eterna/knowledge.sqlite3` |
| 成员权限表 | `$DSH_HOME/knowledge-admin/access.sqlite3`(`knowledge_permissions(account, member_user_id, level, updated_at)`) |
| 审计 jsonl | `$DSH_HOME/knowledge-admin/knowledge-audit.jsonl`(detail 已脱敏 Bearer/长串/token=) |

`tenantRoot = config.tenantRoot ?? ETERNA_TENANT_ROOT ?? ($DSH_HOME ?? cwd)/workspaces`。
SQLite 文件库开启 WAL + `busy_timeout=5000`(索引器与池连接共存的前提)。

## 已知缺口

1. `overview` 每次调用会 `reindexAll()`(页多时开销线性;已按请求复用同一 backend 实例池)。
2. `listDocs` 走**文件系统真相源**,坏页(frontmatter 不合法)跳过不进列表(只在 `overview.sources` 体现)。
3. `importRepo` 的 `spawn` 引擎要求 `<repo>/scripts/wiki-generate.mjs`;缺该脚本时**回落 stub**
   并在 `engine`/`reason` 如实标出(导入永不直接发布)。
4. DeepWiki 检索为"拉 wiki 文档 → 本地关键词匹配",不是 DeepWiki 自身的检索接口(需其暴露具体 API 后替换)。
5. `ask` 依赖 `llm` + `agentDefaultModel` 两个服务;缺席即 `unavailable`。
6. 包名保留历史名 `@eterna/knowledge-admin`(融合后已是知识底座唯一宿主;改名不在本批范围)。