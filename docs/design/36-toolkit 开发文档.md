# 36 - toolkit 开发文档（契约 → 规范化块 → 路由器 → 适配器 → 矩阵探活）

> 状态：开发实施文档（供 workflow 编排直接消费；§7 为执行顺序与并行边界）
> 上游规格：`29-统一工具编排与工具路由-模型定制工具包.md`（全文，重点 §1 五层、§2.3/§2.4、§3、§4、§7 拍板）· `29a-工具供应商研究笔记.md`（R1–R7 字段级结论，全部为**文档级已核实、未实测**——见 §1.8 与附-B 纪律）
> 工作流归属：33 号 **WS-B toolkit**（`33-开发总工作流与门禁.md` §1.3 WS-B 表、§1.4 G3-M2）；toolkit 归 **Tier1、base 可选挂载**（31 号 §5 D1 暂定）
> 关联：`24a`（B4 拍板原文：deepseek → glm → mimo，其余通用兜底，任意模型体感一致）· `24`（§3 chat-demo 范式）· `26`（§4.3 新工具配方）· `30`（§4 UI 铁律）· `packages/llm-openai`、`packages/llm-doctor`、`packages/knowledge`、`packages/governance`
> 日期：2026-11-17
> 纪律：本档不发明 29/29a 之外的任何行为；每条任务两列可追溯（依据条款 / 验收门禁）；设计缺口一律进 §9 开放问题。

---

## 0. 范围与不做什么

**做**（任务链，与 33 号 WS-B「契约→deepseek+generic 并行→glm/mimo→借用→矩阵+doctor」一致）：

| 批次 | 内容 | 对应 29 号 |
|---|---|---|
| K0 | 29 号 §5 研读状态回填 + §2.4 借用措辞修正 | 29a §0 / 附-A；33 G2-B7 |
| M-K1 | 能力契约层 + 规范化块协议 + 工具路由器 | §4 P-1 首行（一切的前置） |
| M-K2 | deepseek 适配器 ∥ generic 兜底（公共金集断言） | §4 P-1 两行 + §2.3 并行纪律 |
| M-K3 | glm 适配器 + mimo 适配器 + 跨供应商借用 | §4 P-2 三行 |
| M-K4 | 部署级能力矩阵 + 矩阵 UI + llm-doctor 逐能力探活 | §3 全表 + §7-4 |

**不做**（均有明确出处，不是遗漏）：

- **P-3 语音供给链完整开发**（原生 ASR/TTS 适配 + FunASR/CosyVoice 自托管兜底服务）——29 §4 P-3 行、§7-2 Q2 拍板「完整开发，不分版本」，但排期为 P-3（M2 后），本档仅在 §8 登记其门禁与 R7 落地推论，不展开规格；
- **tasks 内核 / 工作台**（WS-A/WS-D）——29 §4 明示「与 P1（tasks）无依赖冲突，可并行」，toolkit 独立交付、纯聊天部署受益；
- **llm-openai 改造**——Q5 拍板：llm-openai 保持薄传输层（29 §7-5、§6），toolkit 是能力层，二者分层不同（§2.1 注）；
- **SearXNG / Web Speech API**——Q1/Q2 明示弃用（29 §7-1、§7-2）。

---

## 1. 现实基线（代码事实，2026-11-17 逐条核实）

### 1.1 llm-openai 是传输层，不是能力层

`packages/llm-openai/src/index.ts:33-42`：`ctx.llm.registerConfigurableProviders` + `ctx.llm.registerAdapter([providerRoute], new BasisOpenAIAdapter(...))`——OpenAI 兼容 chat/stream 传输适配。Q5 拍板 toolkit 与它分层不同（29 §6、§7-5），本档零改动该包。

### 1.2 llm-doctor 现状：路由体检 + 逐模型连通性，粒度待升级

- `packages/llm-doctor/src/doctor.ts:16-20` 协议→端点路径表；`:90-100` `probeEndpoint`（GET 非 404 即存在）；`pingRequest/pingModel` 按协议真发极小补全（逐**模型**）。
- 浏览器半边挂官方 `settings.models.provider-card` keyed slot（`packages/llm-doctor/src/client/index.ts:36-37`）——**矩阵 UI 的落点先例**（K4.3）。
- 29 §3 拍板：doctor 升级为**逐能力**探活、覆盖整条借用链；26 号 §2 表「llm-doctor 不变」按 29 号（更新）为准。

### 1.3 搜索供给链第①层现成

`packages/knowledge/src/tools.ts:41` 已注册 `knowledge_search`；`src/index.ts:8` FTS5(trigram)+短词 LIKE 双路 RRF；`src/weknora.ts` WeKnora HTTP 适配。Q1 拍板的「内部知识库优先」直接消费现有工具（29 §7-1 ①）。

### 1.4 governance egress 白名单现成

`packages/governance/src/egress.ts:48-60` `EgressLite.classify` 出网工具三态判定。29 §6 拍板「generic 路径的搜索/读网请求受 egress 白名单约束」；26 号 §4.3 配方明确：工具经 `ctx.tools.register` 注册则 governance pre-execute 瀑布**自动覆盖**，无需工具自写权限。

### 1.5 插件启停与挂载面

`packages/access/src/routes.ts:56` `TOGGLEABLE_PLUGINS`——toolkit 登记处（33 G2-B9）。挂载行先例：`profiles/eterna-web/cordis.patch.yml:55-58`（llm-deepseek 两行）。D1 暂定 toolkit 为 base 可选挂载、admin 可开（31 §5）。

### 1.6 包级命令惯例

`packages/interact/package.json` scripts：`verify = oxlint --config ../../.oxlintrc.json . && tsc --noEmit && vitest run`。全仓链 `package.json:13`（lint-ui-tokens + `pnpm -r --if-present run verify`）。新包命令按 33 §6 缺口 2 为预定形态，包落地即生效。

### 1.7 33 号两处现状缺口（影响本档门禁，非本档职责）

`docs/tiers.yml` 与 `packctl form-check` 尚不存在（33 §6 缺口 1）；G0-6 落地前 Tier 归属以 PR 评审项代替。`docs/design/prototypes/` 目录尚未创建（33 §6 缺口 15），K4.3 若需原型产物（开放问题 O-4）随首个交付创建。

### 1.8 G2-B7 当前不绿（本档 K0 的依据）

本日实测 `grep -c "待研读" docs/design/29-*.md`：29 号 **8 处**（§1 图 2 处 + §5 表 6 处；R4 行为「待复核」不计），29a 号 0 处。29a 已完成六份研究汇编，29 号 §5 状态表未回填——33 G2-B7 门禁（= 0 且逐项含链接）现为红，且 G2-B7 是 glm/mimo 适配器**开工前置**（33 §4 依赖表）。

### 1.9 29a 结论的效力边界（全程纪律）

29a §0：「文档级已核实 = 结论来自官方一手来源，符合『不编造 API 细节』纪律；**字段行为级验证（流式回流位置、错误码实际形态等）留待 toolkit 包级测试与 llm-doctor 逐能力探活**」。因此本档所有适配器测试以 **fixture 回放**为门禁主体，真调验证统一挂 K4.2 doctor 探活（GLM 流式 web_search 回流位置为 29a R1 unresolved-① 的指定处置路径）。

---

## 2. 架构落点与包结构

### 2.1 五层职责（照抄 29 §1，落点如下）

| 层（29 §1） | 职责 | 本仓落点 |
|---|---|---|
| ① 能力契约 | 五能力枚举、声明参数、版本号；不含提供方细节 | `packages/toolkit/src/contract/` |
| ② 工具路由器 | 部署级矩阵查询、参数翻译（声明→提供方 API 形态）；**不执行** | `src/router/` |
| ③ 提供方适配器 | 请求组装、流解析、结果翻译成 ④；**不持会话状态** | `src/adapters/{deepseek,generic,glm,mimo,tavily}`、`src/borrow/` |
| ④ 规范化块协议 | 搜索步骤时间线 / 引用角标 / 来源卡 / 附件引用；渲染与 prompt 的唯一消费物；**禁提供方字段透传** | `src/blocks/` |
| ⑤ 降级语义 | 能力缺失 = 显式禁用态 UI + 接口 unavailable；不假装可用 | 路由器 `unavailable` 结论 + `src/client/` UI |

### 2.2 目录树（新建 `packages/toolkit`，`@eterna/toolkit`）

```
packages/toolkit/
├── package.json              # exports: "." / "./contract" / "./blocks" / "./router" / "./client"
│                             # verify = oxlint(../../.oxlintrc.json) && tsc --noEmit && vitest run
│                             # + build:client（esbuild → window.__ModuleLoader__，AGENTS.md 客户端半边配方，llm-doctor 同款）
├── cordis.patch.yml          # 挂载行（随 K4.4 / G2-B9 落地；D1：base 可选挂载）
├── vitest.config.ts          # node env，tests/**/*.spec.ts（照 interact/knowledge 样板）
├── src/
│   ├── contract/             # K1.2：capabilities.ts（枚举+版本+声明参数）、naming.ts（工具命名规范）、forbidden.ts（禁入清单）
│   ├── blocks/               # K1.3：types.ts（四类规范化块）、guards.ts（提供方字段泄漏防护）
│   ├── router/               # K1.4：matrix.ts（部署级能力矩阵计算）、router.ts（三段式裁决）、translate.ts（参数翻译）
│   ├── adapters/
│   │   ├── deepseek/         # K2.1/K2.2：types.ts（含 R4 7 缺口）、messages.ts（服务端工具+流解析）、files.ts、tools-api.ts（/v1/tools/* 独立端点）
│   │   ├── generic/          # K2.3：loop.ts（function calling 工具循环，R3 八条裁剪）、executors.ts（knowledge→tavily 搜索、/extract 读网、files 混合兜底）
│   │   ├── tavily/           # K2.3：client.ts（/search、/extract、/usage；include_published_date 默认 true）
│   │   ├── glm/              # K3.1/K3.2：chat.ts（tools 声明+顶层 web_search[] 回流）、reader.ts、files.ts（上传→parser→文本入 messages）
│   │   └── mimo/             # K3.3：chat.ts（web_search 声明+annotations 回流+thinking 硬约束）
│   ├── borrow/               # K3.4：borrow.ts（两档借用：独立端点直调 / 最小 chat 请求）+ 回灌
│   ├── client/               # K4.3：矩阵 UI 半边（模型设置页挂载，slot 形态见开放问题 O-3）
│   └── index.ts              # 门面 + createToolkit() 装配
└── tests/                    # 见 §6 门禁总表（文件名与 33 号 G2-B* 对齐）
```

### 2.3 契约类型草案（实现提案，待 O-2 评审后固化为 golden）

> 29/29a 定义了**块类型**与各供应商字段→块的映射来源，未定义 TS 字段集；以下为最小并集草案，每字段标注来源，未经评审不得视为定稿（开放问题 O-2）。

```ts
// contract/capabilities.ts —— 依据 29 §1 ①（五能力，版本化）
export const CAPABILITY_IDS = ['web_search', 'read_url', 'files', 'tts', 'asr'] as const
export type CapabilityId = typeof CAPABILITY_IDS[number]
export const CONTRACT_VERSION = 1          // 版本化机制语义未拍板（O-7），先落常量+断言
export interface CapabilityRequest {       // 应用只声明意图（29 §1 应用层行）
  readonly capability: CapabilityId
  readonly params: Readonly<Record<string, unknown>>   // 各能力参数集见 K1.2
}

// blocks/types.ts —— 依据 29 §1 ④（四类块）+ 29a 字段映射
export interface SourceBlock {             // 来源卡：R1/R2/R6 三家字段并集
  readonly title: string                   // R1 title / R2 title / R6 title
  readonly url: string                     // R1 link / R2 url / R6 url
  readonly summary: string                 // R1 content / R2 summary / R6 content
  readonly publishTime: string | null      // 必须可空：R6 best-estimate 可 null；R1 publish_date；R2 publish_time
  readonly siteName?: string               // R2 site_name（GLM/Tavily 无 → 可选）
  readonly icon?: string                   // R1 icon / R2 logo_url / R6 favicon（可选）
}
export interface CitationBlock { /* 角标序号 + 指向 source 索引；GLM refer=ref_1 ↔ 正文 [来源：ref_1]（R1）*/ }
export interface SearchStepBlock { /* 搜索步骤时间线（deepseek server_tool_use 步骤 / generic 工具调用轮）*/ }
export interface AttachmentRefBlock { /* 附件引用：file_id/名称/上限（deepseek 文档 file_id 引用，R4）*/ }
```

**禁入清单**（`contract/forbidden.ts`，双向）：契约与块侧禁 ① 提供方特有字段——`encrypted_content`、thinking `signature` 等（29 §2.1；signature 多轮原样回传是 deepseek 适配器**内部**行为，R4）；② OpenAI 特有——`strict`/`custom`/`allowed_tools`/`namespace`/`defer_loading`/Responses 全家（`function_call`/`function_call_output`/`previous_response_id` 等）/已废弃 `functions`/`function_call`（29a R3）；③ 工具命名必须 `^[a-zA-Z0-9_-]+$` 且 ≤64（29a R3，写进契约命名规范）。

### 2.4 成本计费口径表（借用诚实代价 + 矩阵数据源，全部引 29a）

| 提供方 | 计费事实 | 出处 |
|---|---|---|
| DeepSeek 独立 Search/Fetch | ¥5/1000 次（与联网工具同价）；Search 100 QPS / Fetch 25 QPS（按账号）；失败/空结果不计费 | 29a R4「独立 Search / Fetch API」行 |
| DeepSeek messages 联网工具 | 一次 search 调用按其包含的**查询词条数**计费（3 词=3 次）；失败/空结果不计费 | 29a R4 web_search 行 |
| DeepSeek Files | 解析 ¥1.5/1000 页 | 29a R4 Files 行 |
| 智谱 web_search | search_std 0.01 元/次、search_pro 0.03、sogou/quark 各 0.05 | 29a R1 web_search 回流行 |
| 智谱语音 | 单价未核实（指向 bigmodel.cn/pricing，本次未抓取） | 29a R1 unresolved-④ |
| MiMo web_search | 国内 ¥16/1000 次（一轮按 max_keyword 次计）+ 搜索内容拼接 prompt 的 token 费 | 29a R2 web_search 行 |
| Tavily | credit 制：search basic/fast/ultra-fast=1、advanced=2；extract 5 URL/credit；免费档 1,000 credits/月；PAYGO $0.008/credit；`GET /usage` 可查余量 | 29a R6 配额行 |

借用措辞以 29a 附-A 合并修正为准：「借用消耗出借方一次**能力侧调用**——独立端点直调（GLM/DeepSeek，按次计费）或最小 chat 请求（MiMo，计 token）」；原拍板句「一次小额模型调用」对 GLM/DeepSeek 出借方不成立（K0 落回 29 号正文）。矩阵是否向用户展示计费信息未拍板（O-6b）。

---

## 3. 任务总览（两列可追溯）

> 类型标注沿用 33 号 §2.1：【C】命令退出码 ·【T】测试文件+断言 ·【A】产物+比对。所有 `packages/toolkit/tests/*` 与 `pnpm --filter @eterna/toolkit run verify` 均并入 G2-B1。编号对齐 33 号 G2-B*。

| # | 任务 | 一句话 | 依据条款 | 验收门禁 |
|---|---|---|---|---|
| **K0** | 29 号回填 | §5 七项状态回填 + §2.4 借用句改写 | 29a §0 回填表、附-A「建议改写为」；33 G2-B7、§4 依赖表 | 【A】`grep -c "待研读" docs/design/29-*.md` = **0** 且逐项含 29a 结论链接（当前实测 8，见 §1.8） |
| **K1.1** | 包骨架 | `@eterna/toolkit` 建包 + verify 链 + vitest 基建 | 29 §4 落点行（新 L1 插件，与 llm-openai/llm-doctor 同族）；33 §6 缺口 2；§1.6 惯例 | 【C】`pnpm --filter @eterna/toolkit run verify` 退出码 0【G2-B1】 |
| **K1.2** | 能力契约层 | 五能力枚举+版本化+声明参数+禁入清单+命名规范 | 29 §1 ①、§2.1、§4 P-1；29a R3 结论表、R2 修正（tool_choice 降级位）、R6 修正（publishTime 可空） | 【T】`tests/contract.spec.ts`：枚举/版本/参数 schema；禁入键静态拒绝（构造含 `strict`/`functions` 的声明必须被 zod 拒绝）；命名规范校验函数正反例 |
| **K1.3** | 规范化块协议 | 四类块类型 + 提供方字段泄漏防护 | 29 §1 ④、§2.1；29a R1/R2/R4/R6 字段映射行 | 【T】`tests/normalized-blocks.spec.ts`【=G2-B3】：四类块 JSON 往返；对全部块样例断言保留键名白名单外零泄漏（`encrypted_content`/`signature`/`web_search_usage` 等不得出现） |
| **K1.4** | 工具路由器 | 部署级矩阵计算 + 三段式裁决 + 参数翻译（不执行） | 29 §1 ②、§2.4、§7-1；29a R4 修正（deepseek 拆两行）、R1（GLM 视觉例外） | 【T】`tests/router.spec.ts`：三段式顺序（原生→借用→兜底）；无路径=unavailable 显式；模型粒度下钻（deepseek flash/v4-pro 两行、GLM 视觉模型无 web_search）；配置集变更→矩阵失效重算；参数翻译纯函数快照 |
| **K2.1** | deepseek 适配器（对话侧） | 服务端工具声明组装 + SSE 块解析归并 + R4 7 缺口 types | 29 §2.2、§4 P-1；29a R4 对照行 | 【T】`tests/providers/deepseek.spec.ts`：SSE fixture 回放（照 chat-demo 事件形态构造）→ 规范化块断言；`WebSearchToolResultError` 6 值枚举映射；`encrypted_content` 不出块 |
| **K2.2** | deepseek files + 独立端点 | purpose 三值 + file_id 引用 + `/v1/tools/search\|fetch` 客户端 | 29a R4 Files 行、独立 Search 行、对 §7-3 修正行；29 §7-3 Q3 | 【T】`tests/providers/deepseek-files.spec.ts`：按文件类型选 purpose（user_data 传 PDF/Word/PPT=400 场景防呆）；≤20 文档/8MiB 上限拒绝；`anthropic-beta: files-api-2025-04-14` 头断言；search/fetch 请求形态快照 |
| **K2.3** | generic 兜底 | function calling 工具循环（R3 八条裁剪）+ 知识库优先→Tavily 搜索 + /extract 读网 + files 混合兜底 + egress 联动 | 29 §2.3、§4 P-1、§7-1 Q1、§7-3 Q3、§6 governance 行；29a R3/R6 全表 | 【T】`tests/providers/generic.spec.ts`（0/1/N 调用、非法 arguments 容错、`[DONE]`/error 帧/无标记中断三终结、回灌序列）+ `tests/search-routing.spec.ts`【=G2-B5：未配置路径 fetch spy 零调用】+ `tests/files-fallback.spec.ts`【=G2-B8 测试半】+ `tests/egress-wiring.spec.ts`（generic 执行器过 `EgressLite.classify`，白名单外拒绝） |
| **K2.4** | 公共金集断言 | 同一组能力声明 → 同一组规范化块断言（deepseek ∥ generic 同一断言函数） | 29 §2.3 实施纪律（契约试金石）；33 G2-B2 | 【T】`tests/contract-parity.spec.ts`【=G2-B2】：参数化双分支跑同一 golden 断言集 |
| **K3.1** | glm 适配器（web_search/read_url） | `tools[].web_search` 13 子字段 1:1 映射 + **响应顶层 `web_search[]`** 回流 + 流式按「chunk 无该字段」设计 | 29a R1 web_search 三行、reader 行、对 §4 修正行；29 §4 P-2 | 【T】`tests/providers/glm.spec.ts`：非流式顶层数组→source/citation 映射（`refer=ref_1` ↔ 正文角标）；流式 chunk 无字段路径；契约参数 1:1 翻译快照；`tool_choice` 仅 auto |
| **K3.2** | glm files | 上传→parser 抽取→文本入 messages 链路 | 29a R1 files 行 + 修正行（chat completions 不接受 file_id） | 【T】`tests/providers/glm-files.spec.ts`：三步链路 mock 串联；`file_type` 27 枚举选择；任一步失败→显式降级（unavailable，不静默） |
| **K3.3** | mimo 适配器 | OpenAI Chat 主通道 + **`annotations[].url_citation`** 回流 + thinking 硬约束 | 29a R2 web_search 行、function calling 行、thinking 行、修正行；29 §4 P-2 | 【T】`tests/providers/mimo.spec.ts`：annotations→source/citation 映射（url/title/summary/site_name/publish_time/logo_url）；契约 tool_choice required/指定函数→降级 auto；`reasoning_content` 保存与多轮回灌往返断言（缺失回传即 400 场景防回归） |
| **K3.4** | 跨供应商借用 | 两档借用（独立端点直调 / 最小 chat 请求）+ 结果规范化回灌 | 29 §2.4、§4 P-2 借用行；29a 附-A 表、R1/R4 修正行 | 【T】`tests/borrow.spec.ts`：档 A（deepseek `/v1/tools/search`、glm `/paas/v4/web_search`/`/reader`）与档 B（mimo 最小 chat：专用 model id + 单条消息）请求构造快照；出借方响应→规范化块；出借方失败→回退下一段供给链且留痕（实现取值待 O-8 确认） |
| **K3.5** | 契约金集扩展 | contract-parity 纳入 glm/mimo 分支 | 29 §2.3（「若契约只有 DeepSeek 形状，GLM/MiMo 接入时必然返工」纪律的接入期延续）；33 G2-B2 | 【T】`tests/contract-parity.spec.ts` 扩为四分支（deepseek/generic/glm/mimo）同一断言函数全绿 |
| **K4.1** | 部署级能力矩阵 | 每能力四态结论 + 搜索三档位 + files 粒度标注 | 29 §2.4、§3 矩阵行、§7-1、§7-3 | 【T】`tests/matrix.spec.ts`【=G2-B4 测试半】：配置集变体 × 矩阵快照（多供应商借用、无 Tavily=「仅内部」档、deepseek v4-pro 行、unavailable 显式） |
| **K4.2** | doctor 逐能力探活 | llm-doctor 升级：能力路径最小验证请求 + 借用链覆盖 + 兜底配置验证 | 29 §3 doctor 行、§6 llm-doctor 行、§2.4（探活覆盖借用链）；29a R3/R6/R1 修正行、附-B | 【T】`packages/llm-doctor/tests/capability-probe.spec.ts`：各路径最小请求构造与三态判定（fetch 注入 mock；真凭据探活为部署期行为）；`pnpm --filter @eterna/llm-doctor run verify` |
| **K4.3** | 矩阵 UI + 降级态 UI | 模型设置页部署级能力矩阵 + 显式禁用态（前端任务，交互细节对照表见 §5） | 29 §3、§7-4 Q4、§1 ⑤、§7-1；AGENTS.md 前端铁律；30 §4 | 【C】`node scripts/toolkit-matrix-e2e.mjs` 退出码 0（E2E 脚本随本任务新增交付，断言清单见 §4 K4.3——33 G2-B4 原行未给命令，此处补齐可执行形态）【=G2-B4 E2E 半】+【A】降级态 UI 深浅双主题截图各 >20KB 入库 PR（文件存在 + 大小阈值比对）【=G2-B8 产物半】+【C】`node scripts/lint-ui-tokens.mjs`（G0-2） |
| **K4.4** | toolkit 可缺席验证 | TOGGLEABLE 登记 + 停用后 base boot 绿 | 31 §5 D1；33 G2-B9；`docs/PLUGIN-AUTHORING.md:36`（插件必须可缺席） | 【C】`grep "toolkit" packages/access/src/routes.ts`（有输出）；停用后 `node scripts/verify-eterna-web.mjs` 退出码 0（toolkit 行 absent、0 failed）【=G2-B9】 |

**里程碑对齐**（33 §1.4 G3-M2）：M2 收口判据 = G2-B1～B3、B5、B7、B8 全绿 + B9——即本档 K0、M-K1、M-K2、K4.4 全部完成且 K4.1/K4.3 的测试半绿（矩阵 E2E 的里程碑归属见开放问题 O-1）。M-K3（glm/mimo/借用）为 P-2、M2 后续收口。

---

## 4. 逐任务实现规格

### K0 29 号 §5 回填与 §2.4 措辞修正（文档任务，无代码）

1. §5 表 R1–R7 状态列 `☐ 待研读/待复核` → `☑ 已核实（文档级，见 29a 对应节）`，R5 标「已核实（分布式覆盖，29a 附-A）」；每行结论列补 29a 节名与取证 URL 指针（29a 各节结论表已含）。
2. §1 图中「glm（原生，待研读智谱官方文档）/ mimo（原生，待研读官方文档）」两行去掉「待研读」字样（改为「原生，字段级结论见 29a」），否则 grep 门禁无法归零。
3. §2.4「借用消耗出借方一次小额模型调用（其 API 计费）」按 29a 附-A 合并修正改写为能力侧调用两档表述（§2.4 表格引用本档 §2.4 口径表）。
4. 不改 29 号其他结论性内容（§7 拍板原文保留；修正以「29a 修正」注记方式落入，不抹历史）。

**门禁**：`grep -c "待研读" docs/design/29-*.md` = 0；`grep -n "29a" docs/design/29-*.md` 每个研究项行有输出。

### K1.1 包骨架

- `package.json`：name `@eterna/toolkit`、private、type module；scripts 照 §1.6 惯例 + `build:client`（esbuild → `lib/`，llm-doctor 同款配方）；`dsh` 字段（bundle.patch + dsh.client inject `@deepseek-ai/dsh-client-ui-slots`/`-primitives`，照 `packages/llm-doctor/package.json`）。
- `vitest.config.ts`：`{test:{environment:'node', include:['tests/**/*.spec.ts']}}`。
- `src/index.ts` 门面先空壳导出；`cordis.patch.yml` 占位（挂载行 K4.4 落）。
- **门禁**：`pnpm --filter @eterna/toolkit run verify` 退出码 0。

### K1.2 能力契约层（`src/contract/`）

- `CAPABILITY_IDS` 五值 + `CONTRACT_VERSION`（§2.3 草案）。各能力声明参数集（字段级来源）：
  - `web_search`：engine（GLM search_engine 四值档）/count（GLM 1–50 默认 10）/domainFilter/recency（oneDay…noLimit）/contentSize（medium|high）——与 GLM `tools[].web_search` 子字段几乎 1:1（29a R1 对 §4 修正行）；deepseek/generic 分支按各自形态翻译（K1.4 translate）。
  - `read_url`：url/timeout/returnFormat（GLM reader 字段，29a R1 reader 行）；Tavily /extract 承接（29a R6）。
  - `files`：purpose 语义三分对齐 deepseek（user_data/text_recognition/rich_layout_recognition，29a R4）——**契约层只表达意图**（如 `layoutAware: boolean`），purpose 是提供方翻译产物；矩阵标注文本级/版面感知（29 §7-3）。
  - `tts`/`asr`：本批仅枚举占位（P-3 语音链消费，29 §4 P-3），参数 schema 留待语音规格（O-9）。
- `tool_choice` 语义：契约三值 none/auto/required + 嵌套指定形（29a R3 调用控制行）；登记翻译规则位：**MiMo 分支必须降级为 auto**（29a R2 修正——全协议不可用）。
- 禁入清单 + 命名规范落地为运行时校验函数（`naming.ts`/`forbidden.ts`），供适配器复用。
- **门禁**：`tests/contract.spec.ts`（见 §3 表）。

### K1.3 规范化块协议（`src/blocks/`）

- 四类块类型按 §2.3 草案；`SourceBlock.publishTime` **必须可空**（29a R6 修正：Tavily best-estimate 可 null；GLM publish_date / MiMo publish_time 为字符串，格式由各适配器归一化，Tavily 侧需解析 RFC1123 示例格式并容错——R6 unresolved-②）。
- `CitationBlock` 角标：GLM `refer`（ref_1 序号）↔ 正文 `[来源：ref_1]` 文本标注（29a R1 回流行）；deepseek `encrypted_index`/`cited_text` 在适配器内映射，`encrypted_content` 翻译后丢弃或另存（29 §2.1）。
- `guards.ts`：块序列化样例的键名白名单校验（防提供方字段回归泄漏）。
- **门禁**：`tests/normalized-blocks.spec.ts`【=G2-B3】。

### K1.4 工具路由器（`src/router/`）

- `matrix.ts`：输入=部署供应商配置集 + 模型粒度能力表；输出=每能力 `RouteDecision`（`native | borrow:<lender> | fallback | unavailable` + 适配器句柄）+ 搜索档位（`仅内部 | 内部+原生 | 内部+原生+Tavily`，29 §7-1）+ files 粒度标注。
- 模型粒度能力表（数据，非逻辑）：deepseek **拆两行**——flash：web_search 原生+read_url+files 版面感知+vision；v4-pro：仅 Anthropic 形态 `web_search_20250305/20260209` 工具、无 vision/files（29a R4 对 §3 修正行）；GLM：视觉模型与 glm-4-voice 请求不支持 web_search（29a R1）；MiMo：web_search 仅 OpenAI Chat 协议、支持模型 v2.6-flash/pro/pro-ultraspeed（29a R2）。
- `router.ts` 三段式：对话模型原生 → 已配置供应商原生（借用）→ 通用兜底（web=Tavily；语音=自托管栈，本批不可路由见 O-9）；查询键=「已配置供应商集」而非「对话提供方」（29 §2.4）；无路径 → `unavailable`（§1 ⑤，绝不静默）。
- `translate.ts`：能力声明 → 提供方 API 形态的纯函数翻译（GLM 1:1 / deepseek tools 声明 / generic function 定义 / Tavily 字段）；路由器不执行（29 §1 ② 表）。
- 配置集变更 → 矩阵失效并重算（`invalidate()` 钩子，供 K4 消费）。
- **门禁**：`tests/router.spec.ts`（见 §3 表）。

### K2.1 deepseek 适配器——对话侧服务端工具（`src/adapters/deepseek/`）

- 主通道=chat-demo 协议形态（Anthropic Messages，29 §2.2「参考实现在手」）：按能力开关组装 `deepseek_web_search` / `deepseek_read_url` 进 `tools`（§2.2 serverTools 翻译）；官方 schema `type` 必填、`name` 可选且服务端不校验（chat-demo 传 name 为合法超集）；两工具不能与其他服务端工具同传、`tool_choice` 不能指定它们、同一工具声明两次 400（29a R4）——组装函数须静态防呆。
- 流侧解析：`server_tool_use` / `web_search_tool_result` / `web_fetch_tool_result` 块类型与归并逻辑照 chat-demo `reply.ts applyEvent` 范式翻译；SSE 以 `message_stop` 结束、无 `[DONE]`（29a R4 对照行）；`citations_delta` 流式增量纳入解析。
- `types.ts` 对齐 R4 七缺口：① FilePurpose 补 `text_recognition` ② `usage.server_tool_use` 扩展（web_fetch_requests/tool_fetch/tool_image_search、output_tokens_details）③ `WebSearchToolResultError` 6 值枚举（invalid_tool_input/unavailable/max_uses_exceeded/too_many_requests/query_too_long/request_too_large）④ `thinking.type` 第三值 adaptive + `output_config.effort` ⑤ StopReason 补 stop_sequence ⑥ 第三类服务端工具 `web_search_20250305/20260209`（name=web_search、max_uses 默认/上限 5，v4-pro 可用）⑦ Chat Completions/Responses 镜像形态（本批仅 types 登记，通道只做 Messages 形态——依据 §2.2「chat-demo 即参考实现」）。
- `encrypted_content`/`signature` 只存在于适配器内部：signature 多轮原样回传（R4），出块即剥离（§2.1）。
- **门禁**：`tests/providers/deepseek.spec.ts`（SSE fixture 回放 + 错误枚举映射 + 泄漏断言）。

### K2.2 deepseek files 与独立端点（`src/adapters/deepseek/files.ts`、`tools-api.ts`）

- Files：purpose 三值按文件类型选择（PDF/Word/PPT 以 user_data 传=400，R4）；文档 `document` 块 `source:{type:'file',file_id}` 引用（不支持 URL）；每请求 ≤20 文档、文字合计 ≤8MiB；Anthropic 面 `/anthropic/v1/files*` 必须带 beta 头（R4）；上传表单 purpose 字段在 file 之前（R4）。矩阵数据：rich_layout_recognition=版面感知 / text_recognition=文本级（29 §7-3 + R4 修正行）。
- `tools-api.ts`：`POST /v1/tools/search`、`/v1/tools/fetch` 客户端（借用档 A 消费，K3.4）；计费/QPS 常数进注释与矩阵数据（§2.4 口径表）。
- **门禁**：`tests/providers/deepseek-files.spec.ts`（见 §3 表）。

### K2.3 generic 兜底（`src/adapters/generic/`、`tavily/`）

- `loop.ts` 工具循环按 R3 八条裁剪逐字实现：**发送 4**——`tools[]` 四件套 `{type:'function',function:{name,description,parameters}}`；name `^[a-zA-Z0-9_-]+$` ≤64；parameters 用朴素 JSON Schema 子集；不发 `strict`/`custom`/`allowed_tools`/`namespace`/`defer_loading`/废弃 `functions`；**接收 2**——`tool_calls[]` 的 `arguments` 是 JSON 字符串且可能非法（容错解析，解析失败回灌错误字符串）；`finish_reason==='tool_calls'` 判工具轮；**回灌 2**——先 push 原样 `tool_calls` 的 assistant 消息，再每 tool_call 一条 `{role:'tool',tool_call_id,content:string}`，失败/降级也显式回灌非空字符串；`parallel_tool_calls` 显式声明。**流式**——按 `delta.tool_calls[i].index` 归并（index 唯一必填），id/name 首帧携带；三种终结都处理（`[DONE]` 字面帧 / 含 error 字段的 JSON 帧 / 无任何标记的中断）。
- 搜索执行器（§7-1 Q1 供给链）：① `knowledge_search` 内部优先（§1.3 现成工具）；② Web 层按路由器结论（原生/借用由 K3.4 承接）；③ Tavily `/search` 兜底——`Authorization: Bearer tvly-<key>`、默认 `include_published_date: true`（R6：默认 false 须显式开）、`published_time` 归一化容错解析、`score` 仅内部排序参考不进块（R6）。
- read_url 兜底：Tavily `/extract`（5 URL/credit，R6）并入 tavily 客户端。
- files 混合兜底（Q3 拍板）：图片对视觉模型 base64 内联；文档服务端文本抽取 + 体积上限；不可解析→**显式降级**（unavailable 块/错误文案，不静默消失）；矩阵标注 generic=文本级。
- egress 联动（29 §6 governance 行）：generic 的 tavily 执行器以 defineTool 形态经 `ctx.tools.register` 注册（26 §4.3 配方：governance pre-execute 瀑布自动覆盖 + egress 白名单约束）——执行器不自带网络旁路。
- **门禁**：四个 spec 文件（见 §3 表；`search-routing.spec.ts` 断言「未配置 Tavily 且无原生可用 → 不发任何网络请求」）。

### K2.4 公共金集断言（`tests/contract-parity.spec.ts`）

- 结构：`golden/cases/*.json`（能力声明 + 期望规范化块）× 参数化分支（本批 deepseek/generic，K3.5 扩四分支）；每分支喂各自的提供方响应 fixture（deepseek SSE 事件流 / generic tool_calls + tool_result 序列），断言产出与 golden **逐字段相等**。
- 用例集：五能力各 ≥1 条 + 降级路径（错误响应→unavailable 块）≥1 条；用例新增不设上限，修改 golden 必须在 PR 说明（对齐 33 §2.1 测试纪律）。
- **门禁**：进 `pnpm --filter @eterna/toolkit run verify`【=G2-B2】。

### K3.1 glm 适配器（`src/adapters/glm/chat.ts`、`reader.ts`）

- 声明：`tools` 数组 `{type:'web_search', web_search:{…}}`（外层 required type+web_search）；契约参数与子字段 1:1 映射（search_engine 必填四值/count 1–50 默认 10/search_domain_filter/search_recency_filter/content_size/result_sequence 等，29a R1）；`tool_choice` 仅 `"auto"`。
- **回流（本任务核心，29a R1 字段级结论）**：非流式响应**顶层** `web_search[]`（**不在** `choices[].message`——message 仅 role/content/reasoning_content/audio/tool_calls）；每条 `icon/title/link/media/publish_date/content/refer` → `SourceBlock`（§2.3 映射）；`refer`（如 `ref_1`）与正文 `[来源：ref_1]` 标注 → `CitationBlock` 角标。
- 流式：OpenAPI 规范 ChatCompletionChunk **无** web_search 字段——按「chunk 无该字段」设计（29a R1 修正行）；真实回流位置属 unresolved-①，处置=K4.2 doctor 探活首轮真调验证并回填结论。
- read_url：`POST /paas/v4/reader`（url/timeout 默认 20/return_format 默认 markdown 等，29a R1）→ 附件/来源块。
- 计费常数（§2.4 口径表）进矩阵数据。
- **门禁**：`tests/providers/glm.spec.ts`（见 §3 表）。

### K3.2 glm files（`src/adapters/glm/files.ts`）

- 链路：`POST /paas/v4/files` 上传（purpose 枚举 **无** extraction）→ `POST /paas/v4/files/parser/sync`（multipart file + tool_type=prime-sync + file_type 27 枚举必填）→ 抽取文本**入 messages**（chat completions 不接受 file_id 引用，29a R1 files 行）；异步 parser/create + result 端点本批不用（29a R1 unresolved-⑤ 未逐字段展开）。
- 矩阵标注：glm files=文本级（抽取链路，非版面感知）。
- **门禁**：`tests/providers/glm-files.spec.ts`（三步 mock 串联 + 失败显式降级）。

### K3.3 mimo 适配器（`src/adapters/mimo/chat.ts`）

- 主通道=OpenAI Chat Completions（web_search 仅此协议，29a R2）；声明 `tools` 数组 `{type:'web_search', max_keyword, force_search, limit, user_location:{country/region/city}}`（子字段逐字段官方定义未展开——29a R2 unresolved-③，limit 默认值以实测/探活回填）。
- **回流（本任务核心）**：结果**不是 tool_calls**，而是 `choices[].message.annotations[]`，每条 `type:'url_citation'` 含 `url/title/summary/site_name/publish_time/logo_url` → 直接映射 `SourceBlock`/`CitationBlock`（29a R2 修正行）；`message.error_message` 承载链路错误；`usage.web_search_usage={tool_usage,page_usage}` 记账；流式首包返回全部搜索来源；开关 5 分钟缓存（探活结论须考虑缓存，K4.2）。
- thinking 硬约束：V2.6 默认 `thinking.type:'enabled'`；**多轮含工具调用时回传的 assistant 消息若含 tool_calls 必须完整回传 `reasoning_content`，否则 400**——适配器保存每轮回传并原样回灌（29a R2 thinking 行 + 修正行「契约层若丢弃推理内容，MiMo 分支必须另存」）；思考模式下 temperature/top_p 服务端强制 1.0/0.95（透传侧记录）。
- tool_choice 降级：契约 required/嵌套指定 → MiMo 分支一律 auto（29a R2 修正行）；`tool_calls[].function.arguments` 可能非法 JSON（校验后执行，R2）。
- 前置条件：控制台开通「联网服务插件」——未开通的探活失败形态进 K4.2 判定表（29a R2）。
- **门禁**：`tests/providers/mimo.spec.ts`（见 §3 表）。

### K3.4 跨供应商借用（`src/borrow/borrow.ts`）

- 两档（29a 附-A 合并修正）：
  - **档 A 独立端点直调**（无模型调用、按次计费）：deepseek `/v1/tools/search`、`/v1/tools/fetch`（K2.2 客户端）；glm `/paas/v4/web_search`（search_query ≤70 字符、search_engine/search_intent 必填）、`/paas/v4/reader`——「GLM 出借能力零 token、零 chat 请求」（29a R1/R4 修正行）。
  - **档 B 最小 chat 请求**（计 token）：MiMo——专用 model id + 单条消息的最小 chat 请求（29a R2 回填行「借用 = 一次独立的最小 chat 请求」）；deepseek 带工具声明的 messages 调用（借「模型侧深度搜索/引用作答」时，29a R4 修正行）。
- 结果解析→规范化块→回灌主会话（29 §2.4）；路由键=已配置供应商集（§2.4）；借用动作记审计——29 §2.4 与 29a 附-A 对借用仅拍板调用形态/计费/回灌、未规定审计，此为对齐全仓 audit NDJSON 惯例（`packages/audit`；33 号 G3-M5 按 `.eterna/audit-*.jsonl` 聚合的先例）的实现增项：仅记事实行、不改审计 schema，登记 O-15 裁决。
- 出借方失败回退语义按「回退供给链下一段 + 留痕」实现（自然读出 §7-1 三段式），**待 O-8 确认**。
- **门禁**：`tests/borrow.spec.ts`（见 §3 表）。

### K4.1 部署级能力矩阵（`src/router/matrix.ts` 扩展）

- 输出结构：`{ capability → { route: RouteDecision, searchTier?, filesGranularity? } }`；矩阵随配置集变化（K1.4 invalidate 钩子触发重算）；搜索三档位如实展示（29 §7-1：仅内部/内部+原生/内部+原生+Tavily；未配置 Tavily 且无原生可用=显式降级，绝不静默外发）。
- **门禁**：`tests/matrix.spec.ts`【=G2-B4 测试半】。

### K4.2 llm-doctor 逐能力探活（`packages/llm-doctor` 升级）

- 保留现有 `checkRoute`/`pingModel`（模型连通性）；新增 `probeCapability(path)`，按矩阵逐路径最小验证（29 §3 doctor 行）：
  - generic/兼容供应商路径：1 个 function 工具 + `tool_choice:"required"` + 单轮，断言收到合法 tool_calls（R3 修正行——一次覆盖声明/解析/回灌三段冒烟）；MiMo 路径降级 auto 后以「收到含 web_search 声明的合法响应」为断言（R2）；
  - deepseek 原生：`/v1/tools/search` 最小请求（R4）；glm 原生：`/paas/v4/web_search` 最小请求（字段约束见 K3.4 档 A）；
  - Tavily 兜底：`GET /usage` 验 key 或一次 `max_results=1` basic 搜索（1 credit；带 `include_usage`，R6）；
  - **借用链覆盖**：矩阵中每条 borrow 路径逐条探活（29 §2.4「doctor 探活须覆盖整条借用链」）；
  - GLM 流式 web_search 回流位置（R1 unresolved-①）：探活含一次流式真调，回流形态结论回填 29a/适配器注释。
- 探活结果结构化输出，供 toolkit 矩阵 UI 消费（29 §6「toolkit 消费 doctor 的探活结果」）。
- 探活触发时机（手动/定时）未拍板（O-11）；探活真实消耗计费（§2.4 口径表）。
- **门禁**：`packages/llm-doctor/tests/capability-probe.spec.ts` + `pnpm --filter @eterna/llm-doctor run verify`。

### K4.3 矩阵 UI 与降级态 UI（`src/client/`，前端任务）

- 矩阵 UI：模型设置页新增部署级能力矩阵——每能力标注实际路由（原生/借用自哪个供应商/兜底/不可用）+ 搜索档位徽标 + files 文本级/版面感知标注 + 探活结果展示（消费 K4.2 结构化输出；29 §6 包清单行「toolkit 消费 doctor 的探活结果」）+ 静态配置导入种子（Q4 拍板「UI 为主、静态配置作导入种子」）。手动「重新探活」入口 29/29a/33 均无此表述（29 §3 doctor 行拍板原文止于「升级为逐能力可用性探活，覆盖整条借用链」）——**不实现**，是否增设登记 O-14。
- 降级态 UI：矩阵中没有的能力=显式禁用态（§1 ⑤）；「仅内部」档位如实展示、绝不静默外发（§7-1）。
- 落点：模型设置页（Q4 拍板）；具体 slot 形态=开放问题 O-3（llm-doctor 已占 `settings.models.provider-card` keyed slot，矩阵为部署级跨供应商）。
- 交互细节逐条对照见 §5；原型先行适用性=开放问题 O-4。
- **门禁**：【C】`node scripts/toolkit-matrix-e2e.mjs` 退出码 0——脚本随本任务新增（仓内 E2E 先例均为定制 .mjs：`scripts/t7-e2e.mjs`、`scripts/verify-governance-e2e.mjs`、`scripts/team-platform-gates/p1-e2e-sandbox.mjs`；无设置页 E2E 先例，按同惯例自建），逐断言输出 [PASS]/[FAIL]、可重复执行；断言至少：①隔离环境（独立 DSH_HOME）起宿主后，模型设置页出现部署级矩阵分区；②五能力行各含路由标注（原生 / 借用:出借方 / 兜底 / 不可用）且与 K4.1 矩阵计算输出一致；③矩阵分区内搜索档位徽标文案 ∈ {仅内部, 内部+原生, 内部+原生+Tavily}（限分区范围断言，不做全页文本子串）；④不可用能力行呈显式禁用态（存在禁用态节点，非静默消失）；⑤矩阵行展示 K4.2 探活结果（手动「重新探活」入口不在断言内，O-14）。另【A】降级态深浅双主题截图各 >20KB 入库 PR +【C】`node scripts/lint-ui-tokens.mjs`。

### K4.4 toolkit 可缺席验证（挂载收口）

- `packages/access/src/routes.ts` TOGGLEABLE_PLUGINS 登记 `toolkit`；`cordis.patch.yml` 挂载行落地（D1：base 可选挂载、admin 可开）；admin 停用→重启→patch 行被裁剪。
- **门禁**：`grep "toolkit" packages/access/src/routes.ts` 有输出；停用后 `node scripts/verify-eterna-web.mjs` 退出码 0（toolkit 行 absent、0 failed）【=G2-B9】。

---

## 5. 交互细节对照表（前端任务 K4.3：模型设置页矩阵 UI + 降级态 UI + 探活展示）

> 铁律要求：把 24/26/27/28/29/30 号对该处的每一条**已拍板**交互细节逐条列出并标注实现位置。无相关条款的文档如实记「无」。

| 来源 | 条款 | 已拍板交互细节（原文要点） | 实现位置 | 状态 |
|---|---|---|---|---|
| 29 | §1 ⑤（降级语义行） | 「矩阵中没有的能力 = 显式禁用态 UI，不是静默消失」 | `src/client/` 矩阵行「不可用」态 + 能力入口禁用态组件 | 待开发（K4.3） |
| 29 | §1 ⑤ | 「接口 unavailable」——降级同时存在于接口面（不只是 UI） | 路由器 `unavailable` 结论（K1.4/K4.1） | 待开发 |
| 29 | §3 矩阵行 | 「模型设置页新增**部署级能力矩阵**：每能力标注实际路由——原生 / 借用自哪个供应商 / 兜底 / 不可用（随已配置供应商集变化）」 | 矩阵 UI 主体表（K4.1 数据 → K4.3 渲染） | 待开发 |
| 29 | §3 doctor 行 | 「升级为逐能力可用性探活，覆盖整条借用链：对每个已配置供应商的能力路径发最小验证请求；兜底路径验证其配置」（原文无「重新探活」表述） | K4.2 逐能力探活 + 矩阵行展示探活结果（29 §6「toolkit 消费 doctor 的探活结果」）；手动「重新探活」入口无条款出处——不实现，见 O-14 | 待开发（探活展示）；入口=开放问题（O-14） |
| 29 | §3 用户价值行 | 「换模型前知道哪些能力会降级、当前实际走哪条路——体感一致的知情层」 | 矩阵行文案目标（每能力一行：当前路径 + 降级提示） | 待开发 |
| 29 | §7-1 要点 3 | 「矩阵如实展示该部署的搜索档位（仅内部 / 内部+原生 / 内部+原生+Tavily）」「未配置 Tavily 且无原生可用时 = 显式降级，绝不静默外发」 | 搜索能力行档位徽标（状态色须配文字，frontend-style §3 徽标规则） | 待开发 |
| 29 | §7-3 Q3 | 「矩阵如实标注 generic 为『文本级』、原生为『版面感知』」 | files 能力行粒度标注 | 待开发 |
| 29 | §7-4 Q4 | 「矩阵配置面 = 模型设置页 UI 为主（doctor 逐能力探活建议，覆盖借用链），静态配置作导入种子」 | UI 为主 + 种子导入入口 | 待开发 |
| 29 | §2.4 | 「矩阵因此是**部署级**的（随配置集变化）」 | 矩阵数据源=部署级计算；配置变化后重算（刷新时机见 O-6a） | 待开发 |
| 29 | §6 模型设置页行 | 「模型设置页 = 矩阵的配置面（§7-4）」 | 落点=模型设置页（slot 形态 O-3） | 待开发 |
| 24/24a | 24a 不做什么清单 / 24 §8.2 | 「不新增独立页面（严守 AGENTS.md，走 slots）」 | 矩阵/降级态走官方 slot，不建独立页 | 待开发 |
| 24 | §7.2 平台管理员行 | 平台管理员在「设置弹窗分区 + 面板」配模型网关、看用量与健康 | 矩阵进设置面（面向管理员；普通用户可见性 O-5） | 待开发 |
| 26 | §2.1-3（UI 铁律继承） | 「任务侧栏 / Attention 卡全走 slots 扩展点，不建独立页面，深浅主题截图自查」（AGENTS.md 铁律继承） | 同上：slot 挂载 + 双主题截图进 PR | 待开发 |
| 26 | §2 包清单「llm-doctor 不变」行 | 该行已被 29 §6/§3 取代（doctor 粒度升级为逐能力）——按最新拍板执行，注记不删 | K4.2 升级 llm-doctor | 已按 29 号执行 |
| 27 | — | 无针对矩阵/降级 UI 的已拍板条款（D2 冲突三指标属 30 号工作台视图） | —（不适用） | 无 |
| 28 | — | 无针对该处的已拍板条款（路由金集/活跃工单清单属任务侧；29 §8 所引「chat-demo 前端范式」指规范化块渲染投影，消费方为会话/工作台面，非矩阵 UI） | —（不适用） | 无 |
| 30 | §4-1 | 「不建独立页面：panel 扩展 + workspace slots」 | 矩阵挂模型设置页 slot（复用 llm-doctor keyed slot 先例或新分区，O-3） | 待开发 |
| 30 | §4-2 | 「设计令牌一律 `--et-*`（经 `--dsw-alias-*` 桥接），禁字面色值；图标走 `@eterna/ui/icons`」 | 全部矩阵/降级态样式（G0-2 lint 门禁） | 待开发 |
| 30 | §4-3 | 「中文 UI + a11y（语义标题、focus 光圈、`prefers-reduced-motion`）+ 响应式 1100/760/640」 | 矩阵表格横向滚动（frontend-style §1-6：表格必须可横向滚动）、断点三档 | 待开发 |
| 30 | §4-4 | 「深浅双主题截图进 PR」 | K4.3 门禁产物（>20KB 两张） | 待开发 |
| 30 | §4-5 | 「工作台数据按 access realm 钳制」——矩阵为部署级数据（29 §2.4），非 per-realm 工单数据；设置页访问权限沿现状，普通用户可见性未拍板 | 权限处理待 O-5 裁定 | 开放问题 |
| 30 | §5（原型先行铁律；源出 24a 新增范围 2） | 「设计 skill 出原型 → 评审（双主题 × 三断点 × a11y）→ 严格按原型开发 → PR 对照」——首批原型清单四件**不含矩阵 UI**，适用性待裁定 | 若适用：原型入 `docs/design/prototypes/`（目录随首交付创建） | 开放问题（O-4） |
| 30 | §7-4（Q4 拍板） | 「日志默认摘要行 + 展开全文 + PII 正则」——属工作台日志视图，非本处 | —（不适用） | 无 |

补充（仓级规范，非 24–30 号）：UI 面向用户文字一律中文（`AGENTS.md:28`）；资料类字段合并保存、破坏性操作两击确认（`AGENTS.md:11` 交互纪律）；错误/成功就地显示并带 `role="alert"`/`aria-live`（`docs/design/frontend-style.md:34`，非 AGENTS.md 条款）——均入 K4.3 实现与 PR 自查。

---

## 6. 门禁与测试命令总表

| 层 | 命令 / 测试文件 | 对应 33 号 | 时机 |
|---|---|---|---|
| 文档回填 | `grep -c "待研读" docs/design/29-*.md` = 0 | G2-B7 | K0 收口（glm/mimo 开工前置） |
| 包级 | `pnpm --filter @eterna/toolkit run verify`（含下述全部 spec） | G2-B1 | 每任务收口 |
| 契约试金石 | `packages/toolkit/tests/contract-parity.spec.ts` | G2-B2 | M-K2 起持续 |
| 块禁泄漏 | `packages/toolkit/tests/normalized-blocks.spec.ts` | G2-B3 | K1.3 |
| 搜索降级 | `packages/toolkit/tests/search-routing.spec.ts`（未配置路径零网络请求） | G2-B5 | K2.3 |
| files 降级 | `packages/toolkit/tests/files-fallback.spec.ts` | G2-B8（测试半） | K2.3 |
| 降级态 UI | 深浅双主题截图 >20KB 入库 PR | G2-B8（产物半） | K4.3 |
| 矩阵 + E2E | `packages/toolkit/tests/matrix.spec.ts` + `node scripts/toolkit-matrix-e2e.mjs`（K4.3 新增交付，退出码 0） | G2-B4 | K4.1/K4.3 |
| doctor 升级 | `packages/llm-doctor/tests/capability-probe.spec.ts` + `pnpm --filter @eterna/llm-doctor run verify` | G2-B4 | K4.2 |
| 可缺席 | `grep "toolkit" packages/access/src/routes.ts`；停用后 `node scripts/verify-eterna-web.mjs` | G2-B9 | K4.4 |
| UI 令牌 | `node scripts/lint-ui-tokens.mjs` | G0-2 | 每 UI PR |
| 多租户/提示词 | `node tools/packctl/bin/packctl.mjs tenant-scan` / `prompt-scan` | G0-4/G0-5 | 里程碑收口 |
| 全仓 | `pnpm -w run verify` | G0-1 | 里程碑收口 |
| 语音链（P-3，登记不展开） | `packages/toolkit/tests/voice-chain.spec.ts` + compose 语音服务探活 | G2-B6 | P-3 |

---

## 7. 执行顺序与并行边界（workflow 编排）

```
K0（文档回填，先行且独立）
   └→ M-K1：K1.1 → {K1.2 ∥ K1.3} → K1.4          （契约是后面一切的前置，29 §4）
        └→ M-K2：K2.1 ∥ K2.3 两条并行线（§2.3 实施纪律：generic 与 deepseek 并行开发，
                    generic 是契约的试金石）→ K2.2 随 K2.1 → K2.4 首批能力可用后立即接入并持续跑
             └→ 【M2 里程碑窗口：K0+M-K1+M-K2+K4.4 达 G3-M2 判据；K4.1/K4.3 测试半随窗推进（O-1）】
                  └→ M-K3：K3.1 ∥ K3.3 → K3.2 → K3.4 → K3.5（前置：K0 已回填，33 §4 依赖表）
                       └→ M-K4：K4.1 → K4.2 → K4.3 → K4.4
```

- 每任务：实现（测试先行）→ 包级 verify 绿 → 修复循环 ≤3 轮；偏离规格处照 22 号先例写偏离说明。
- 与 WS-A（tasks）无依赖冲突（29 §4），不动 `packages/tasks*`；与 WS-D（workbench）的界面边界=矩阵在模型设置页、工作台视图不动。
- 全仓门禁（`pnpm -w run verify`、tenant-scan、prompt-scan）在里程碑收口跑；若并行工作流致外部红灯（finding 指向他人路径），记录并跳过（22 号 §8 Phase 4 先例）。
- 里程碑收口：独立评审（评审 agent 读全 diff 出问题清单，P0/P1 修复后才进下一里程碑）+ G3-M2 判据逐条核验。

---

## 8. P-3 语音供给链登记（不展开，防丢）

29 §4 P-3 / §7-2 Q2 拍板：完整开发（不分版本），供给链与搜索同构（原生 → 借用 → 自托管 FunASR+CosyVoice 可插拔可换）。开工时依据 29a R7 五条落地推论：① compose 服务形态（FunASR 用官方 `examples/openai_api/docker-compose.yml`；CosyVoice 自建 GPU 镜像，均非「拉镜像即用」）；② 探活两种语义（FunASR 有 `/health`、CosyVoice fastapi/grpc **无** health 端点）；③ PCM 契约（FunASR 入 8k/16k、CosyVoice 出裸 int16——需固定重采样责任方）；④ 容量按 `rtf_reproducibility.md` 字段自测（官方数字禁止当通用承诺）；⑤ 两栈无鉴权——compose 内网 + 网关收口为硬前提。端点事实：deepseek `/v1/tools/asr`（整段 ≤120s）与 `/v1/tools/tts`（含 WSS 流式，PCM 24kHz/16bit/单声道）、glm `glm-asr-2512`（≤30s）/`glm-tts`（PCM 24kHz SSE 同构）、mimo `mimo-v2.5-asr`/`-tts*`（chat-completions 形态，TTS 目标文本放 assistant 消息）。门禁=G2-B6。

---

## 9. 开放问题（设计缺口，如实记录——不自行补设计）

| # | 缺口 | 现状与影响 | 需要的裁决 |
|---|---|---|---|
| O-1 | G2-B4 里程碑归属口径不一 | 33 号 G2-B4 行写「M2（矩阵）/P-3（语音链）」，但 G3-M2 判据①未列 B4（只列 B1–B3/B5/B7/B8）；矩阵是否 M2 收口未定 | 裁定矩阵（含 E2E）是否入 M2 判据；本档按「矩阵随 M2 窗口推进、不阻塞 M2 收口」组织 |
| O-2 | 规范化块字段集未定义 | 29 §1 ④ 只定块**类型**（搜索步骤时间线/引用角标/来源卡/附件引用），字段集来自 29a 各家映射的隐含并集；本档 §2.3 草案为实现提案 | 评审确认 §2.3 字段集后固化为 golden；未确认前 golden 标 `draft` |
| O-3 | 矩阵 UI slot 形态未拍板 | Q4 只说「模型设置页 UI 为主」；llm-doctor 已占 `settings.models.provider-card` keyed slot（per-provider 卡片），矩阵是部署级跨供应商视图 | 是否新增设置分区 / 复用 provider 卡分段 / 官方是否有更合适 keyed slot |
| O-4 | 原型先行铁律是否适用于矩阵 UI | 24a 新增范围-2 与 30 §5 铁律文义覆盖新 UI，但 30 §5 首批原型清单四件不含矩阵 | 是否将矩阵 UI 补入原型清单（先原型后开发） |
| O-5 | 矩阵可见性/权限 | 24 §7.2 将模型网关配置归平台管理员；29 §3「换模型前知道哪些能力会降级」未言明面向所有用户还是管理员 | 矩阵（及降级知情层）对普通用户是否可见 |
| O-6a | 矩阵刷新时机 | 29 只说「随已配置供应商集变化」；探活结果新鲜度未规定 | 配置变更即重算之外，是否定时/手动探活刷新 |
| O-6b | 矩阵是否展示计费信息 | 29 §2.4 要求借用代价诚实（其 API 计费），但未规定矩阵 UI 是否展示单价/用量（§2.4 口径表数据已备） | 展示粒度（不展示/单价/含 Tavily /usage 用量） |
| O-7 | 契约版本化语义 | 29 §1 ①/§4 要求「版本化」，版本何时 bump、跨版本兼容承诺未定义 | 定版本规则（本档只落 `CONTRACT_VERSION` 常量+断言） |
| O-8 | 借用失败的回退语义 | §2.4/§7-1 定三段式与「显式降级绝不静默」，出借方调用失败时回退下一段还是报错未明说 | 确认「回退下一段+留痕」（本档 K3.4 实现取值）或改为报错 |
| O-9 | tts/asr 两能力的本批行为 | 五能力枚举含 tts/asr（29 §1 ①），但实现归 P-3；本批矩阵对语音行只能标「不可用/未开通」，路由器对语音声明的裁决需定义 | P-3 开工前，语音声明在本批是否一律 `unavailable`（自然读出 §1 ⑤，需确认） |
| O-10 | GLM 语音计价缺数 | 29a R1 unresolved-④：语音与 ASR 单价未核实（指向 pricing 页未抓取） | 若 O-6b 裁定展示计费，需补抓核实 |
| O-11 | doctor 探活触发时机与成本边界 | 逐能力探活真调消耗各供应商配额/费用（GLM 每次探活 0.01 元起、Tavily 1 credit、deepseek 按次）；29 §3 未规定手动 vs 定时 | 探活触发策略（默认手动？定时周期？）与成本上限 |
| O-12 | MiMo web_search 子字段逐字段定义缺失 | 29a R2 unresolved-③：max_keyword/force_search/limit/user_location 仅见指南示例，limit 语义与默认值无官方逐字段说明 | 实现期以探活/真调回填，字段表标注「待实测」 |
| O-13 | 29 号 §1 图「待研读」字样的回填方式 | K0 需改 §1 图两行文字才能过 G2-B7 grep；改动设计定稿图是否越界（本文按注记式修正处理） | 确认注记式修正可接受 |
| O-14 | 手动「重新探活」入口无条款出处 | 29 §3 doctor 行拍板原文止于「升级为逐能力可用性探活，覆盖整条借用链：对每个已配置供应商的能力路径发最小验证请求；兜底路径验证其配置」，无「重新探活」表述（grep 全 docs/design/*.md 该词原仅见于本档 K4.3/§5 两处误引，2026-11-17 评审后已删）；29a、33 G2-B4 亦无。矩阵**展示**探活结果有出处（29 §6「toolkit 消费 doctor 的探活结果」），手动**触发**入口属新 UI 行为 | 是否在矩阵 UI 增设手动「重新探活」入口（与 O-6a 刷新时机、O-11 触发策略一并裁决）；未裁决前 K4.3 不实现该入口 |
| O-15 | 借用动作是否记审计未规定 | 29 §2.4 与 29a 附-A 对借用机制仅拍板调用形态（两档）、计费与回灌，均未规定审计记录；仓内有 audit NDJSON 惯例（`packages/audit` 存在；33 号 G3-M5 按 `.eterna/audit-*.jsonl` 聚合、30 号 §7-4 引用） | 裁决借用动作是否记审计事实行（本档 K3.4 拟记：仅记录事实、不改审计 schema）或不予记录 |

---

## 10. 与既有文档的关系

```
24a（B4 拍板原文）──29 号是其展开──本档是 29/29a 的实施规格
29 §1 五层 / §2.3 并行纪律 / §2.4 借用 / §4 排期 / §7 拍板 ──本档任务链与依赖的依据
29a R1–R7 字段级结论 ──本档各适配器的字段规格与禁入/翻译清单
33 WS-B / G2-B1–B9 / G3-M2 ──本档门禁编号与里程碑对齐
31 §5 D1（base 可选挂载）──K4.4 挂载形态
26 §4.3 新工具配方──generic 执行器注册形态（governance 瀑布自动覆盖）
24 §3 chat-demo 范式──K2.1 翻译底本（SSE 三陷阱/块归并/投影）
30 §4/§5──K4.3 UI 铁律与原型先行
```

本档不改变 29 号路线与 33 号门禁结构；P-3 语音链与 WS-A/WS-D 边界如 §0/§8 所列。
