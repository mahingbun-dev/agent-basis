# @basis/evals —— dsh-evals 评测 runner(独立 CLI)

> T4 交付物(设计文档 08 §3-4 / 12 §8.1:承载方式 **B'** 独立 CLI,不进 agent 进程,避免污染被测会话)。
> golden case 规范对齐 ai-evo(12 §8.3:S 文件约定,字段对齐 ai-evo);会话事件形态对齐 DSH
> `SessionEvent`(dsh-repo packages/core/session/src/types.ts:504-518),seam 由
> `tests/types.seam-pin.ts` 用已发布 `@deepseek-ai/dsh-* 0.2.2-alpha.2` 类型编译期钉住。

## 目录约定(pack)

```
<pack>/
  evals/*.yaml            # golden case,一文件一 case(平铺形态)
  evals/golden/*.yaml     # 同上(packctl 06 号模板形态,T6 packs/event-planning 起;两种形态二选一或并存)
  evals/threshold.yml     # packctl 模板的门禁阈值配置 —— 已知非 case 文件,加载时跳过
  fixtures/<case-id>.jsonl # replay 适配器的会话 fixture(DSH SessionEvent 每行一个)
```

## golden case 字段(对齐 ai-evo)

| 字段 | 说明 |
|---|---|
| `id` | `[a-z0-9][a-z0-9_-]*`,pack 内唯一 |
| `user_input` | 必填,发给 agent 的任务输入 |
| `answer` | 可选;`{contains}` 子串或 `{match}` 正则(+`ignore_case`)。本地 runner 无裁判模型,确定性匹配;LLM 裁判属 ai-evo 平台侧 |
| `tags` | 标签数组;`--subset <tag>` 按 it 过滤(如 `smoke`) |
| `final_state` | 终态断言数组,顺序执行,全过才过。三种条目:`{file_assert}` / `{http_assert}` / `{script}` |
| `trajectory` | 轨迹断言:`mode`(四模式)+ `calls` + `must_call` / `must_not_call` / `max_steps` / `approval_flow` |
| `budget` | `{max_turns}` / `{max_tokens}`(token 口径 = totalTokens ?? input+output+cacheRead+cacheWrite) |
| `adapter` | `replay`(缺省)/ `acp` |

### 轨迹四模式(对齐 ai-evo 轨迹校验器)

| mode | 语义 |
|---|---|
| `strict` | 实际调用序列与 `calls` 完全一致(顺序+次数) |
| `unordered` | 与 `calls` 多重集相等,顺序任意 |
| `subset` | `calls` 是实际的多重集子集(agent 允许多做);缺省 |
| `superset` | 实际是 `calls` 的多重集子集(agent 不得越出清单) |

### 审批红线(approval_flow)

```yaml
trajectory:
  must_not_call: [mass_email]          # 禁用工具连请求都不许发
  approval_flow:
    tool: send_group_message           # 期望该工具触发过 approval/asked
    outcome: rejected                  # 且存在按 id 配对的 approval/decided 结局
    not_executed: true                 # 且被拒的调用没有成功执行(DSH:被拒调用仍记
                                       # tool/call,其 tool/result 带 error——按 callId 判)
    min_count: 1
```

### 终态断言

- `file_assert: {path, exists?, contains?, not_contains?}`——查 case 工作区文件(replay 模式下由 fixture 的 `plugin:basis-evals/workspace` 记录物化);
- `http_assert: {request, respond, assert}`——**http 用 mock**:先从会话 `tool/call` 证据确认 agent 发过该请求(method/path/body),再把请求重定向到本地 mock(127.0.0.1 随机端口)真实往返(node:http),断言响应 status/body。全程不出外网;
- `script: {command, stdout_contains?}`——在 case 工作区 `/bin/sh -c` 执行,exit 0 即过。

## 适配器(AgentAdapter,注册表 + 唯一 id)

| id | 实现 | 说明 |
|---|---|---|
| `replay` | `src/adapters/replay.ts` | 读 fixture jsonl 回放:事件 → 断言;`plugin:basis-evals/workspace` 记录物化终态文件 |
| `acp` | `src/adapters/acp.ts` + `python/dsh_eval_driver.py` | 经 DSH Python SDK(`deepseek-harness-sdk`)驱动真实 session;NDJSON 协议回传事件。2026-11-04 真跑打通(docs/acp-real-6/):pip -e dsh-repo/python/sdk + DSH_HOME 隔离宿主(~/.dsh-evals,sdk profile 走 litellm)+ LITELLM_API_KEY。通知→事件映射双侧同口径容忍真实包裹层级(SDK `Notification` dataclass 的 `session.event`→`payload.event`;`params.sessionEvents` 批;无事件载荷 method 落 ignorable),由**真实样本回放**单测钉住:`python/test_event_mapper.py`(unittest)+ `tests/acp-real-notification.spec.ts`(vitest),样本 `docs/acp-real-6/notifications-sample.jsonl` 由 `scripts/sample-notifications.mjs` 采集;6 条真实会话日志的重放验证:`scripts/replay-acp-real-notifications.mjs`(turns=0 清零) |

## CLI

```sh
pnpm --filter @basis/evals exec node bin/dsh-evals.mjs run --pack <目录> --subset smoke
```

```
dsh-evals run --pack <目录> [--subset smoke] [--case <id>] [--adapter replay|acp]
              [--out <目录>] [--provider] [--model] [--dsh-home]
              [--python <解释器>] [--driver <脚本>]
```

退出码:`0` 全过;`1` 有失败;`2` 用法错误或无 case 可跑(schema 坏文件只打印 `SCHEMA-FAIL`,不拖垮 subset 运行)。产物(默认 `./dsh-evals-out/<时间戳>/`):

- `report.md` —— 通过率 / 分 tags 统计 / 失败原因分类(schema/answer/final_state/trajectory/budget/harness)/ 用例明细;
- `sessions.jsonl` —— 一行一 case,字段对齐 ai-evo 会话数据集(user_input/answer/tags + 结果与指标),可导入;
- `workspaces/<case-id>/` —— 每 case 的独立工作区。

## 工程纪律

- 独立 CLI(B'),不注册任何 Cordis ctx seam;可交换接口 = `AgentAdapter` 注册表(唯一 id);
- 断言器全部纯函数/显式 IO;fixture 与真实会话的 JSON 一律运行期校验(events.ts),schema 违例不抛给进程而是记 `loadErrors`(分类 schema);
- 验证门:`pnpm --filter @basis/evals run verify` = oxlint + tsc --noEmit(strict)+ vitest run + `python3 -m unittest discover -s python`(driver 侧 EventMapper 单测,含真实样本回放)。
