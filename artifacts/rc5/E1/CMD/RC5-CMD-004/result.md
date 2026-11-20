# RC5-CMD-004 · ACP 无命令面（无 UI 面）

- 套件：CMD
- 结论：**PASS**
- 开始/结束：2026-11-19T23:18:14.264Z / 2026-11-19T23:18:16.737Z

## 预期

命令面按设计不出现在 ACP（无 UI 面）

## 实际

ACP profile bundles=dsh-base + dsh-acp-app（无任何 client-ui 包）；ACP stdio initialize/无端口/stdout 纯 JSON-RPC 均 PASS；不存在 slash 命令 UI 面

## 备注

- ACP 的 Web 命令面缺席是设计结果（docs/design/54 §4.6 / 47 B17），非缺陷

## 证据附件

- `acp-report.json`
- `cmd.log`

## 执行命令

```
$ cat docker/profile/package.acp.json（dsh.profile.bundles）  # EXIT=0
$ node scripts/verify-acp-stdio.mjs --project rc5-e1suite --env-file <0600 env> --timeout-ms 90000 --json <case>/acp-report.json  # EXIT=0
```
