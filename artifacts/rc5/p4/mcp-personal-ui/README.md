# B14 个人层 UI（T28）— 证据

日期：2026-11-20 · 工作树：`/Users/sunny/code/agent-basis-rc5`（分支 `feat/dsh-rc5-merge`，HEAD `02f4857`）
依据：54 §4.6（T28）+ 50 §3.4.4 + 49 §5.4/§7；视觉按 frontend-style v4（42 号）与 AGENTS.md 铁律。
边界：只改 `packages/access/src/client/**` 与其 styles/locales/tests；未改服务端；未 push/merge；未动生产容器；无凭据落盘。证据已脱敏（无密钥/无 headers/env 值/无账号密码）。

## 1. 交付

| 文件 | 内容 |
|---|---|
| `packages/access/src/client/mcp-servers-section.tsx`（新增 427 行） | 「MCP 服务器」settings.section 组件：admin 两页签（全局 / 管理员目录）、普通用户「我的服务器」；列表 / 新增 / 编辑 / 删除 / 连接测试 |
| `packages/access/src/client/mcp-servers-model.ts`（新增 300 行） | 纯逻辑：角色→页签、草稿/校验、upsert/启停请求构造、密钥 write-only 语义、probe/配额文案 |
| `packages/access/src/client/mcp-personal-api.ts`（新增 89 行） | `/api/mcp-personal/{catalog,list,upsert,delete,probe}` 的 RPC 信封封装（复用 `rpc.ts`，裸 body 会 400） |
| `packages/access/src/client/mcp-servers-locales.ts`（新增 175 行） | zh/en 文案（说明类 ≤40 字） |
| `packages/access/src/client/settings-nav.ts`（新增 27 行） | 设置壳 `sidebar.settings` 座位 → `actions.openSection(id)`（模型抽屉与 MCP「全局」共用） |
| `packages/access/src/client/index.tsx`（改 29 行） | 注册 `${NS}.mcp-servers`（order 42，label「MCP 服务器」）；合并 MCP 文案；`openModelsSettings` 改为共享跳转 |
| `packages/access/src/client/sections.tsx`（改 7 行） | 导出 `PasswordInput` 并支持 `ariaLabel`（MCP 行内密钥输入复用） |
| `packages/access/src/client/styles.ts`（改 119 行） | MCP 分区样式（仅 `--et-*` 令牌；断点 760/640；无 z-index） |
| `packages/access/tests/mcp-personal-client.spec.ts`（新增 278 行） | 19 条客户端契约测试 |

## 2. 命令与退出码（原文）

| # | 命令（cwd） | EXIT | 摘要 |
|---|---|---|---|
| 1 | `pnpm --filter @eterna/access run verify`（仓库根） | 0 | 全链：`build-client`（lib/client.js 309.7kb）→ oxlint `Found 0 warnings and 0 errors.` → `tsc --noEmit` → **49 test files / 498 tests passed** |
| 2 | `cd packages/access && ../../node_modules/.bin/vitest run tests/mcp-personal-client.spec.ts --reporter=verbose` | 0 | **19 tests passed**（本任务定向） |
| 3 | `cd packages/access && node scripts/build-client.mjs` | 0 | `lib/client.js 309.7kb`（工件形态 `window.__ModuleLoader__.load({id:"@eterna/access", factory})`） |
| 4 | `node scripts/lint-ui-tokens.mjs`（仓库根） | 0 | `UI 令牌检查通过：17 个目录 287 个文件，79 个 --et-* 令牌；状态点强制 30/30 通过；v4 阶梯 0 债务。` |
| 5 | `cd packages/access && node /tmp/mcp-ui-bundle-smoke.cjs` | 0 | `ASSERT_OK`：真实 `lib/client.js` 在 vm 内 factory 装载；user/admin 均注册 `eterna-access.mcp-servers`，label 解析为「MCP 服务器」 |
| 6 | 静态样式断言（内联 node，日志 `static-style-assertions.log`） | 0 | MCP CSS 4,232 B；`@media` 仅 760/640/`prefers-reduced-motion`；圆角仅 `0/--et-radius-sm/--et-radius-lg`；`z-index` 0；hex/rgb 0；5 个新增源文件字面色值 0、原生 confirm/alert 0 |

日志：`access-verify.log/.exit`（首跑）、`access-verify-final.log/.exit`（提交前复跑，同样 EXIT 0 / 498 tests）、`vitest-mcp-ui.log/.exit`、`build-client.log/.exit`、`lint-ui-tokens.log/.exit`、`bundle-smoke.log/.exit`、`static-style-assertions.log/.exit`、`env-and-diff.log`。

> 过程记录（并发车道）：会话中段、其它 lane 的未跟踪文件 `src/chat-import.ts` 曾让包级 oxlint 报 2 条
> stylistic 错误，`tests/chat-import-gate.spec.ts` 曾让包级 `tsc` 报 4 条类型错误（均非本 lane 文件）；
> 期间本 lane 用 `tsc -p /tmp/tsconfig.mcp-personal-ui.json`（仅含本包 src + 本任务测试）验证自身为 0 错。
> 这两个文件随后由各自 lane 修好，最终第 1 行全链 EXIT 0（498 tests，比中段多 1 条=其它 lane 新增）。

## 3. 断言结果

**注册与角色（ask：settings.section「MCP 服务器」；admin 全局/管理员目录；普通用户我的服务器）**

- 注册点 `index.tsx:428-435`：`settings.section`、id `eterna-access.mcp-servers`、order 42、label `t('section.mcpServers')`。
- 页签表 `mcp-servers-model.ts:27-38`：admin → `['global','catalog']`；user → `['mine']`；测试 `mcp-personal-client.spec.ts`「角色 → 页签」。
- bundle 冒烟（真实工件）：
  - user：`settings.section = account(40) / mcp-servers(42) / notifications(43)`；
  - admin：另加 `users(41) / approval-queue(44)`；两者 mcp-servers label 均为「MCP 服务器」。

**列表 / 新增 / 编辑 / 删除 / 测试**

- 列表：`GET` 等价面 `POST /api/mcp-personal/list`，行内显示名称、传输方式、内部名 `p<uid>_<slug>`、密钥状态、启停开关；空态/限额（`已用 n/{limit}`）。
- 新增/编辑共用内联表单（`mcp-servers-section.tsx` `MyServersPanel`）：名称、传输方式；stdio 只从管理员目录选（环境变量按目录 `envNames` 展开）；HTTP 填 URL + 可增删请求头；保存/取消单组动作、busy 防重复。
- 删除：`ArmedDelete`（两击，4s/失焦自动解除）`mcp-servers-section.tsx:421`；源码扫描无 `window.confirm(`/`window.alert(`（测试 + 静态断言双重）。
- 测试：`POST /api/mcp-personal/probe` → 行内 `连接成功，发现 N 个工具` / `连接失败：{reason}`（服务端已脱敏）。

**密钥 write-only（ask：保存后只显示「已设置」）**

- 服务端视图只回 `hasSecret`（`mcp-personal-api.ts:14-33`）；客户端类型不含任何密钥值字段。
- 编辑草稿只保留 header 名，值恒为 `''`（`mcp-servers-model.ts:82-97`，测试「编辑草稿不为任何密钥字段回填值」）。
- HTTP 请求只发 `${secret:REF}` 占位，明文只进 `secrets`；留空不发（服务端保留旧密文）——`mcp-servers-model.ts:205-238`，测试断言 header 值不等于明文、`secrets[secretRefForHeader('Authorization')]='Bearer secret'`。
- stdio 只发非空 `env`；不发 `command/args`（`mcp-servers-model.ts:213-222`，测试断言无 `command/args/secrets` 键）。
- REF 确定性（同一 header 名 → 同一 ref，≤64、符合服务端 `[A-Za-z0-9_.:-]{1,64}`），编辑无需回读明文。

**UI 纪律（ask：@eterna/ui 令牌 / v4 断点 / 字面色值 0 / 正文 ≤3 行）**

- 样式：仅 `ea-*`（`styles.ts:712-830`）与 `--et-*`；圆角 `0/sm/lg`；无 z-index；断点仅 760/640（另有 `prefers-reduced-motion`）。
- 字面色值：`lint-ui-tokens.mjs` 全仓 0 违规；5 个新增源文件 hex/rgb 0。
- 文案：说明类 ≤40 字、标题 ≤12 字（测试「说明类文案 ≤40 字」）；正文提示均单句。
- 可访问性：`h3`（分区）/`h4`（卡片）、tab/tabpanel + 方向键/Home/End、`role="switch"`、`role="alert"/"status"`、label↔input `htmlFor`、`focus-visible` 令牌光环、`prefers-reduced-motion` 关动效。

## 4. 未做 / 无法验证（明确声明）

1. **v4 三视口双主题截图未产出**（54 §4.6 T28 完成定义含「v4 截图」）：本 lane 没有运行中的实例承载新构建，
   向线上/生产容器部署属硬边界禁止；组件未在真实浏览器中执行渲染。留待验收阶段用已部署构建按 42 号 §8b
   跑 1440/900/390 × 深浅两套截图与 `scrollWidth === clientWidth` 探针。
2. **服务端未改**：管理员目录/HTTP 白名单只读（服务端无写路由）；个人层限额/主密钥/kill-switch 语义均由 T26/T27 服务端裁决。
3. **「文件上传」**：本任务范围（54 §4.6 T28 / 50 §3.4.4）无上传控件，服务端也没有导入端点；access 现有唯一文件输入=账号头像，仍走 `ea-input` 令牌样式（`sections.tsx:216`、`styles.ts:73-78`），本次未改其行为。
4. **admin 是否也该有「我的服务器」**：按 ask 字面实现两页签；49 §7 矩阵写 admin 个人 CRUD ✅（自己的），与 50 §3.4.4 的 admin 两页签表述存在张力，需产品确认。

## 5. 风险与遗留（详见 LaneReport leftovers）

- ~~个人服务器与 `reservedServerNames` 自撞~~：**已核实不成立**。`plugin.ts:536-548` 调 `tools.schemas()` 不传 scope
  = 全局视图；而个人层工具经 `mcp-personal-runtime.ts:162-163,256` 的 `createScope` 挂进 Agent scope。
  dsh-tools 注册落层按 `scopeOf(ctx)` 选层（`dsh-scope/src/store.ts:233-244`），全局 `view(undefined)` 只从
  `layers.global` 构造（`dsh-tools/src/index.ts:199-207`），scope 层工具不进全局视图——故保留名集合不含个人 serverName，
  不会把本人编辑/启停误判为冲突。无需后端改动。
- 由其它客户端以非确定性 ref 创建的 HTTP 条目：编辑时留空密钥会按本 UI 的确定性 ref 引用，可能被服务端
  「引用的密钥未提供」拒绝（行内会显示该错误）；属跨客户端互操作边界。

## 6. 脱敏声明

证据内不含任何真实密钥、headers/env 值、账号密码或 cookie；测试中的 `Bearer secret` 是断言用假串。