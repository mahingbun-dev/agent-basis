# @eterna/knowledge-admin

账号隔离的知识库管理插件:左侧栏「知识库」入口 + keyed 工作台(文档浏览/编辑/废弃、提案审批、检索问答、Markdown 与仓库导入、成员权限、审计、DeepWiki 源探测)。

- **后端**:DeepWiki / DeepWiki-Open(自建开源 LLM wiki,可配 baseUrl,缺省 `http://127.0.0.1:8001`)+ 本机 `wiki-local`(复用 `@eterna/knowledge` 的 `WikiLocalBackend`)兜底。
- **账号隔离**:按 DSH 当前登录账号分库(`<tenantRoot>/<account>/knowledge.wiki`),插件内**不做登录**、不碰 access 的 `users.db`、不读任何人名。

## 安装形态

| 项 | 值 |
|---|---|
| bundle 入口 | `cordis.patch.yml` → `- insert: [{ id: eterna-knowledge-admin, name: '@eterna/knowledge-admin' }]` |
| Host 入口 | `exports["."] = ./src/index.ts`(仓库形态)/ `./dist/index.js`(tsc `tsconfig.build.json` 产物,部署形态) |
| Client 入口 | `dsh.client` → `src/client/index.js`(仓库源)/ `./lib/client.js`(`scripts/build-client.mjs` 发布产物) |
| 自检 | `pnpm verify`(= `build:client` + render-smoke + `oxlint` + `tsc --noEmit` + `vitest run`) |

## 仓库形态与部署形态(两处真值,2026-11-19 起入库)

- **仓库**(packages/knowledge-admin):源码真值源。`lib/`、`dist/` 是构建产物,不入库。
- **生产部署**(eterna-agent 容器 `/data/workspaces/Mr.Ma/kh-admin-plugin`):profile 经
  symlink 装载该目录;改动流程 = 容器内改源 → `node scripts/build-client.mjs` →
  `/repo/node_modules/.bin/tsc -p tsconfig.build.json` → 重启容器生效,然后**镜像回仓库**
  (本次入库即首轮回写,含三处生产修复:当前账号 self 判定、成员权限 React#130、
  importRepo 路径锁账号目录)。

## 三张脸(同一个 service 实例)

| 面 | 入口 | 身份来源 |
|---|---|---|
| Remote 网关 | `EternaKnowledgeAdminGateway extends TypertRemoteService`,`eternaKnowledgeAdmin/<method>` × 17 | 网关无 cookie 身份 → 恒 `LOCAL_CALLER`(Agent/SRC 面) |
| 路由面 | `KnowledgeAdminRouteFace`,`/api/knowledgeAdmin/<method>` | **access 守卫**注入 `{ account, admin, userId }` |
| 工具面 | `knowledge_admin`(action 表见下) | `exec.agent.session.id` → 反查账号 |

浏览器**只走**路由面(守卫注入真人身份);网关面给 Agent/SRC,不猜 cookie。

## 17 个方法与字段契约(wire 参数键 `args`)

统一封套:`{ ok: true, value }` | `{ ok: false, code, message }`,`code ∈ forbidden | unauthorized | invalid | unavailable | not_found | state | internal`。
所有方法通用可选字段 `account`(目标账号;缺省/空 = 本人;`*` = 全局库,仅管理员)。

| # | method | 守卫 | 读/写 | 管理员专属 | args 字段 | value 字段 |
|---|---|---|---|---|---|---|
| 1 | `listAccounts` | ✅ | 读 | 否 | `includeAll?` | `accounts: AccountInfo[]` |
| 2 | `overview` | ✅ | 读 | 否 | `account?` | `account, doc_count, pending, deprecated, last_sync?, sources: SourceStatus[]` |
| 3 | `listDocs` | ✅ | 读 | 否 | `account?, query?, status?, limit?, offset?` | `items: DocSummary[], offset, limit, total, has_more` |
| 4 | `readDoc` | ✅ | 读 | 否 | `account?, doc_id` | `doc_id, title, body, tags, provenance, citation, changelog[], wikilinks[]` |
| 5 | `saveDoc` | ✅ | **写** | 否 | `account?, doc_id?, title, body, tags?, origin?, path?, changelog_note?, publish?` | `proposal_id, state, published?{doc_id,source_uri,backend}, note` |
| 6 | `deprecateDoc` | ✅ | **写** | 否 | `account?, doc_id, reason, superseded_by?` | `doc_id, deprecated, undo_token, undo_available, undo_hint` |
| 7 | `listProposals` | ✅ | 读 | 否 | `account?, state?: ('pending'\|'approved'\|'rejected')[], limit?, offset?` | `items: Proposal[], total, has_more` |
| 8 | `reviewProposal` | ✅ | **写** | 否 | `account?, proposal_id, decision: 'approve'\|'reject', reason?` | `proposal_id, state, published?, note?` |
| 9 | `discardProposal` | ✅ | **写** | 否 | `account?, proposal_id` | `proposal_id, discarded` |
| 10 | `search` | ✅ | 读 | 否 | `account?, query, top_k?, mode?, include_sources?` | `hits: Hit[], contributed: string[], degraded: {source,reason}[]` |
| 11 | `ask` | ✅ | 读 | 否 | `account?, question, top_k?` | `answer, citations: Provenance[], model{provider,model}` |
| 12 | `importMarkdown` | ✅ | **写** | 否 | `account?, documents: {title,body,tags?,origin?,path?}[]` | `created, failed, proposals[]` |
| 13 | `importRepo` | ✅ | **写** | 否 | `account?, repo_path, engine?: 'spawn'\|'stub', max_files?` | `engine, created, failed, reason, proposals[]` |
| 14 | `listMembers` | ✅ | 读 | 否 | `account?` | `members: {member_user_id,level,updated_at}[]` |
| 15 | `setMember` | ✅ | **写** | 否 | `account?, member_user_id, level: 'owner'\|'editor'\|'viewer'\|'remove'` | `member?, removed?` |
| 16 | `listAudit` | ✅ | 读 | 否 | `account?, action?, since?, until?, limit?, offset?` | `items: AuditEntry[], total, has_more` |
| 17 | `testSource` | ✅ | 读 | 否 | `source?: 'deepwiki'\|'wiki-local', base_url?, bearer_ref?, owner?, repo?` | `source: SourceStatus` |

**服务面另有(未进 17 方法表,不 pin 端点)**:`undoDeprecate(caller, { account?, undo_token })` —— 30 分钟一次性撤销句柄。要开放给 UI 需先补进 `KNOWLEDGE_ADMIN_METHOD_SPECS`。

### 语义要点

- `saveDoc` 缺省**发布**(管理面 = 人在审);`saveDoc(publish=false)` 与 `importMarkdown` / `importRepo` 只落 **pending 提案**,永不直接发布。
- `reviewProposal` 只接受显式 `approve` / `reject`(不猜);`decided_by = 'knowledge-admin:<account>'`。
- `ask` 无命中或无 LLM/模型选择 → `{ ok:false, code:'unavailable' }`,**不编造答案**。
- `testSource` 的 `base_url`/`bearer_ref` 只做本次探测覆盖;令牌**只**经 `ctx.get('credentials').resolve(ref)`,永不回显、永不落日志。
- 越权:非管理员的目标账号只能是本人(或空),`*` 仅管理员 → 否则 `forbidden`;`account` 缺失/无法解析 → `unauthorized`(fail-closed)。

## 接入 access 守卫(合并片段)

本包**不改** `packages/access/src/tenant.ts`。由 access 侧一行合并:

```ts
// packages/access/src/tenant.ts —— import 区追加
import { KNOWLEDGE_ADMIN_METHOD_SPECS } from '@eterna/knowledge-admin'
// 若 access 不引宿主包,可改用常量表:KNOWLEDGE_ADMIN_METHOD_SPECS 的 endpoint 字段即下方字面量。

// 在 `/api/eternaPanel/snapshot` 注册块之后追加(每方法一次 register)
for (const spec of KNOWLEDGE_ADMIN_METHOD_SPECS) {
  register(`/api/knowledgeAdmin/${spec.method}`, async (rpcId, args, ctx) => {
    const face = serviceOf(deps, 'eternaKnowledgeAdmin') as RouteFace | undefined
    if (face === undefined) return failureFrame(rpcId, 'unavailable', '知识库管理服务未挂载')
    // 守卫注入的唯一身份来源:cookie → auth → store.getUserById(userId)
    const caller = { account: ctx.account ?? '', admin: ctx.userId !== undefined && deps.store.getUserById(ctx.userId)?.role === 'admin', userId: ctx.userId ?? 0 }
    return await face.call(spec.method, (args.payload ?? args.input ?? {}) as Record<string, unknown>, caller)
  })
}
```

`RouteFace` 接口(`src/route-face.ts`):

```ts
interface RouteFace {
  readonly id: string                                  // 'eternaKnowledgeAdmin'
  readonly methods: readonly KnowledgeAdminMethod[]    // 17 项
  isGuarded(method: string): boolean
  call(method: string, args?: Record<string, unknown>, caller: KnowledgeAdminCaller): Promise<KnowledgeResult<unknown>>
  wireKey(method: string): 'args'
}
```

`KnowledgeAdminCaller = { account: string; admin: boolean; userId: number }`。

## 工具面 `knowledge_admin`

action:`list | read | search | save | propose | review | deprecate | status | import_markdown | list_proposals`(不实现 `ask` 与权限写)。
`save` 的工具面 `publish` **缺省 false**(Agent 只能提提案,发布由人在工作台确认);`review` 只接受显式 `approve` / `reject`。

## 数据落点(不进 access 目录)

| 内容 | 路径 |
|---|---|
| 账号分库 | `<tenantRoot>/<account>/knowledge.wiki` + `.eterna/knowledge.sqlite3` |
| 全局库(管理员) | `<cwd>/knowledge.wiki` + `<cwd>/.eterna/knowledge.sqlite3` |
| 成员权限表 | `$DSH_HOME/knowledge-admin/access.sqlite3`(`knowledge_permissions(account, member_user_id, level, updated_at)`) |
| 审计 jsonl | `$DSH_HOME/knowledge-admin/knowledge-audit.jsonl`(detail 已脱敏 Bearer/长串/token=) |

`tenantRoot = config.tenantRoot ?? ETERNA_TENANT_ROOT ?? ($DSH_HOME ?? cwd)/workspaces`(与 glue 逐字段对齐)。

## 已知缺口

1. `undoDeprecate` 仅服务面可调,未 pin 端点(见上)。
2. `overview` 每次调用会 `reindexAll()`(页多时开销线性;已按请求复用同一 backend 实例池)。
3. `listDocs` 走**文件系统真相源**,坏页(frontmatter 不合法)跳过不进列表(只在 `overview.sources` 体现)。
4. `importRepo` 的 `spawn` 引擎要求 `<repo>/scripts/wiki-generate.mjs`;缺该脚本时**回落 stub** 并在 `engine`/`reason` 如实标出(导入永不直接发布)。
5. DeepWiki 检索为"拉 wiki 文档 → 本地关键词匹配",不是 DeepWiki 自身的检索接口(需其暴露具体 API 后替换)。
6. `ask` 依赖 `llm` + `agentDefaultModel` 两个服务;缺席即 `unavailable`。
