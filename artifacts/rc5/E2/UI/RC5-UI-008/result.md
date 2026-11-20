# RC5-UI-008 · z-index 只允许 1/40/100/200/1000/1100/1500（hero -1 例外）

- 套件：UI
- 结论：**PASS**
- 开始/结束：2026-11-19T23:57:42.077Z / 2026-11-19T23:57:42.134Z

## 预期

0 处越界；决策/toast/通知不同区

## 实际

UI-008 failures=0

## 备注

- 扫描器与 E0 静态 lane 同源（复制进本 lane），scope=feat/dsh-rc5-merge 新增/改动的 17 个 UI 文件

## 证据附件

- `cmd.log`

## 执行命令

```
$ node artifacts/rc5/E2/UI/_suite/ui-scan.mjs UI-008  # EXIT=0
```
