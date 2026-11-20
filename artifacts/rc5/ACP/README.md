# E4 · ACP 全组（RC5-ACP-001..010）

> 依据：`docs/design/51-上游rc.5合并测试用例与回归.md` §3.9 / §4（10 用例）；
> `docs/design/54-rc.5开发与测试验收完整workflow.md` §6.1（E4 ACP stdio：
> `docker compose run -T`；无端口）。
> 执行日期：2026-11-20。工作树：`/Users/sunny/code/agent-basis-rc5`（`feat/dsh-rc5-merge`）。

## 1. 结论

| 用例 | 优先级 | 结果 | 关键证据 |
|---|---|---|---|
| RC5-ACP-001 initialize 握手 | P0 | **PASS** | `protocolVersion=1`、`agent=deepseek-harness-acp`、`mcpHttp=true` |
| RC5-ACP-002 session/new + prompt | P0 | **PASS**（协议面；见 §4 局限） | `stopReason=end_turn`，78–159ms |
| RC5-ACP-003 stdout 纯 JSON-RPC | P0 | **PASS** | 18 行全为 `jsonrpc:2.0`；nonJsonRpc=0、parseErrors=0 |
| RC5-ACP-004 无监听端口 | P0 | **PASS** | host binding=0、`docker port` 空、容器内应用 LISTEN=0 |
| RC5-ACP-005 非法 JSON | P0 | **PASS** | `error.code=-32700`，随后 initialize 仍可用 |
| RC5-ACP-006 工具审批 | P0 | **PASS** | 收到 `session/request_permission`（allow-once/reject-once），应答后 `end_turn`，209ms |
| RC5-ACP-007 取消 prompt | P0 | **PASS** | `stopReason=cancelled`，cancel→响应 15ms，假模型侧 `aborted=true`，后续请求可用 |
| RC5-ACP-008 两客户端并发 | P1 | **PASS** | 两会话 id 不同、无串话、无 `database is locked`、双容器 exit 0 |
| RC5-ACP-009 文档定位 | P1 | **PASS** | 4 条口径全部命中文档（见 `RC5-ACP-009/citations.md`） |
| RC5-ACP-010 web + ACP 同卷 | P1 | **PASS** | web `session/create`+`session/list` ok、ACP prompt `end_turn`、两端无 `database is locked` |

驱动原始输出：`runs/all/run.log`，`[ACP] PASS=11 FAIL=0 SKIP=0 NOTRUN=0`；
汇总 JSON：`report.json`。

## 2. 驱动方式（命令原文见各用例 `cmd.log`）

```bash
cd /Users/sunny/code/agent-basis-rc5
node artifacts/rc5/ACP/acp-e4-driver.mjs --scenario all
```

底层每条连接都是：

```bash
docker compose -p <project> --env-file <env> \
  -f /Users/sunny/code/agent-basis-rc5/docker-compose.yml \
  -f artifacts/rc5/ACP/fixture/compose.acp-fixture.yml \
  --profile acp run --rm -T --no-deps eterna-agent-acp
```

- `stdin_open: true` / `tty: false`（`docker compose config` 实测）；
- 无 `ports`，容器内无应用 LISTEN（Docker 内嵌 DNS `127.0.0.11:53` 属基础设施，已单列）；
- stdout 按 NDJSON 逐行解析；stderr 只作诊断面，不计入纯净性。

另跑了仓库既有脚本做交叉验证（标准 ACP 模板 + `.env.e4` 占位凭据）：

```bash
node scripts/verify-acp-stdio.mjs --env-file /Users/sunny/eterna-data/test-rc5/.env.e4 \
  --project rc5-test-e4 --json artifacts/rc5/ACP/runs/std-e4/report.json
# EXIT=0；PASS=6 FAIL=0 NOTRUN=1（RC5-ACP-002b prompt 因占位 key 401）
```

证据：`runs/std-e4/{cmd.log,run.log,report.json}`。

## 3. 夹具（仅测试用，不入镜像、不入主 compose）

E4 测试 env 的 `MIMO_API_KEY` 是无效占位值（上一轮 401 实测），002/006/007/008/010
的 prompt 路径无法用真模型走通。因此本 lane 增加本地假模型，其余保持生产模板原样：

| 文件 | 作用 |
|---|---|
| `fixture/fake-model-server.mjs` | 宿主机 `127.0.0.1:18080` 的 OpenAI chat-completions SSE 假模型；按 prompt 标记回放文本 / `tool_call(bash)` / 慢流 |
| `fixture/cordis.acp.fixture.yml.template` | 仓库 ACP 模板逐字拷贝，仅把 `llm-pi-ai` 的 `baseURL`/`apiKeyEnv` 改指假模型 |
| `fixture/compose.acp-fixture.yml` | 只替换模板挂载 + `extra_hosts`；不动 ports/profile 结构 |
| `fixture/env.e4-fixture*` / `env.e1-acp` | 测试数据根与容器名；`MIMO_API_KEY` 为**非凭据占位串**（entrypoint 要求非空） |

`host.docker.internal:18080` 可达性已实测（`REACHED: ok`）。
ACP-006 的审批由测试数据根上的 governance 规则显式 `effect: ask`（`argsContains:
acp-permission-ok`）触发；生产模板仍为 `default: allow`。

## 4. 局限（必须在验收签字时知悉）

1. **模型面是假模型**：002/006/007/008/010 的模型推理来自本地 fixture，不是 MiMo/
   DeepSeek 真实推理。协议帧、审批往返、取消语义、端口/纯净性均为真实 dsh ACP 行为；
   但「真实模型凭据下 prompt 正常返回」仍为 **NOTRUN**（标准模板 + `.env.e4` 实测 401）。
2. **ACP-010 的 web 轮是 RPC 轮**：登录 + `session/create` + `session/list`（写 SQLite），
   不是聊天轮（E1 同样无有效模型 key）。验证目标是同卷并发写入与 profile 渲染互斥，
   该目标已达成。
3. ACP-009 是文档检查，不是运行时检查。
4. **ACP-010 的「profile 渲染竞争」只覆盖到热路径**：E1 web 已在运行（重启它会打断
   并行 lane 的测试），所以 ACP 是对着已存在的 `eterna-acp` profile 走 hash-keep
   （`stderr` 实测 `profile 渲染:模板未变,保留用户文件`），并非 web+ACP 同时冷启动
   首渲染。两端并发写入、无 `database is locked`、无渲染报错已实测；冷启动 flock
   竞争未单独制造（`entrypoint` 的 flock 设计见 `docker/entrypoint.sh` §2）。
5. ACP 模板与 profile 的 `eterna-acp` 在本 lane 的测试数据根上被 fixture 模板渲染过；
   后续用标准模板启动时，entrypoint 的模板哈希门控会自动重渲染（`profile 渲染:
   模板变更…`），不会残留。E1 数据根上的 `profiles/eterna-acp` 同理。

## 5. 目录

```
artifacts/rc5/ACP/
  README.md                 本文件
  report.json               all 场景汇总（11 条，含 INFO 的 EXIT 行）
  acp-e4-driver.mjs         驱动（protocol/concurrency/docs/shared-volume/all）
  fixture/                  假模型 + 模板/override/env（无真实凭据）
  runs/
    all/{cmd.log,run.log}   全组一次跑的命令原文与 EXIT
    std-e4/                 仓库既有 verify-acp-stdio.mjs 交叉验证
    protocol/fake-model.log 假模型请求/中断记录
    concurrency/
    shared-volume/
  RC5-ACP-001/ .. RC5-ACP-010/
    cmd.log                 该容器连接的命令原文 + 容器 EXIT
    assert.json             用例状态 + 逐条断言（expected/observed/ok）
    stdout.ndjson           该连接 stdout 全量帧（已脱敏）
    stderr.log              容器 stderr 诊断面（已脱敏）
    extra.json              原始响应/权限请求/模型日志摘要等
```

脱敏口径：cookie/token/password/API key 一律 `<redacted>`；web 容器日志只摘录
`database is locked` 匹配行（本次为 0 行），不落整段日志。