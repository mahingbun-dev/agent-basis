# RC5-CMD-001 · `/` 命令面板

**结论：PASS**（菜单可见 + rc.5 首方命令在主机目录齐全；`permission` 的菜单缺席是既有 access 设计，不是 T39 缺陷）

## 判据与实测

| 判据 | 实测 |
|---|---|
| 输入 `/` 出现命令列表 | 29 行（`slash-menu-visible`） |
| rc.5 现有命令齐全 | 主机目录 6 条：`compact, export, feedback, goal, permission, plan`（活体 probe） |
| 菜单渲染的首方命令 | 目标/计划/反馈/压缩/下载日志 5 条 + 客户端贡献 `model` + skills 区 |
| 无重复行 | 29 行 id 唯一；`compact` 恰 1 行、`model` 恰 1 行 |

截图：`slash-menu.png`（1440×900，深浅跟随产品主题；正文中文）。

## 实现定位

- 主机命令目录 RPC：`@deepseek-ai/dsh-commands` `CommandRuntime.list(agent)`（`node_modules/.pnpm/@deepseek-ai+dsh-commands@0.2.2-rc.5_.../src/index.ts:315`）。
- 菜单渲染与分区：`@deepseek-ai/dsh-client-ui-commands` `presentation.ts:61`（`builtinRowFace`）、`SECTION_ROWS`（`presentation.ts:19-23`）。
- 技能作为 `/` 候选：上游 input-trigger 的候选源合并（29 行内的 skills 行）。
- `permission` 菜单滤除：本仓 `packages/access/src/pages.ts:362-379`（注释已说明「上游无条件注册，客户端菜单重写滤除；直接键入仍可执行」）。

## 证据

- `cmd.log`（本目录）
- `browser-assertions.json`（12 项 PASS / 0 FAIL 的原始断言）
- `slash-menu.png`
- 主机目录现场：`../RC5-CMD-002/probe.stdout.log`