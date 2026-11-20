# RC5-MCPP-024 · 个人 MCP UI 增删改（密钥 write-only / 两击删除 / 双主题三视口）

- 套件：MCPP
- 结论：**PASS**
- 开始/结束：2026-11-20T06:05:48.402Z / 2026-11-20T06:06:11.743Z

## 预期

新增可保存并显示已设置；密钥不回显、留空保持；测试成功；两击删除无原生 confirm；6 张截图

## 实际

saved=true secretInDom=false keep=true probe=true shots=6 armed=true/1 deleted=true nativeDialogs=0 remaining=0

## 备注

- lane=rc5-e2suite（独立测试容器，未触碰生产）；HTTP 夹具=host:18693
- 密钥只以密文落库；UI 只读 hasSecret，编辑时输入框为空 + placeholder=留空保持不变（留空保存不改值）
- 删除走 ArmedDelete（两击），页面 dialog 事件计数=0，证明未调用原生 confirm()
- 截图 dark-1440x900.png
- 截图 dark-900x900.png
- 截图 dark-390x844.png
- 截图 light-1440x900.png
- 截图 light-900x900.png
- 截图 light-390x844.png

## 证据附件

- `cmd.log`
- `dark-1440x900.png`
- `dark-900x900.png`
- `dark-390x844.png`
- `light-1440x900.png`
- `light-900x900.png`
- `light-390x844.png`

## 执行命令

```
$ POST /api/mcp-personal/catalog（B，前置白名单）  # EXIT=200
$ node tests/fixtures/mcp-http-server.mjs --port 18693 --host 0.0.0.0  # EXIT=0
$ 浏览器：登录 B → 设置 → MCP 服务器  # EXIT=200
$ UI 新增 ui-http（HTTP + Authorization 密钥）→ 保存  # EXIT=200
$ UI 编辑（密钥留空）→ 保存  # EXIT=200
$ UI 测试连接（echo 夹具）  # EXIT=200
$ 截图：深/浅（colorScheme）× 1440/900/390  # EXIT=0
$ UI 删除（两击）  # EXIT=200
$ POST /api/mcp-personal/list（UI 删除后）  # EXIT=200
```
