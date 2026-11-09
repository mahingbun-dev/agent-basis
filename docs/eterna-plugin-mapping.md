# Eterna 插件命名映射与上游合并对照

> 2026-11-09 全套改名唯一事实源：`@basis/*`→`@eterna/*`、`basis-*`→`eterna-*`、
> profile/env/脚本文件名全套 eterna 化。本文档同时是日后从 DeepSeek Harness
> 上游源仓库合并代码/查插件时的对照表。改名执行后新增命名一律走 `eterna`。

## 1. 总则

- **改**：本仓库活代码、配置、文档的全部自有命名面（§2–§4）。
- **不改**：
  1. **官方内核 id**（§5 清单）——上游客户端/宿主硬编码，改名即断；
  2. `@deepseek-ai/*` npm 包名——真实运行时依赖（registry 公网可装），保留即升级通道；
  3. **冻结证据/历史记录**——改名等于篡改历史证据，保留旧名：
     `docs/acp-real-6*`、`docs/dev/`、`docs/release-gate-v2/`、
     `docs/t14-replay-20/`、`docs/perf-*`、`docs/design/[01-16]-*.md`（编号
     设计记录；`docs/design/enterprise-plugins.md` 为活文档不冻结）、
     `plans/*.md`（日期决策记录）、
     `packages/prompt-studio/tests/fixtures/*.jsonl`（脱敏会话存证）；
  4. 普通英文词 `basis`（如 "on a daily basis"、"basis point" 语义）——非产品名不替换。
- **替换纪律**：精确串替换（`basis-`/`@basis/`/`BASIS_` 带边界感知），禁止裸词盲替；每类替换后跑 `rg` 残留扫描 + 全量 verify。

## 2. Eterna 插件表（entry id ↔ 包 ↔ 旧名 ↔ 上游参考）

| Eterna entry id | 包 | 旧名（改名前） | 职责 | 上游参考（deepseek-harness 源仓路径） |
| --- | --- | --- | --- | --- |
| `eterna-governance` | `@eterna/glue/governance-plugin` | `basis-governance` | 治理 veto（tools/pre-execute 瀑布）+ ctx.governance | 无直接上游（自研；参考 packages/core/tools 的 pre-execute seam） |
| `eterna-audit` | `@eterna/glue/audit-plugin` | `basis-audit` | 审计留痕服务（jsonl sink）+ ctx.audit | 无直接上游（自研） |
| `eterna-egress` | `@eterna/glue/egress-plugin` | `basis-egress` | 三层出网判定（工具级→域名级→代理强注） | 无直接上游（自研） |
| `eterna-memory` | `@eterna/glue/memory-plugin` | `basis-memory` | 记忆面板/注入 | 无直接上游（自研） |
| `eterna-knowledge` | `@eterna/glue/knowledge-plugin` | `basis-knowledge` | 知识底座（kb 直连拒绝/检索） | 无直接上游（自研） |
| `eterna-llm` | `@eterna/llm-openai` | `basis-llm` | OpenAI 兼容适配器（embed 档无头 env-only） | packages/llm/llm-pi-ai（同类适配器形态） |
| **包位置迁移** | `packages/llm-openai` | `/basis/llm-openai`（gitignored 本地目录） | **2026-11-09 迁入仓库**——自包含要求基础插件入库；本地 `basis/` 目录仅存 basis-minimal 实验启动器 | — |
| `eterna-llm-doctor` | `@eterna/llm-doctor` | `basis-llm-doctor` | LLM 连通性诊断 | packages/llm/llm-pi-ai（承载联动） |
| `eterna-brand` | `@eterna/brand` | `basis-brand` | 品牌替换面（五面）+ creation-skills fork | packages/skill/skill-filesystem（customSkillDirs seam） |
| `eterna-panel` | `@eterna/panel` | `basis-panel` | 记忆/治理面板 UI | packages/client/ui-*（双面配方参照） |
| `eterna-prompt-studio` | `@eterna/prompt-studio` | `basis-prompt-studio` | system prompt 工作室 | packages/core/system-prompt（section seam） |
| `eterna-*`（其余自研包） | `@eterna/{audit,cache-guard,channels,evolve,extra,governance,interact,knowledge,memory,observe}` | `@basis/*` 同名 | 见各包 README | 无直接上游（自研） |
| `eterna-smoke`（工具） | `@eterna/smoke` | `@basis/smoke`（tools/basis-smoke） | 冒烟 CLI | — |
| `eterna-evals`（工具） | `@eterna/evals` | `@basis/evals`（tools/evals） | 评测 CLI/ACP 驱动 | python/sdk（上游评估驱动参照） |
| `eterna-packctl`（工具） | `@eterna/packctl` | `@basis/packctl`（tools/packctl） | 行业包脚手架 CLI | — |
| `eterna-web`（profile） | profiles/eterna-web | `basis-web` | Web 档裁切组合 | packages/bundle/base + web-app |
| `eterna-embed`（profile） | profiles/eterna-embed | `basis-embed` | 嵌入档裁切组合 | packages/bundle/base + headless |
| `provider: eterna` | `@eterna/llm-openai` 路由键 | `provider: basis` | agent-default-model 指向 | — |

## 3. 上游依赖表（@deepseek-ai/* npm ↔ deepseek-harness 源仓路径）

合并上游代码时按此表定位源文件（源仓库本地检出路径可任意，npm 版本以根
`pnpm-workspace.yaml` catalog 钉版为准）：

| npm 包 | 源仓库路径 | npm 包 | 源仓库路径 |
| --- | --- | --- | --- |
| `@deepseek-ai/dsh-agent` | packages/core/agent | `@deepseek-ai/dsh-base` | packages/bundle/base |
| `@deepseek-ai/dsh-agent-preset` | packages/preset/agent-preset | `@deepseek-ai/dsh-web-app` | packages/bundle/web-app |
| `@deepseek-ai/dsh-llm` | packages/llm/llm | `@deepseek-ai/dsh-headless` | packages/bundle/headless |
| `@deepseek-ai/dsh-llm-pi-ai` | packages/llm/llm-pi-ai | `@deepseek-ai/dsh-tool-fs` | packages/fs/tool-fs |
| `@deepseek-ai/dsh-message-feedback` | packages/feedback/message-feedback | `@deepseek-ai/dsh-tool-bash` | packages/shell/tool-bash |
| `@deepseek-ai/dsh-permission-presets` | packages/interaction/permission-presets | `@deepseek-ai/dsh-skill-filesystem` | packages/skill/skill-filesystem |
| `@deepseek-ai/dsh-persona` | packages/preset/persona | `@deepseek-ai/dsh-plugin-manager` | packages/boot/plugin-manager |
| `@deepseek-ai/dsh-sandbox` | packages/sandbox/sandbox | `@deepseek-ai/dsh-session` | packages/core/session |
| `@deepseek-ai/dsh-subagent` | packages/subagent/subagent | `@deepseek-ai/dsh-storage` | packages/storage/storage |
| `@deepseek-ai/dsh-storage-domain` | packages/storage/storage-domain | `@deepseek-ai/dsh-system-prompt` | packages/core/system-prompt |
| `@deepseek-ai/dsh-tools` | packages/core/tools | `@deepseek-ai/dsh-user-approval` | packages/interaction/user-approval |
| `@deepseek-ai/dsh-user-questions` | packages/interaction/user-questions | `@deepseek-ai/dsh-typert-protocol` | packages/typert/protocol |

- `@deepseek-ai/cordis`、`@deepseek-ai/cordis-plugin-*`：**cordis 独立上游**
  （非 deepseek-harness 仓），查 cordis 仓。
- 版本纪律：catalog 钉版家族统一升级；上游 bump 后先对 `dsh-base` 补丁行 id
  重排（profiles/eterna-*.patch 的行号依据），再重放企业覆写。

## 4. 其余命名面清单

| 类别 | 旧 | 新 |
| --- | --- | --- |
| 脚本 | scripts/verify-basis-web.mjs | scripts/verify-eterna-web.mjs |
| 文档 | docs/basis-web-profile.md | docs/eterna-web-profile.md |
| 环境变量 | `BASIS_LLM_BASE_URL` / `BASIS_PROFILE_HOME` / `BASIS_PANEL_SERVICE_ID` / `BASIS_*_PLUGIN_NAME` | `ETERNA_*` 同后缀（`LITELLM_API_KEY` 上游约定保留） |
| 本地运行态（gitignored） | `.basis-home-accept`、`.basis/`、`.basis-home*` | `.eterna-home-accept` 等，同步更新 init 脚本引用 |
| id 前缀 | `basis-audit-sink-`、`basis-audit-query-`、`basis-channels-binding-`、`basis-channels-token-`、`basis-evolve-*`、`basis-glue-*`、测试 session 前缀（`basis-acceptance-`、`basis-embed-smoke-`、`basis-evals`、`basis-ci`、`basis-guide` 等） | 同构 `eterna-*` |
| 运行态目录/标识 | 审计与治理落盘 `cwd/.basis/`、prompt-studio 存储键 `basis_prompt_studio`、panel SRC 服务 `basisPanel`、租户 Symbol `basis:tenant-realm:*`、审批规则 `basis.prompt-studio.persona-write`、interact 预设前缀 `'basis'`、provider 路由键 `basis` | `.eterna/`、`eterna_prompt_studio`、`eternaPanel`、`eterna:tenant-realm:*`、`eterna.prompt-studio.persona-write`、`'eterna'`、`eterna` |
| 仓库身份引用 | LICENSE 版权行、GitHub badge/clone URL、`agent-basis` 仓库名叙事 | **不改**（仓库代号；GitHub 仓库名变更另行裁定） |
| 领域词保留 | `args.basis`（付款依据参数）、英文 "best-effort basis"、外部账号 `agentbasis_qa` | **不改**（非产品名） |
| 样式命名空间 | `basis-brand-hide`、`[data-basis-*]`（如有） | `eterna-*` 同构（llm-doctor 的 `bdoc` 命名空间本就中性，不动） |
| 叙事文案 | 「Basis 企业 Web 档」「basis 治理面」等 | 「Eterna 企业 Web 档」等（历史证据文档除外，见 §1） |

## 5. 不可改名清单（官方 id，改名即断）

这些 id 由上游客户端/宿主硬编码，eterna 化时**显式豁免**：

- **模型页编辑器映射**：`llm-pi-ai`（ui-settings-models `layoutOf(ns)` 只认
  `llm-deepseek`/`llm-pi-ai`）——llm-doctor 的 `PI_AI_ENTRY_ID` 同此；
- **路由与凭据**：`agent-default-model`、`credentials`、`authorization`；
- **预设**：`preset-standard`、`preset-ptc`、`preset-cordis` 及其内部插件 id
  （`persona`、`plan-mode`、`compaction-basic`、`delegation` 组等）；
- **裁切目标行**：`otel`、`session-telemetry-otel`、`llm-deepseek` 家族、
  `ptc-runtime`、`workflow-ptc`、`tool-*`、`ui-*`、`shortcuts`、
  `session-log-deepseek` 等——这些是**上游行 id**，只覆写不更名；
- **provider 保留键**：`deepseek-official`（上游默认路由键，仅出现在注释）。

## 6. 上游合并姿势

1. **定位**：按 §3 表找到源仓路径；本地检出路径无关（自包含，不要求存在
   sibling checkout）。
2. **可合并物**：上游 bundle patch 行变化（先对 profiles/eterna-*.yml 重排）、
   preset 整份重述（preset-standard/preset-cordis 重放）、官方插件行为变化
   （对 affected 覆写行重审）。
3. **fork 技能**（packages/brand/skills/）：与上游 packages/skill/skill-filesystem
   的技能散文 re-diff 后，重放「上游名→EternaAgent」替换。
4. **不可合并物**：企业插件层（§2 自研表）与上游无对应，走自有演进。
5. **禁止**：直接改 deepseek-harness 源仓（只读参照）；把 `@deepseek-ai/*`
   改名/vendor 化。
