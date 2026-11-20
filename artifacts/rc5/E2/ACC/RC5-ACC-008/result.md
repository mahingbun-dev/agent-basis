# RC5-ACC-008 · B 用 A 的 workspaceId/sessionId 打文件/检索必须 403/deny

- 套件：ACC
- 结论：**PASS**
- 开始/结束：2026-11-20T07:05:48.324Z / 2026-11-20T07:05:48.435Z

## 预期

workspace 系与文件/检索全部 403/deny；读不到 A 的文件内容

## 实际

拒绝=7/7；未拒=无；A 文件内容泄漏=false

## 备注

- workspaceFiles/* unary 不在 tenant.ts 守卫清单（grep 无 workspaceFiles），走 owner Peer，与 TERM-004 同根因

## 证据附件

- `cmd.log`

## 执行命令

```
$ POST /api/session/create（B 使用 A 的 workspace/session）  # EXIT=200
$ POST /api/workspace/delete（B 使用 A 的 workspace/session）  # EXIT=200
$ POST /api/directoryPicker/list（B 使用 A 的 workspace/session）  # EXIT=200
$ POST /api/session/search（B 使用 A 的 workspace/session）  # EXIT=200
$ POST /api/workspaceFiles/list（B 使用 A 的 workspace/session）  # EXIT=200
$ POST /api/workspaceFiles/stat（B 使用 A 的 workspace/session）  # EXIT=200
$ POST /api/workspaceFiles/read（B 使用 A 的 workspace/session）  # EXIT=200
$ POST /api/session/create（B 自己的 workspaceId，正向控制）  # EXIT=200
```
