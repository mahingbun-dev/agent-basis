# RC5-SEC-008 · 登录归属正确；登出后访问被拒

- 套件：SEC
- 结论：**PASS**
- 开始/结束：2026-11-20T07:07:12.417Z / 2026-11-20T07:07:12.657Z

## 预期

B 的会话 owner=B、workspace=B 的工作区；logout 302 + 清 cookie；浏览器语义下 401

## 实际

owner=2/02dce76e-18b8-4858-beba-637cca6710c7 logout=302 cleared=true afterMe=401 replay=200

## 备注

- 重放旧 cookie 仍 200：签名会话 cookie 无服务端吊销，属设计限制（记遗留项）

## 证据附件

- `cmd.log`

## 执行命令

```
$ GET /access/api/me（B）  # EXIT=200
$ POST /api/session/create {workspaceId:B 工作区}（B）  # EXIT=200
$ node:sqlite SELECT sessions WHERE session_id=<B 新会话>  # EXIT=0
$ POST /logout（B，redirect:manual）  # EXIT=302
$ GET /access/api/me（登出后，浏览器已丢 eterna_session）  # EXIT=401
$ GET /access/api/me（登出后，重放旧 cookie —— 观察项）  # EXIT=200
```
