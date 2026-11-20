# RC5-TERM-005c · B 用 A 的 session 开 terminal/watch 流必须被拒

- 套件：TERM
- 结论：**PASS**
- 开始/结束：2026-11-20T00:39:25.608Z / 2026-11-20T00:39:26.017Z

## 预期

流被拒绝；无数据泄漏

## 实际

denied code=remote-access/denied message=remote access: terminal/watch: access denied (no-allow)

## 备注

- 由 /api/remote.mux 真实 WS 流打开帧验证（非静态清单核对）

## 证据附件

- `cmd.log`

## 执行命令

```
$ WS /api/remote.mux open terminal/watch {agentId:A.sessionId}（B）  # EXIT=0
```
