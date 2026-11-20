# RC5-CMD-003 · 与既有 slash 命令并存、无重复注册

**结论：PASS（默认 `standard` 路径：每个激活预设内 `/compact` 恰一条注册；无重名）**
**遗留 P2：可选预设 `minimal` 仍挂上游 `/compact` + 上游 compaction-basic，未走本仓当前压缩实现。**

## 一、渲染树证据（本次实跑 `--dump-config`）

| 位置 | 行 | 事实 |
|---|---|---|
| 宿主行 | `dump-config.log:575-577` | `@deepseek-ai/dsh-command-compact` **disabled: true**（由上游 `dsh-web-app/cordis.patch.yml:579-580` 统一禁宿主行） |
| preset-standard | `dump-config.log:1153-1154` | `@eterna/compaction/command-plugin`（源 `profiles/eterna-web/cordis.patch.yml:448-449`） |
| preset-cordis | `dump-config.log:1623-1624` | `@eterna/compaction/command-plugin`（源 `profiles/eterna-web/cordis.patch.yml:267-268`） |
| preset-ptc | `dump-config.log:1388` | `disabled: true`（源 `profiles/eterna-web/cordis.patch.yml:164-165`）；其内上游 compact 行 `1327-1328` 不激活 |
| preset-minimal | `dump-config.log:1416-1418` | 上游 `dsh-compaction-basic` + `dsh-command-compact`（**存活**，see 遗留） |

上游 `dsh-base/cordis.patch.yml:360-361` 确实插入过宿主 `@deepseek-ai/dsh-command-compact`，
但 web 形态的 web-app 补丁把它禁掉、改由预设挂载 —— 因此**同一层不会出现两个 `compact`**。

## 二、活体与单测

- 活体 `commands.list(agent)`：6 条命令，`duplicateNames: []`；`presetRoster: [standard(默认), minimal, cordis]`（`probe.stdout.log`）。
- 注册表对同层重名是硬拒绝：`dsh-commands/src/index.ts:94-104` 的 `NamedEntries` 抛
  `command "compact" is already registered`；新增用例已覆盖（`../T39-UNIT/vitest.log`）。
- 浏览器菜单 `compact` / `model` 各恰好 1 行（`../RC5-CMD-001/browser-assertions.json`）。

## 遗留

| id | 现象 | 级别 | 建议 |
|---|---|---|---|
| CMD-PRESET-MINIMAL | 预设选择器含 `minimal`（order 3，活体 roster 可见）；该预设 compaction 组仍为上游 `dsh-compaction-basic` + `dsh-command-compact`，`/compact` 不经过本仓 `@eterna/compaction` 实现（无本地化/设置分区/告警链路） | P2（非默认预设） | 在 web/super 两档 profile 与 docker 模板里像 standard/cordis 一样整份重述/覆写 `preset-minimal` 的 compaction 组为 `@eterna/compaction/{basic-plugin,command-plugin}`，或按产品口径禁用 `preset-minimal`；属 profile 配置面，不在 T39 可改范围，留给 W5 |

## 证据

`dump-config.log`、`dump-config.command-compact.grep.log`、`dump-config.preset-minimal.log`、`probe.stdout.log`、`../T39-UNIT/vitest.log`