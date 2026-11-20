# RC5-MCPP-006 · B 从管理员目录新建 echo（serverName 按 uid 隔离）

- 套件：MCPP
- 结论：**PASS**
- 开始/结束：2026-11-20T07:05:03.524Z / 2026-11-20T07:05:03.524Z

## 预期

按 51 §3.6

## 实际

serverName=p2_echo-b expected=p2_echo-b transport=stdio

## 备注

- 本行结果由 scripts/verify-mcp-personal.mjs（51 §4 指定脚本）在同一次执行中产出；命令见上

## 证据附件

- `cmd.log`

## 执行命令

```
$ node scripts/verify-mcp-personal.mjs --base http://127.0.0.1:3119 --accounts-file <0600> --data-root <E2 数据根> --container rc5-e2suite --json artifacts/rc5/E2/MCPP/report.json --full --restart  # EXIT=0
```
