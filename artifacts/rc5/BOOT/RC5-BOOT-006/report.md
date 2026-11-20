# RC5-BOOT-006 — rc.5 新增行全在（local PASS）

- 方式：S（真 boot）｜形态：web + super
- 结论：**PASS（本地双 boot 覆盖）** — 9 行全部 present + enabled + active

## 断言

```
PASS  BOOT-006 rc.5 new rows present+active (9) — agent-team, tool-agent-team, ui-agent-team,
      ui-file-actions, ui-context-menu, mcp-manager, office-kit, skill-office, deepseek-chat-import
```

## 活体快照（两形态一致）

```
agent-team             true/active
tool-agent-team        true/active
ui-agent-team          true/active
ui-file-actions        true/active
ui-context-menu        true/active
mcp-manager            true/active
office-kit             true/active
skill-office           true/active
deepseek-chat-import   true/active
```

## 证据

- `evidence.txt`（命令 + 断言 + 上述逐行状态）
- `artifacts/rc5/p2/t11-slot-drift/{web,super}/inventory.json`
- 双 boot 日志：`artifacts/rc5/p2/t11-slot-drift/{web,super}-boot.stdout.log`

判据落在活体 `pluginInventory/list`（fiberPhase），不是模板文本。