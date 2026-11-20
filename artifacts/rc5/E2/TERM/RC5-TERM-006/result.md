# RC5-TERM-006 · A 对同 session 调 9 个 terminal 动作全部成功、语义正确

- 套件：TERM
- 结论：**PASS**
- 开始/结束：2026-11-20T07:05:51.673Z / 2026-11-20T07:05:53.983Z

## 预期

9/9 成功（environment/shells/list/create/close/rename + attach/retain/watch 三个流）

## 实际

9/9 已断言动作成功

## 备注

- create 走 rc.5 terminal-bash 后端（spawn 内用真实 session 解析沙箱策略，PTY argv 已 confine）
- 顺序=create → rename → attach/retain/watch → close（close 最后，避免「终端已销毁」假红）
- 断言明细见 cmd.log（9 条 [ASSERT]）

## 证据附件

- `cmd.log`

## 执行命令

```
$ POST /api/terminal/list（A）  # EXIT=200
$ POST /api/terminal/environment（A）  # EXIT=200
$ POST /api/terminal/shells（A）  # EXIT=200
$ POST /api/terminal/create（A）  # EXIT=200
$ POST /api/terminal/rename（A）  # EXIT=200
$ WS /api/remote.mux open terminal/attach（A）  # EXIT=0
$ WS /api/remote.mux open terminal/retain（A）  # EXIT=0
$ WS /api/remote.mux open terminal/watch（A）  # EXIT=0
$ POST /api/terminal/close（A，最后关闭）  # EXIT=200
```
