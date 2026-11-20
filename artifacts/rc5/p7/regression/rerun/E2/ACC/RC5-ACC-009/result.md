# RC5-ACC-009 · chat-import 路由经 access 门；未登录 401

- 套件：ACC
- 结论：**PASS**
- 开始/结束：2026-11-20T01:36:13.009Z / 2026-11-20T01:36:13.016Z

## 预期

无 cookie → 401；登录用户不被 access 门拦截

## 实际

未登录=401；登录=400

## 备注

- 空归档用于验证门而非导入语义；写操作仅测试账号自己的 workspace

## 证据附件

- `cmd.log`

## 执行命令

```
$ POST /api/deepseek-chat-import/archive（无 cookie）  # EXIT=401
$ POST /api/deepseek-chat-import/archive（B 登录 + 自己的 workspaceId + 空归档）  # EXIT=400
```
