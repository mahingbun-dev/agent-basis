# RC5-BOOT-003 · E4 ACP 容器启动（进程存活、stdio 纯净）

- 套件：BOOT
- 结论：**PASS**
- 开始/结束：2026-11-19T22:43:52.377Z / 2026-11-19T22:43:54.963Z

## 预期

initialize 协议协商成功；stdout 仅 JSON-RPC；无监听端口

## 实际

ACP-001=PASS ACP-003=PASS ACP-004=PASS

## 备注

- 本用例借用 P4 lane 的 ACP 探针（scripts/verify-acp-stdio.mjs），但项目/数据根指向本 lane 的 rc5-e1suite

## 证据附件

- `acp-report.json`
- `cmd.log`

## 执行命令

```
$ node scripts/verify-acp-stdio.mjs --project rc5-e1suite --env-file …/.env.e1suite --timeout-ms 60000 --json <case>/acp-report.json  # EXIT=0
```
