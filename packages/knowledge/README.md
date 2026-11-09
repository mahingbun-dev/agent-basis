# @eterna/knowledge —— L1 知识插件(wiki-local 默认后端 + WeKnora 高级后端)

设计依据:《11-知识插件-dsh-knowledge可插拔设计》(一个出口,两个后端)、《08-基座插件体系》§3-6、《12-功能点清单》§5。
**一个出口**:模型面只看 `KnowledgeHit` 统一 schema(provenance 全量);**两个后端**:wiki-local(默认,零外部依赖、断网可用、agent 可写、git 版本化)+ weknora(手动启用,NAS 企业 RAG)。

## 模块

| 模块 | 职责 |
|---|---|
| `types.ts` | KnowledgeHit/Provenance/DocRef/KnowledgeBackend 等统一规范类型 |
| `frontmatter.ts` | markdown 页面解析/序列化(status/trust/last_verified/superseded_by/source + changelog 段 + [[wikilink]] 建图);废弃必填 superseded_by;统一引用输出 `[《标题》](source_uri)(更新于…;状态)` |
| `visibility.ts` | 检索可见性硬过滤(纯函数):deprecated、superseded_by 非空、agent_drafted 未过审 → 不可见 |
| `indexer.ts` | node:sqlite 单文件索引:FTS5 **trigram** 分词(中文子串匹配;`detail=none` 实测与短语查询冲突,不采用,见模块注释)+ **短词(<3字符)LIKE 回退**,双路 RRF 融合;可见性过滤在 SQL 层执行;提案表同库 |
| `wiki.ts` | WikiLocalBackend:混合检索(关键词优先,`SemanticSearchProvider` 向量位留接口)+ propose→门禁→发布 流水线 + deprecate(与 RSI 共用语义) |
| `weknora.ts` | WeKnora HTTP 适配器:`POST /api/v1/knowledge-search`(官方 v0.9 文档形态);手动启用,未配置 `not-configured`;凭据经 tokenRef+resolver 注入;fail-soft |
| `rrf.ts` | RRF 融合原语(dual 模式骨架:weknora 权威优先、同源去重) |
| `service.ts` | KnowledgeService(注册表 + `KNOWLEDGE_SERVICE_ID` 唯一 ID,provide 可交换):出口级可见性复滤(纵深防御)+ dual RRF 融合 + fail-soft |
| `tools.ts` | 模型面四工具 `knowledge_search/read/status/propose` + `toDshToolDefinition` 适配(官方 ToolDefinition seam) |

## 写路径(提案制,投毒防线)

```
knowledge_propose(doc) ──▶ 提案(pending,不落 pages/fts,检索不可见)
        │
        ▼ governance 门禁钩子(GovernanceGate 注入;缺省 fail-closed 一律拒绝)
   approve ──▶ 发布:落盘 markdown(trust: verified/official,review: reviewed)+ changelog 追加 + 建索引 ──▶ 此刻起可检索
   reject / 门禁异常 ──▶ 永不出现
```

- 检索统一过滤:status=deprecated 与已被 superseded 的页**物理留档、逻辑不可见**;agent_drafted 未过审页同理。
- 过滤在三层执行:索引器 SQL → backend 出口 → service 出口复滤(纵深防御)。
- Cordis 纪律:`registerBackend`/`reviewProposal`(undo=真删文件+删索引+回 pending)/`deprecate`(undo=恢复原文)均返回配逆闭包;fs/fetch/时钟/门禁/凭据解析器全部构造注入。

## DSH seam(编译期钉住)

`tests/types.seam-pin.ts` 用已发布 `@deepseek-ai/dsh-tools` 0.2.2-alpha.2 类型断言:四工具适配产物可赋给官方 `ToolDefinition`,且 `ctx.tools.register(def)` 返回 Cordis disposer。DSH 升级破坏 seam 形态时 `verify` 的 tsc 阶段即失败。运行时注册联调后置(见 blockers)。

## 使用

```ts
import { WikiLocalBackend, WeKnoraBackend, createKnowledgeService, createNodeFsAdapter, toDshTools } from '@eterna/knowledge'
import * as nodeFs from 'node:fs'

const wiki = new WikiLocalBackend({
  wikiDir: 'knowledge.wiki',
  fs: createNodeFsAdapter(nodeFs),
  gate: async (proposal) => (await humanApproves(proposal) ? { kind: 'approve' } : { kind: 'reject', reason: 'no' }),
})
await wiki.reindexAll()

const service = createKnowledgeService({
  backends: [wiki, new WeKnoraBackend({ enabled: false })], // weknora 手动启用
})
const { hits } = await service.search({ query: '场地选址', top_k: 8 })

// 注册进 DSH:ctx.tools.register(def) 逐个注册(返回 disposer)
const disposers = toDshTools(service).map((def) => ctx.tools.register(def))
```

## verify

```bash
pnpm --filter @eterna/knowledge run verify   # oxlint + tsc --noEmit + vitest run
```

单测覆盖:frontmatter 解析/往返;样例 wiki 建索引检索命中(FTS ≥3 字符 + 短词 LIKE 回退 + 混合);过期页(deprecated/superseded)不出现;未过审(agent_drafted pending)不出现、已过审可见;propose 流转(propose→pending 不可见→approve 发布可见→undo 真删;reject/fail-closed 永不出现);向量位注入融合与出口复滤;WeKnora 未启用 not-configured/HTTP 形态/映射/fail-soft;RRF 融合与同源去重;四工具出口;DSH seam 钉住。
