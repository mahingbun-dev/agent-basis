# RC5-TERM-006 · A 对同 session 调 9 个 terminal 动作全部成功、语义正确（attach 除外，见备注，共 8 项断言）

- 套件：TERM
- 结论：**FAIL**
- 开始/结束：2026-11-20T01:38:52.904Z / 2026-11-20T01:38:53.804Z

## 预期

9/9 成功（attach 由浏览器 Remote invocation 形态承载）

## 实际

失败=create,rename,retain；create=gateway/internal/session.snapshotEvents is not a function；rename=terminal/unavailable/Terminal no longer exists in this Session

## 备注

- create 失败码 gateway/internal `session.snapshotEvents is not a function`，与 E1 同根因（P1）；不是租户泄漏
- rename/retain 因 create 失败而报 terminal/unavailable（无终端可改名/保留）
- 断言明细见 cmd.log（8 条 [ASSERT]）

## 证据附件

- `cmd.log`

## 执行命令

```
$ POST /api/terminal/list（A）  # EXIT=200
$ POST /api/terminal/environment（A）  # EXIT=200
$ POST /api/terminal/shells（A）  # EXIT=200
$ POST /api/terminal/create（A）  # EXIT=200
$ POST /api/terminal/close（A）  # EXIT=200
$ POST /api/terminal/rename（A）  # EXIT=200
$ WS /api/remote.mux open terminal/retain（A）  # EXIT=0
$ WS /api/remote.mux open terminal/watch（A）  # EXIT=0
```
