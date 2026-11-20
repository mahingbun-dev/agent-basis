# RC5-CMD-004 · ACP 命令面

**状态：DEFERRED to W5（未执行真 ACP 会话，不标绿）**

## 为什么不能在本 lane 通过

1. 51 §0.4 把用例放在 **E4 ACP** 实例；E4 依赖 54 §4.6 **T31（B17 ACP entrypoint/service）**，T31 仍为 ⬜。
2. 本工作树没有 Eterna ACP 入口（`ETERNA_FORM=acp` / compose service / stdout 纯 JSON-RPC 约束均属 T31/T43 交付面），硬边界禁止起/改生产容器。
3. 上游 `dsh --profile acp --dump-config` 能组合（EXIT=0），但那只是上游 bundle，不是 E4 产品实例。

## 静态证据（与「按设计不出现在 ACP」一致，但不替代实测）

- 上游 acp 组合树里 **Host 命令注册表仍在**：`commands`、`command-feedback`、`command-goal`、`command-compact`
  （`acp-dump-config.log:201-210,263-266`）——它们是宿主服务，不是 UI。
- **没有任何 web 客户端面**（无 `dsh-client-ui-commands`），ACP 是 stdio JSON-RPC，没有命令列表 UI。
- 上游包明确把 commands 列为不支持面：`dsh-acp/README.md:82`、`:177`
  （"…modes, commands, plans, terminals… remain outside this automation surface"）；
  `dsh-acp/src` 无 `available_commands` 实现。
- `dsh-acp-app/cordis.patch.yml` 只 insert `acp-app-startup` + `acp` 两行。

结论：设计一致，**证据等级只到静态**；按 51 必须在 E4 做真会话断言，故 deferred。

## 建议（W5）

T31 落地后在 E4 断言：
1. `initialize` / 会话能力面不含命令列表（ACP 无 `available_commands`）；
2. 传 `/compact` 文本时按普通 prompt 处理（不经 `commands.execute`），且 stdout 无非 JSON-RPC 噪声；
3. 同时回归本次 definitionId 修复（SDK `queryCommand` 依赖它识别 `/compact`，`dsh-sdk-jsonrpc-server/src/query-input.ts:19-27`）。

## 证据

`cmd.log`、`acp-dump-config.log`、`acp-dump-config.stderr.log`