# Eterna 企业 Web 档（eterna-web profile）

状态：已落地并真 boot 验证通过（`node scripts/verify-eterna-web.mjs`，exit 0）。
日期：2026-11-07；2026-11-09 补「@eterna 治理面挂载集」一节（T8 落地 / T9 E2E）。
权威依据：`plans/2026-11-06-dsh企业agent路线定案.md` §11，以
§11.7（图纸复核）与 §11.8（二次裁定）为准。行 id 权威来源：deepseek-harness
`packages/bundle/base/cordis.patch.yml` 与 `packages/bundle/web-app/cordis.patch.yml`
（先读后写；本 profile 实际 boot 的是同版本号装品内的这两个文件，差异见
[版本对齐注意](#版本对齐注意)）。

## 组合形态

```
@deepseek-ai/dsh-base        0.2.2-rc.1   bundle 层（基础树 insert）
@deepseek-ai/dsh-web-app     0.2.2-rc.1   bundle 层 + 其 presets/*.patch.yml（4 个预设）
profiles/eterna-web/cordis.patch.yml       profile 用户层（最后写赢，本文档所述裁切层）
```

- 组合定义：`profiles/eterna-web/cordis.patch.yml`（覆写层，无 `- insert:` 行）+
  `profiles/eterna-web/README.md`。
- 物化与 boot：`scripts/verify-eterna-web.mjs` 把组合层拷贝为
  `$DSH_HOME/profiles/eterna-web/cordis.patch.yml`（默认 home
  `.eterna-home/`，可用 `ETERNA_PROFILE_HOME` 改指），用仓库本地
  `node_modules/@deepseek-ai/dsh` 的 CLI 以
  `dsh --profile eterna-web --no-open --port 0` 真启动。bundle 包从 dsh 安装锚
  解析（`resolveBundleDir`：安装锚优先、profile 目录兜底，
  dsh-app-boot `lib/index.js`），因此该 profile **无需 pnpm install**。
- 端口：`--port 0` 由 OS 分配，避开被常驻实例占用的 3080/3081；`--no-open`
  不拉浏览器。
- 不调模型、不需要任何凭据：boot 只装配 Cordis 树，不发 LLM 请求。

## @eterna 治理面挂载集（T8/T9：audit + egress，2026-11-09 补）

§11.6/§11.7 裁定的 @eterna 侧挂载（plans/2026-11-06-dsh企业agent路线定案.md），治理面三插件的
装载形态与验证结论（T8 落地、T9 真 boot E2E 兑现）：

- **装载行**：`packages/glue/cordis.patch.yml:12-22` 五行 `- insert:`（eterna-governance /
  eterna-memory / eterna-knowledge / eterna-audit / eterna-egress，name 全部指向
  `@eterna/glue/*-plugin`）。insert 语义是硬性要求——裸 id 行只覆写既有行，基础树无同名行
  时整行被丢弃（2026-11-04 E2E 教训，见 `packages/glue/cordis.patch.yml:1-6` 头注）。
- **本档源 patch 不携带治理面行**：`profiles/eterna-web/cordis.patch.yml` 至今只做宿主行
  裁切与回加，无任何 `eterna-*` insert 行；治理面挂载行由装载方按需追加。T9 验证即是在
  **物化副本**（`$DSH_HOME/profiles/eterna-web/cordis.patch.yml`）追加三行
  （eterna-governance / eterna-audit / eterna-egress，`scripts/verify-governance-e2e.mjs:66-70`
  MOUNT_ROWS）→ boot → 还原原始字节（逐字一致断言，`:186`）；工作区源目录全程不被触碰
  （`:31-36` patch 文件纪律）。
- **行序即瀑布序**：eterna-governance 最外层（其 ask 透传后回填，让下游 egress 的域名级
  deny 先于人审生效）、eterna-egress 最下游；eterna-audit 纯观察不参与瀑布
  （`packages/glue/cordis.patch.yml:8-11` 行序注、`packages/glue/src/plugins/governance-plugin.ts:100-113`）。
- **运行时行为**：audit 落盘 agent cwd 下 `.eterna/audit-YYYYMMDD.jsonl`（按日轮转，
  `packages/audit/src/daily-sink.ts:25-33`）；egress 域名白名单缺省读
  `.eterna/egress-whitelist.yml`，文件缺席 = 内网默认白名单（`192.168.31.*` / `localhost`
  / `manas`，`packages/extra/src/egress-defaults.ts:19-23`），公网域扩展走资产模板
  `packages/extra/assets/egress-whitelist.template.yml`（启用前过企业合规评审）。
  部署方裁定不做域名级管控时写显式全放规则 `'**'`（任意 host，协议/端口 fail-closed
  面仍生效；2026-11-13 产品裁定，个人部署不逐域加白——缺省规则集永不含它）。
- **装卸无残留验证结论（T9 真 boot E2E，`node scripts/verify-governance-e2e.mjs`，
  T4 验收「effect 逆闭包卸载无残留」的宿主级兑现）**：
  - web 档挂载 boot：三行 present+enabled+**active** 且 0 个 failed 条目
    （`scripts/verify-governance-e2e.mjs:445-456`，pluginInventory/list 断言）；
  - 还原 patch 后卸载 boot：**无任何 `eterna-*` 条目**、0 failed
    （`:478-483`——挂载面零残留，宿主树回到本档裁切态）；
  - embed 档行为对比：挂载跑 deny/allow/审计三路断言（拒绝文本 + 见证服务器
    `/deny-me` 命中 0 + 审计三类记录），卸载跑同任务则 egress 标记消失、`/deny-me`
    被真抓取、无审计文件（`:410-418`）——治理行为随装卸完全消失，无半开状态。
- **红线相容**：audit 本地落盘（NDJSON，不出网）、egress 只做出网判定与白名单收口，
  两者都不新增出站面；§11.8「web 检索 = 唯一显式出站」的残余出站面口径不变，且该出站
  现在经 egress 双口径（工具级 + 域名级）管控。

## 企业挂载集之 LLM 承载行（官方 pi-ai 适配器，2026-11-09 补）

模型配置的正式承载：**官方 `@deepseek-ai/dsh-llm-pi-ai` 适配器**（0.2.2-rc.1 装品自带，
base 树根级行 `llm-pi-ai` 休眠零路由，dsh-base `cordis.patch.yml:128-136`）。客户端
`ui-settings-models` 对 ns `llm-pi-ai` 渲染**完整编辑器**（`ProviderEditor.tsx:154-158`
layoutOf 精确匹配；第三方 ns 一律 unknown 只渲染「其余字段在 cordis.patch.yml 中」提示，
dsh 包只读不可改——这是本档弃 `@eterna/llm-openai` Web 承载的根因）：Base URL、API 协议
下拉（OpenAI Chat Completions / Responses / Anthropic Messages）、API Key（掩码，
env 探测提示）、模型目录（逐行 ID/名称/上下文窗口/最大输出/输入类型〔视觉〕/推理等级）、
**获取可用模型**连接测试（`registerModelDiscovery` 拉网关 `/models`）。

**装载配方（profile 用户层）与两条机制教训（浏览器 E2E 实测定论）**：

```yaml
- id: llm-pi-ai          # 根级覆写 base 休眠行——【不要】放 - insert: 块内
  config:
    providers:
      litellm:
        displayName: 企业模型网关（LiteLLM）
        apiKeyEnv: LITELLM_API_KEY     # env 优先；UI 填 Key 落 .credentials.yaml(0600)
        api: openai-completions
        baseURL: http://<内网网关>/v1  # 字面值——见教训 2
        models:
          - id: deepseek-flash
            name: DeepSeek Flash（企业网关）
            contextWindow: 131072      # 声明值，UI 可改
            maxTokens: 8192

- id: agent-default-model  # base 既有行覆写
  config:
    provider: litellm                  # pi-ai 路由 key
    model: deepseek-flash
```

1. **必须根级覆写，不能 insert**：`configEditor` 只定位根级非 insert 行
   （dsh-config-editor `lib/index.js:97,100` 明确跳过 `row.has("insert")`）；行在
   insert 块内则设置页保存静默不落盘、编辑器状态回退。base 行本就存在，覆写即激活。
2. **config 必须字面值，不能 `!!js` 表达式**：含 `!!js` 的字段被 pi-ai 的 config
   schema 拒收（`$.providers.litellm.baseURL expected string but got [object Object]`
   ——表达式节点 ≠ string），保存被静默拒绝；env 语义由 `apiKeyEnv`（credential-ref
   字符串）承担，`baseURL` 写内网字面地址（无密钥落地面）。
3. **volatile 热生效**：`providers` 整节标 volatile（pi-ai `lib/index.js:1086`），UI
   改模型目录/显示名保存即写回 patch 用户层并热生效，下一请求生效不重启；
   `providers` 是仅有的 volatile 节点，`api`/`apiKeyEnv` 改动走整行 reload。
4. **模型发现即连接测试**：「获取可用模型」经 `llm/discoverModels` 对 baseURL 发
   `/models`（一次性凭据不落库）；目录保存后模型选择器按 displayName 分组展示全量。

**模型能力 tag（视觉，2026-11-13 补）**：模型选择器在模型名旁渲染能力 tag
（对齐 ZCode 参考样式）。数据链路：能力真值=pi-ai 配置行「输入类型〔视觉〕」
（`providers.<ns>.models[].input` / 路由级 `defaultInput`；modality 词表仅
`text|image`，故「视觉」是唯一可真实推导的能力，不编造）；`@eterna/access`
网关在 `/api/session/modelCatalog` 响应上**不可变富化**上游既有字段
`ModelCatalogModel.badge`（`src/model-catalog.ts` 纯函数层 + tenant 专路；只补缺、
provider 自带 badge 不覆盖，configEditor 缺席=逐字段纯透传）。同一 RPC 亦供上游
`ui-model-selection`——composer 触发器与上游菜单零改动自动亮（上游位次：触发器
tag 在名前、菜单在名后，只读面不追改）。客户端 chip 全 `--et-*` 令牌渲染；
文案 LocalizedText `{en: Vision, zh: 视觉}` 按 `navigator.language` 解析（en 兜底）。

**企业挂载集第 6 行（@eterna/llm-doctor 体检哨兵，2026-11-09 补）**：协议↔baseURL
自动适配 + 逐模型连通性测试。装载 = 挂载集 insert 块加一行
`- id: eterna-llm-doctor, name: '@eterna/llm-doctor'`（profile node_modules symlink
`@eterna/llm-doctor → packages/llm-doctor`）。行为：
- **自动适配**：global 监听 `loader/volatile-update`（定向 emit 在被改条目自己的
  fiber ctx 上，兄弟插件必须 `{global:true}` 才收得到——非 global 注册静默失聪，
  实测教训）+ boot 延迟 2s 首检；按协议对端点路径发 GET（404=不存在/其余=存在，
  零凭据零模型调用），当前路径 404 且候选存在时经官方 `configEditor.edit` 改写
  baseURL（Loader 热生效，设置页自动刷新）。三条实现教训：
  ① `edit` 必须传 `entries()` 的活引用（`configuration()` 返回分离包装，直接传抛
  "Configuration entry is no longer available"）；
  ② 写回可能撞进 settings 保存未关的 HMR 事务（"HMR transactions cannot be
  nested"，协议切换触发 pi-ai 整行重载时事务超防抖窗）——600ms 退避重试至多 3 次；
  ③ 网关 SRC dispatch 按发射方 scope 过滤，网关方法与宿主状态必须全公开
  （#private 在 shadow 上读取即抛 "Cannot read private member"）。
- **逐模型测试**：官方 `settings.models.provider-card` keyed slot（ns=llm-pi-ai）
  在 provider 卡片内渲染「连通性诊断」内嵌面板——头部（标题 + 路径体检 pill chip，
  语义状态色）+ 自动适配通告 + 逐模型行（名称 / 结果徽记 / 测试按钮）。样式遵守
  产品设计纪律：色彩只走语义令牌（--dsw-alias-label/state/border/bg 系列，深浅
  主题自动跟随，零字面色值），测试按钮用官方 ui-primitives Button（outline/sm）。
  测试 = `llmDoctor/probe` 按协议真发极小补全，与 agent 会话同 wire 路径。
  RPC 载荷纪律：零参端点传 `{args:{}}`，带参才包 `{args:{input}}`（descriptor
  按 args 字段校验，零参多传 input 即拒）。
- **不变式**：探测只判路径存在性，网络不可达（非 404 失败）一律不改写；
  修正前后 base 只在原值±/v1 之间选择，不做其它猜测。

**企业挂载集第 7 行（@eterna/brand 品牌替换，2026-11-09 补）**：UI 品牌面
「DeepSeek Harness」→「**恒灵·EternaAgent**」（中英文名由用户 2026-11-09 从第三轮候选定名；恒=企业永恒基因、灵=Agent 智能体灵性；左上角显示「中文·英文」组合名(恒灵·EternaAgent),本地构建字样与版本号去除——brand.name slot 只渲染组合名；
命名经两轮侵权检索（EternaGrid 全网零冲突；EverVolt=松下注册商标、
恒擎/恒辉=同行业重叠/第 9 类在先商标、智枢=AI 赛道多家撞名均已排除；
正式商用前应到中国商标网做第 9/42 类精确查询）。五个替换面（零上游改动——
tab 标题 productTitle 硬编码在 ui-layout、badge 走 locale 内置键，均无配置缝）：
①tab 标题 MutationObserver 拦截改写（会话切换形态 `${title} — ${product}` 同覆盖）；
②favicon 换装 SVG data-URI（assets/icon-mono.svg 同源，v2=纯粗壮闪电——旧版细环+小闪电在 24px 退化为圆+点，用户实测反馈）；③侧栏 badge
（locale 键 brand.localBuild）字典覆写 + DOM 文本观察器双保险；④侧栏 logo 走
官方 slot `sidebar.brand.mark`（上游 fallback=FishLogo 深海鲸，正式席位注入粗壮
闪电标）；⑤残余鲸鱼按 viewBox 签名 "0 0 23.16 17.04"（FISH_LOGO_VIEWBOX
唯一）DOM 置换 + 文案地图（探索未至之境→方寸灵台，运筹万里——文化向标语，《庄子》灵台=心之神明、台=工作台双关、灵=品牌呼应）。
**教训四则**：esbuild 默认 charset=ascii 会把 bundle 中文转义为 \u 序列——
`charset: 'utf8'` 对齐官方 client bundle；文本观察器必须「命中才回写」——
无条件回写 nodeValue 会在 characterData 变更上自激死循环，页面永久卡 loading
（v2 首版实测）；slot 组件必须返回 React 元素——返回 SVG 字符串会被当纯文本
渲染，页面直接显示标签源码（v2 实测）；预览版说明弹窗的确认状态是持久
settings（ns `ui-settings-general`）但跨重启仍重现——品牌插件检测到弹窗即
程序化点「继续」（与手点同路径写真实确认）。预览版 chip 只清文字会残留空
样式块——按类名注入 `display:none!important` 样式表规则（React 重渲染不可
复活）；隐藏触发器必须计入扫描命中判定（scanText 只按 TEXT_MAP 过滤会漏掉
非 map 触发器，v5 首版实测漏检）（v3-v5 实测）。装载 = 挂载集 insert 块加
`- id: eterna-brand, name: '@eterna/brand'` + profile node_modules symlink。

**两档分工**：Web 档模型经 pi-ai（UI 可配、人工可运维）；embed 档维持
`@eterna/llm-openai`（无头环境变量形态，无 UI 面）——`docs/embed-profile.md` 同步注。

## 创造模式回加（preset-cordis，2026-11-09 用户裁定「很重要」）

`preset-cordis`（创造模式：Agent 编写插件、组合工具与提示词创建模式，含 workflow
创建能力）整份重述回加。**硬依赖与解法**：其 skill-filesystem 的 customSkillDirs
表达式以 `createRequire(baseUrl)` 解析 `@deepseek-ai/dsh-agent-preset`
（baseUrl=profile 目录）——profile node_modules 必须链接该包：
`ln -s <node_modules/.pnpm/@deepseek-ai+dsh-agent-preset@0.2.2-rc.1_*/node_modules/@deepseek-ai/dsh-agent-preset>
$DSH_HOME/profiles/eterna-web/node_modules/@deepseek-ai/dsh-agent-preset`
（verify-eterna-web 物化时自动创建）。重述差异共两处：tool-plugin-manager/
tool-plugin-market → disabled（企业红线：三方准入不开放）。
**技能品牌化**：skill-filesystem 的 customSkillDirs 指向 `@eterna/creation-skills`
（symlink→packages/brand，其 `skills/` 为上游 `@deepseek-ai/dsh-agent-preset/skills`
四技能的品牌化 fork——散文层 DeepSeek Harness/DSH 共 94 处→EternaAgent，
包名 @deepseek-ai/* 为真实依赖保留；升级姿势=与上游 re-diff 后重放替换脚本）。
profile node_modules 需 symlink `@eterna/creation-skills`。**连带回加**：
workflow-ptc 硬依赖 ptcRuntime 服务（static inject + 强制 TypeScript 运行时），
ptc-runtime/workflow-ptc/tool-workflow 三宿主行随之回加（默认标准会话经
preset-standard 内 disabled 不可见，仅创造模式启用）；tool-executor-ptc 维持
裁切（仅 ptc 会话使用）。verify 断言：22 裁切行、104 保留行、presets=
standard/minimal/cordis 全部绿。

## 裁切清单（23 个宿主行 + 预设层；shortcuts 改判必留见偏差 3）

裁切 = 覆写既有行并置 `disabled: true`（补丁语义：裸 id 行只覆写既有行；
新增行必须 `- insert:`——`packages/glue/cordis.patch.yml:1-7` 的 E2E 教训）。
行号引用 = deepseek-harness 仓库检出补丁文件（base=base/cordis.patch.yml，
web=web-app/cordis.patch.yml）。

| 行 id | 层 | 理由 | 依据 |
| --- | --- | --- | --- |
| `otel` | base:202 | OTel SDK 宿主行，遥测红线 | §11.2 表 |
| `session-telemetry-otel` | base:218 | 外联 `dsh-otel-collector.deepseeksvc.com`（base:225），裁后无隐式外联 | §11.2 表 / §11.8 |
| `desktop-product-telemetry` | web:37 | 遥测第二处 | §11.3 / §11.8 |
| `product-analytics` | web:49 | 遥测第二处（客户端半） | §11.3 / §11.8 |
| `authorization` | base:117 | 凭据解析链（managed `.credentials.yaml`），密钥改走环境变量/自建路由层 | §11.2 表 / §11.8 |
| `deepseek-account` | base:120 | 账号体系（DeepSeek Platform 登录态） | §11.2 表 / §11.8 |
| `llm-deepseek` | base:544 | DeepSeek API-key 路由（凭据体系替代） | §11.2 表 |
| `llm-deepseek-account` | base:547 | DeepSeek 账号路由 | §11.2 表 |
| `account-controller` | web:143 | 账号 API，硬注入 `deepseekAccount`（dsh-api-account-controller `lib/index.js:199`），底层行裁后不裁必 failed | §11.8（账号体系） |
| `ui-settings-account` | web:140 | 账号设置页 | §11.3 / §11.8 |
| `ptc-runtime` | base:405 | 程序化工具调用运行时，图纸无对应 | §11.2 表 / §11.8 |
| `workflow-ptc` | base:408 | workflow 引擎（spawn provider） | §11.2 表 / §11.8 |
| `tool-workflow` | base:413 | workflow 模型工具 | §11.2 表 / §11.8 |
| `tool-executor-ptc` | base:517 | 本就 disabled，重申裁切 | §11.2 表 / §11.8 |
| `fs-observation-policy` | base:292 | 本就 disabled，重申裁切 | §11.2 表 |
| `tool-plugin-manager` | base:16 | 本就 disabled，重申裁切（含预设内重述，见下） | §11.2 表 / §11.8 |
| `ui-workflow-run` | web:384 | workflow 会话 UI 卡 | §11.3 / §11.8 |
| `office-to-pdf` | web:291 | 场景裁切 | §11.3 / §11.8 |
| `open-in-app` | web:73 | 「用应用打开」宿主半 | §11.3 / §11.8 |
| `ui-open-in-app` | web:84 | 「用应用打开」浏览器半 | §11.3 / §11.8 |
| `shortcuts` | web:264 | ~~键盘快捷键引擎~~ **2026-11-09 改判必留**（偏差 3：client 服务根） | ~~§11.3 / §11.8~~ |
| `ui-shortcuts` | web:267 | 快捷键 UI 半（同族，维持裁切：无人等待其服务） | §11.3 / §11.8 |
| `ui-brand-official` | web:348 | 品牌行 | §11.3 / §11.8 |
| `ui-message-feedback` | web:429 | 反馈面，「遥测已裁则无意义」 | §11.3 / §11.8 |

预设层（agent 平面）——真 boot 实测：仅裁宿主行不够，shipped
standard/cordis 预设在 delegation 组原样启用 `workflow-ptc`/`tool-workflow`，
ptc 预设启用 `tool-executor-ptc`，会话级照常复活。处置（官方机制：预设行整份
config 重述，即 Web 编辑器保存预设的写法——`presets/standard.patch.yml:1-3`
"Edits saved from the Web editor override this row's `config.plugins` by id
from the profile patch"）：

- `preset-standard`（默认预设）：整份重述，仅三处变化——delegation 组内
  `workflow-ptc`/`tool-workflow` 置 `disabled: true`；`tool-plugin-manager` 置
  `disabled: true`。其余逐行与装品一致。
- `preset-ptc`：整体 `disabled: true`（其存在意义即 ptc/workflow 会话）。
- `preset-cordis`：整体 `disabled: true`。原因：其 `skill-filesystem` 行的
  `customSkillDirs` 表达式以 `baseUrl`（=profile 目录）解析
  `@deepseek-ai/dsh-agent-preset`，profile 层重述无法求值（实测
  `MODULE_NOT_FOUND`，profile 无 node_modules）；其独有内容（`tool-cordis`、
  预设创作技能）均非 §11 必留项。
- `preset-minimal`：不含任何裁切家族行，原样保留。

## 三条偏差（对 §11.2/§11.8 字面清单，均为实测结论）

1. **`credentials` 保留不裁**。`connection` 行（web 传输层，
   `requiredStartupEntryIds` 必需成员，dsh-app-boot `lib/index.js:5017-5028`）
   插件级 `inject = ["credentials"]`（dsh-client-connection `lib/index.js:1013`），
   BrowserAuth 用 `credentials.modifyRecord` 持久化浏览器会话签名密钥
   （`lib/index.js:391-401`、`:1034`）。实测裁掉即启动失败：
   `dsh: startup failed: 1 required plugin did not activate — connection (required) missing credentials`。
   全装品只有 dsh-credentials-local 提供该服务，无法替换。合规实质不受损：
   裁掉 authorization/deepseek-account/llm-deepseek/llm-deepseek-account 后，
   该文档仅承载浏览器会话签名 record，无模型密钥写入路径；web 检索密钥走
   `DEEPSEEK_API_KEY` 环境变量（§11.8）。
2. **agent 平面随预设装载**（见上表后的预设层处置）——这是组合事实而非计划
   变更；§11.8「UI 与底层行成对回加」同理成立于预设层。
3. **`shortcuts` 改判必留（2026-11-09）**。`@deepseek-ai/dsh-client-shortcuts`
   是 client 服务根——浏览器端 26 个 client-ui 插件（layout/contextMenus/
   sidebar 系/chat/workspace/conversation 等）的启动等待链全部级联到
   `shortcuts` 服务，裁掉即 `web boot: 26 entries did not activate` 全家
   pending。教训：宿主 `pluginInventory` 断言照绿（`verify-eterna-web` 曾
   exit 0），client 侧失败只在真浏览器暴露——**裁切验证必须含浏览器端
   E2E**。同族 `ui-shortcuts`（快捷键设置页）维持裁切，无插件等待其服务。

## 保留清单（验证断言口径）

`scripts/verify-eterna-web.mjs` 对真 boot 后的 `pluginInventory/list`（Loader
当前条目的只读投影，`packages/host/plugin-inventory/src/index.ts:70-121`）断言：

- **101 个宿主行** present + enabled + **active**：基础骨架（llm/llm-retry/
  session 族/compaction/spill/image-offload/agent/agent-loop/system-prompt/
  tools/tool-executor-native/fs-sandbox/sandbox 族/approval/permission/
  shell-env/subprocess/timeout-policy/repeat-tool-reminder/token-meter）、
  commands+command-feedback+tool-todo 基础设施、todo/commands/agent-instructions
  全留（§11.6）、working-directory/storage 三件套/attachment-local/
  mcp-resources、**goal 四件套（goal/goal-round-driver + 预设 command-goal/
  tool-goal）**、**plan-mode（预设内 active）+ ui-plan**、**subagent 家族
  （subagent/spawn/fork 宿主行 + 预设 tool-subagent/fork/control）+
  ui-subagent/subagent-model-selection-settings**、**jobs 家族
  （jobs/job-controller/ui-jobs/deliverable-file-references，图纸⑦）**、
  **schedule + ui-schedule（+ 预设 tool-schedule）**、**web 检索五件套
  （web/web-search-deepseek/web-deepseek-api/web-fetch-http + 预设
  tool-web）**、**session-title + session-title-llm**、**skill 三件套
  （skill 宿主 + 预设 skill-filesystem/tool-skill）+ ui-skill**、
  **ui-sidebar-browser（本层 `disabled: false` 显式回加，web-app:300-302
  原本仅 desktop 启用）+ ui-sidebar-terminal + terminal-controller**、
  ui-deliverables、session-log-download、审批/上传/设置/会话控制等 UI 面、
  typert 三件套 + remote-access（Web 网关依赖）、以及 **`credentials`**
  （偏差 1 的实证行，必须保持 enabled）。
- **20 个预设行**（standard 预设内）present + enabled + active：tool-bash/
  tool-fs/tool-fs-search/tool-jobs/tool-schedule/skill-filesystem/tool-skill/
  command-goal/tool-goal/plan-mode/compaction-basic/command-compact/
  tool-result-pruner/tool-subagent-control/tool-subagent/tool-subagent-fork/
  tool-todo/tool-web/agent-instructions/tool-ask-user。
- **23 个裁切行**（shortcuts 已改判必留，偏差 3）：宿主树 absent 或 disabled，且**任何预设组合内不 enabled**。
- **0 个 failed 条目**：任何行 failed（如未来上游刷新引入新的硬注入断链）即失败。
- 附带断言：standard 预设在册且为默认。

## 如何一行回加

裁切是可逆的（§11.1 原则 2）：每处裁切都是覆写块，删除该块（或把 `disabled`
翻回）即回加，然后重跑 `node scripts/verify-eterna-web.mjs`。示例：

```yaml
# 回加 office-to-pdf：从 profiles/eterna-web/cordis.patch.yml 删除这三行
- id: office-to-pdf
  disabled: true

# 回加 workflow 家族（宿主 + 预设层两处都要动）：
# 1) 删除宿主三行 ptc-runtime / workflow-ptc / tool-workflow 的覆写块；
# 2) preset-standard 重述块 delegation 组内把两行 disabled: true 删掉；
# 3) 如需 ptc 预设，删除 preset-ptc / preset-cordis 的禁用块
#    （preset-cordis 见上文 baseUrl 限制，需随 @eterna 侧处理）。

# ui-sidebar-browser 是反向示范：disabled: false 即为回加。
```

注意 `credentials` 无「回加」问题（本就保留）；遥测回加前先过企业合规评审
（§11.2：永不，自建 OTLP 除外）。

## 版本对齐注意

仓库检出（deepseek-harness @ 0.2.2-rc.1 工作树）比装品（npm 0.2.2-rc.1，实际
boot 的包）**新**，以下行只存在于仓库检出、装品中没有，本层因此**未**对其写
覆写（写了也会被丢弃——applyPatches 对不存在的目标仅告警跳过）：

- base：`agent-team`、`tool-agent-team`（subagent 家族 8 行中的 2 行；
  装品只有 6 行，§11.8 的「回加」对装品是空操作，上游刷新后自动成立）。
- web-app：`mcp-manager`（`inject: [credentials]`——上游若装上它，与偏差 1
  同源不冲突，credentials 本就保留）、`ui-plugin-graph`（§11.3 裁切项，装品
  无此行，无需裁）、`ui-agent-team`；`web` 行默认 `searchProvider` 装品为
  `deepseek-official`、仓库为 `deepseek-search-api`（装品的
  dsh-web-search-deepseek 只注册 `deepseek-official`，本层不改 `web` 配置，
  检索密钥经环境变量解析）。

上游刷新后的动作：重读两份 cordis.patch.yml diff → 核对裁切清单 → 重跑
`node scripts/verify-eterna-web.mjs`（其 0-failed 断言会抓出新引入的硬注入断链，
如上游给 mcp-manager 装上 `inject: [credentials]` 时不需动作，credentials 保留）。

## 验证方式

```bash
node scripts/verify-eterna-web.mjs   # exit 0 = 通过
```

为什么不是 `dsh --dump-config`：dump-config 只证明补丁文本合成正确，不证明行
激活（2026-11-04 E2E 教训：裸 id 行被 applyPatches 丢弃后 dump 里毫无踪迹，
pluginInventory 里同样无条目才暴露问题）。本验证走真 boot：以 web-runtime 的
就绪行 `dsh web: <url>` 为信号（该行仅在 Loader 落定且必需行审计通过后打印，
web-app `src/index.ts:244-254`），用 URL 内的 launch token 换浏览器会话
cookie，POST `/api/pluginInventory/list` 读**激活态**，逐行断言。脚本自身
物化 profile、
选定 OS 端口、有界关闭子进程，可重复执行。


## Companion 浏览器执行面挂载（E1，2026-11-10）

`cordis.patch.yml` 末尾的 `mcp-browser` 条目（`- insert:` + `@deepseek-ai/dsh-mcp-client`）把本仓
`packages/browser-relay` 的 MCP stdio server（`dist/mcp.mjs`）挂进会话工具面，工具名 `mcp__browser__browser_snapshot / browser_click / browser_fill`。

物化注意（在「如何回加」的 symlink 流程上追加一条）：

1. `@deepseek-ai/dsh-mcp-client@0.2.2-rc.1` 需 symlink 进
   `$DSH_HOME/profiles/eterna-web/node_modules/@deepseek-ai/dsh-mcp-client`（verify-eterna-web.mjs 已自动化）。
2. relay 须先行运行：`node packages/browser-relay/dist/cli.mjs start`（默认 127.0.0.1:9310；
   relay 未运行时工具仍出现，调用返回明确错误）。用户浏览器加载 Eterna Companion 扩展（开发者模式，
   `packages/extension-companion/dist`）。
3. MCP stdio server 响应帧必须带 `jsonrpc: '2.0'` 字段——MCP SDK 2.2.0 zod schema 严格校验，
   缺失时客户端静默超时（E1 实测根因，勿删 mcp.ts 内注释）。
4. SDK 2.2.0 connect 的 era 探针发 `server/discover`（2026-07-28 协议）；legacy-only server 按
   SDK 语义回 `-32022` + `data.supported` 可毫秒级回落 legacy 握手（mcp.ts 已实现）。
