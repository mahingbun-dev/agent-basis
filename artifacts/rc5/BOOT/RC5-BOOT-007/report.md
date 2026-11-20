# RC5-BOOT-007 — preset 全量替换后仍保留 rc.5 默认、无丢行（local PASS）

- 方式：S（真 boot）｜形态：web + super
- 结论：**PASS（本地双 boot 覆盖）**

## 断言

```
PASS  BOOT-007 preset-standard restatement retains rc.5 default rows — 30 declared rows all present (disabled flags honored)
```

## 方法

模板对 `preset-standard` 做**整份 config 重述**（官方 Web 编辑器同机制）。verify 脚本
在 boot 前用 yaml 解析模板的 `preset-standard.config.plugins`，递归展开 group 行得到
扁平行集（30 行），再与活体 `pluginInventory/list` 的 `agentPresets[standard].rows` 比对：

- 每个声明行必须 present（无丢行）；
- `disabled: true` 的声明行在活体必须 disabled；
- 未声明 disabled 的行必须 `enabled=true` 且 `fiberPhase=active`。

## 结果

```
web:   declared=30 live=30 missing=0 drift=0
super: declared=30 live=30 missing=0 drift=0
```

30 行：persona, agent-instructions, time-context, tool-bash, tool-pwsh, tool-fs,
tool-fs-search, tool-jobs, tool-schedule, skill-filesystem, tool-skill, command-goal,
tool-goal, plan-mode, stale-tool-result-pruner, compaction-basic, command-compact,
tool-result-pruner, tool-subagent-control, tool-subagent, tool-subagent-fork,
workflow-ptc, tool-workflow, tool-ask-user, tool-todo, tool-web, present, tool-office,
tool-plugin-manager, tool-plugin-market。

`disabled: true` 的 4 行（workflow-ptc / tool-workflow / tool-plugin-manager /
tool-plugin-market）在活体均为 disabled，符合声明。

## 证据

- `evidence.txt`（命令、断言、两边 declared/live/missing/drift、行 id 清单）
- `artifacts/rc5/p2/t11-slot-drift/{web,super}/preset-standard.json`
- `artifacts/rc5/p2/t11-slot-drift/{web,super}/inventory.json`

边界：本断言证明「模板重述 == 活体组合」且无丢行；模板重述本身是否等于上游
rc.5 默认由 T10/form-check 静态看护，不在本用例重复。`tool-pwsh` 等 `!!js`
条件行按「存在」判，不把平台表达式结果当失败。