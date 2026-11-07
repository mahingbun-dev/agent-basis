# Basis 企业 Web 档（basis-web profile）

状态：已落地并真 boot 验证通过（`node scripts/verify-basis-web.mjs`，exit 0）。
日期：2026-11-07。权威依据：`plans/2026-11-06-dsh企业agent路线定案.md` §11，以
§11.7（图纸复核）与 §11.8（二次裁定）为准。行 id 权威来源：deepseek-harness
`packages/bundle/base/cordis.patch.yml` 与 `packages/bundle/web-app/cordis.patch.yml`
（先读后写；本 profile 实际 boot 的是同版本号装品内的这两个文件，差异见
[版本对齐注意](#版本对齐注意)）。

## 组合形态

```
@deepseek-ai/dsh-base        0.2.2-rc.1   bundle 层（基础树 insert）
@deepseek-ai/dsh-web-app     0.2.2-rc.1   bundle 层 + 其 presets/*.patch.yml（4 个预设）
profiles/basis-web/cordis.patch.yml       profile 用户层（最后写赢，本文档所述裁切层）
```

- 组合定义：`profiles/basis-web/cordis.patch.yml`（覆写层，无 `- insert:` 行）+
  `profiles/basis-web/README.md`。
- 物化与 boot：`scripts/verify-basis-web.mjs` 把组合层拷贝为
  `$DSH_HOME/profiles/basis-web/cordis.patch.yml`（默认 home
  `.basis-home/`，可用 `BASIS_PROFILE_HOME` 改指），用仓库本地
  `node_modules/@deepseek-ai/dsh` 的 CLI 以
  `dsh --profile basis-web --no-open --port 0` 真启动。bundle 包从 dsh 安装锚
  解析（`resolveBundleDir`：安装锚优先、profile 目录兜底，
  dsh-app-boot `lib/index.js`），因此该 profile **无需 pnpm install**。
- 端口：`--port 0` 由 OS 分配，避开被常驻实例占用的 3080/3081；`--no-open`
  不拉浏览器。
- 不调模型、不需要任何凭据：boot 只装配 Cordis 树，不发 LLM 请求。

## 裁切清单（24 个宿主行 + 预设层）

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
| `shortcuts` | web:264 | 键盘快捷键引擎 | §11.3 / §11.8 |
| `ui-shortcuts` | web:267 | 快捷键 UI 半（同族） | §11.3 / §11.8 |
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

## 两条偏差（对 §11.2/§11.8 字面清单，均为实测结论）

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

## 保留清单（验证断言口径）

`scripts/verify-basis-web.mjs` 对真 boot 后的 `pluginInventory/list`（Loader
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
- **24 个裁切行**：宿主树 absent 或 disabled，且**任何预设组合内不 enabled**。
- **0 个 failed 条目**：任何行 failed（如未来上游刷新引入新的硬注入断链）即失败。
- 附带断言：standard 预设在册且为默认。

## 如何一行回加

裁切是可逆的（§11.1 原则 2）：每处裁切都是覆写块，删除该块（或把 `disabled`
翻回）即回加，然后重跑 `node scripts/verify-basis-web.mjs`。示例：

```yaml
# 回加 office-to-pdf：从 profiles/basis-web/cordis.patch.yml 删除这三行
- id: office-to-pdf
  disabled: true

# 回加 workflow 家族（宿主 + 预设层两处都要动）：
# 1) 删除宿主三行 ptc-runtime / workflow-ptc / tool-workflow 的覆写块；
# 2) preset-standard 重述块 delegation 组内把两行 disabled: true 删掉；
# 3) 如需 ptc 预设，删除 preset-ptc / preset-cordis 的禁用块
#    （preset-cordis 见上文 baseUrl 限制，需随 @basis 侧处理）。

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
`node scripts/verify-basis-web.mjs`（其 0-failed 断言会抓出新引入的硬注入断链，
如上游给 mcp-manager 装上 `inject: [credentials]` 时不需动作，credentials 保留）。

## 验证方式

```bash
node scripts/verify-basis-web.mjs   # exit 0 = 通过
```

为什么不是 `dsh --dump-config`：dump-config 只证明补丁文本合成正确，不证明行
激活（2026-11-04 E2E 教训：裸 id 行被 applyPatches 丢弃后 dump 里毫无踪迹，
pluginInventory 里同样无条目才暴露问题）。本验证走真 boot：以 web-runtime 的
就绪行 `dsh web: <url>` 为信号（该行仅在 Loader 落定且必需行审计通过后打印，
web-app `src/index.ts:244-254`），用 URL 内的 launch token 换浏览器会话
cookie，POST `/api/pluginInventory/list` 读**激活态**，逐行断言。脚本自身
物化 profile、
选定 OS 端口、有界关闭子进程，可重复执行。
