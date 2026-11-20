# RC5-CMD-001 · 输入 / 显示命令列表

- 套件：CMD
- 结论：**PASS**
- 开始/结束：2026-11-19T23:18:14.263Z / 2026-11-19T23:18:14.263Z

## 预期

命令列表可见；rc.5 现有命令齐全

## 实际

12 条候选（7 个内置命令 + 5 个技能），内置命令 file/goal/plan/feedback/compact/model/export 齐全，无重复

## 备注

- 技能建议（dsh-doc/office*）也走同一触发面，属宿主行为

## 证据附件

- `RC5-CMD-001-light-1440.png`

## 执行命令

```
$ IAB 1440×900: 活动会话 composer.focus() → execCommand("insertText","/") → 读 [role="option"] 列表  # EXIT=0
```
