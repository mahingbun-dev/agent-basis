# tests/fixtures —— rc.5 测试夹具（T47；51 §1 / 54 §6.2）

**夹具一律不进镜像。** 运行方式只有两种：

1. 测试容器下只读挂载：`-v <repo>/tests/fixtures:/fixtures:ro`（`artifacts/rc5/p5/testbed/compose.e1.override.yml`）；
2. 已启动容器内 `docker cp tests/fixtures <container>:/fixtures`（仅测试环境）。

> 现状：仓库 `.dockerignore` 未排除 `tests/`，若从当前工作树重建镜像，`COPY . .`
> 会把夹具带入 `/repo/tests/fixtures`。本轮 `eterna-agent:rc5-test` 由已构建镜像
> （`rc5-p5-repair`，构建上下文早于夹具落地）打 tag，镜像内不含夹具；长期需在
> `.dockerignore` 加 `tests/`（不在本 lane 写权限内，见 result.md 遗留项）。

| 路径 | 内容 | 用途 |
|---|---|---|
| `mcp-echo-server.mjs` | MCP stdio JSON-RPC 服务器（`echo` 工具） | MCPP-005/006/007；个人层 catalog 项 |
| `mcp-http-server.mjs` | 本地 HTTP MCP（默认可变端口 `/mcp`） | MCPP-007；HTTP 传输 |
| `mcp-fixture-core.mjs` | 两版 MCP 共用协议核心 | 避免 stdio/HTTP 漂移 |
| `chat-import/generate.mjs` | 生成 rc.5 归档 **zip**（11 会话：10 可用 + 1 坏 JSON；conv-10 约 6MB） | IMP-003/009 |
| `chat-import/deepseek-export-11.zip` | 生成产物（真实上传格式：`manifest.json` + `chat_session_index.json` + `chat_sessions/*.json`） | IMP-003/004/005/009 |
| `chat-import/sessions-10.ndjson` | 51 §1 字面夹具：10 会话 NDJSON + 1 行坏 JSON（非上传格式，负向/解析用） | 解析健壮性 |
| `office/sample.docx` | 中文标题/正文/表格 | OFF-001 |
| `office/sample.xlsx` | 中文表头/数值/公式 `=SUM` | OFF-002 |
| `office/sample.pptx` | 两页中文版式 | OFF-003 |
| `office/generate.py` | 三格式样本生成器（python-docx/openpyxl/python-pptx） | 复现 |
| `long-process.sh` | 5s 心跳长进程（SIGTERM 干净退出） | TERM-009/013 |

## 关于 chat-import 归档格式（重要）

51 §1 写的是「10 会话 NDJSON」，但 rc.5 上游实现
`@deepseek-ai/dsh-deepseek-chat-import@0.2.2-rc.5` 的 `POST /api/deepseek-chat-import/archive`
接收的是 **DeepSeek chat export v3 的 zip**（`manifest.json` 的
`export_format_version` 必须为 3；`chat_session_index.json` 排序；`chat_sessions/{id}.json`
会话文件）。NDJSON 只出现在**响应**（`application/x-ndjson` 进度行 + 终态 outcome）。
`deepseek-export-11.zip` 才是 IMP-003 等用例可上传的夹具；`sessions-10.ndjson` 保留
作 51 字面要求的解析/负向样本，直接上传会被判 `unreadable-archive`。

## 生成与复现

```bash
node tests/fixtures/chat-import/generate.mjs        # 无第三方依赖（内置 zip 写入）
python3 -m pip install python-docx openpyxl python-pptx
python3 tests/fixtures/office/generate.py          # 产物已入库，通常无需重跑
```

MCP 夹具自检（不联网）：

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | node tests/fixtures/mcp-echo-server.mjs
node tests/fixtures/mcp-http-server.mjs --port 8765 &   # GET /health 或 POST /mcp
```