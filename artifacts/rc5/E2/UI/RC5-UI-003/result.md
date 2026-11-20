# RC5-UI-003 · font-weight 只有 400/500/600；正文无 500

- 套件：UI
- 结论：**PASS**
- 开始/结束：2026-11-19T23:57:41.855Z / 2026-11-19T23:57:41.910Z

## 预期

新增 UI 无规范外字重

## 实际

UI-003 failures=0

## 备注

- 扫描器与 E0 静态 lane 同源（复制进本 lane），scope=feat/dsh-rc5-merge 新增/改动的 17 个 UI 文件

## 证据附件

- `cmd.log`

## 执行命令

```
$ node artifacts/rc5/E2/UI/_suite/ui-scan.mjs UI-003  # EXIT=0
```
