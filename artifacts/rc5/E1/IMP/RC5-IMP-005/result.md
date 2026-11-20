# RC5-IMP-005 · 导入会话属主记账（含异步收敛）

- 套件：IMP
- 结论：**PASS**
- 开始/结束：2026-11-19T23:26:27.456Z / 2026-11-19T23:26:27.456Z

## 预期

10 行 owner_id=B；无空属主

## 实际

上传响应后约 2.4s（t=2839ms）sessions 表出现 10/10 行 owner=2；无空属主。脚本即时读取（<400ms）会看到 0 行

## 备注

- P2 观察：chat-import 的记账挂在响应流 pass-through 上，outcome 行解析/写入晚于响应结束（packages/access/src/chat-import.ts:1-36/300-370）
- 失败/取消对账仍以 workspaceRegistry 为准（同文件 §2.3），故窗口期 fail-closed 不产生越权；建议后续把 whenIdle() 接到响应结束前

## 证据附件

- `IMP-report.json`
- `cmd.log`

## 执行命令

```
$ scripts/verify-chat-import.mjs（IMP-005 行，上传响应后立即读）  # EXIT=1
$ 同会话复测：再上传 10 会话 → 每 200ms 轮询 access users.db sessions 表  # EXIT=0
```
