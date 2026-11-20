# RC5-SEC-GOV · 治理规则 ask/deny 实跑（54 §5.5 补充回归面）

- 环境：E2 lane `rc5-e2suite`（3119，数据根 `/Users/sunny/eterna-data/test-20261120/e2`）；规则经 `access/governance.rules.yml` 覆盖，跑完还原
- 方法：确定性假模型（fake/fake-1 + `@@CALL` 指令）+ 两条探针规则（read + argsContains）

## 结论

**PASS**。

- deny：规则命中 → 内核物化 isError 工具结果（含 `命中规则 probe-deny(deny)`）+ 审计 `decision=deny`。
- ask：规则命中 → 会话落 `approval/asked`，因产品 2026-11-19 静默裁决 `approval.policy=never`，内核确定性 `approval/decided=rejected`；审计留 `decision=ask`。**决策卡不出现属产品口径**（不是本项缺口）：该裁决已写进 `docker/profile/cordis.patch.yml.template`（`approval: policy: never`）与治理规则头注。

## 明细

- `bootstrap dsh + admin login` → EXIT=0（login=200）
- `写 access/governance.rules.yml（原规则 + probe-deny/probe-ask）` → EXIT=0（bytes=8212）
- `docker restart rc5-e2suite` → EXIT=0（"rc5-e2suite\n"）
- `等待 healthy` → EXIT=0（health=healthy）
- `docker logs（末次 governance rules 行）` → EXIT=0（"[entrypoint] governance rules: /data/access/governance.rules.yml -> /data/.eterna/governance.rules.yml (cwd=/data)"）
- `容器内规则含 probe-deny` → EXIT=0（"1\n"）
- `ensureFakeRoute（fake/fake-1 路由，admin 默认模型）` → EXIT=0
- `deny 例 session/prompt 入队` → EXIT=0（status=200）
- `deny 例：tool/result isError 且命中 probe-deny` → EXIT=0（"{\"turn\":1,\"step\":1,\"message\":{\"role\":\"tool\",\"source\":{\"kind\":\"tool\",\"callId\":\"call_fake_157_0\"},\"toolCallId\":\"call_fake_157_0\",\"content\":[{\"type\":\"text\",\"text\":\"Error: [governance] 命中规则 probe-deny(deny):验收探针：deny 规则必须生效\"}],\"isError\":true,\"id\":\"58520c39-3f26-411b-9531-75e81a1373cc\"}}"）
- `deny 例：审计出现 decision=deny` → EXIT=0（rows=1 {
          "source": "glue-governance",
          "event": "tools/pre-execute",
          "tool": "read",
          "decision": "deny",
          "reason": "[governance] 命中规则 probe-deny(deny):验收探针：deny 规则必须生效"
}）
- `ask 例 session/prompt 入队` → EXIT=0（status=200）
- `ask 例：浏览器待决项（approval=never 时为 0，属产品裁决）` → EXIT=0（none（符合 never））
- `ask 例：会话 approval/policy=never（产品裁决）` → EXIT=0（policy=never）
- `ask 例：会话落 approval/asked` → EXIT=0（{
          "id": "a98a54b0-6df1-4fba-8bba-ed5331c17481",
          "toolName": "read",
          "callId": "call_fake_159_0",
          "reason": "[governance] 命中规则 probe-ask(ask):验收探针：ask 规则必须生效"
}）
- `ask 例：内核确定性 rejected（approval never）` → EXIT=0（{
          "id": "a98a54b0-6df1-4fba-8bba-ed5331c17481",
          "outcome": "rejected"
}）
- `ask 例：tool/result isError` → EXIT=0（"{\"turn\":1,\"step\":1,\"message\":{\"role\":\"tool\",\"source\":{\"kind\":\"tool\",\"callId\":\"call_fake_159_0\"},\"toolCallId\":\"call_fake_159_0\",\"content\":[{\"type\":\"text\",\"text\":\"Error: the user rejected tool \\\"read\\\"\"}],\"isError\":true,\"id\":\"eeeac2ed-c40a-4119-a44f-ed6088c547f9\"},\"error\":{\"name\":\"ApprovalError\",\"code\":\"APPROVAL_REJECTED\"}}"）
- `ask 例：审计出现 decision=ask` → EXIT=0（rows=1 {
          "source": "glue-governance",
          "event": "tools/pre-execute",
          "tool": "read",
          "decision": "ask",
          "reason": "[governance] 命中规则 probe-ask(ask):验收探针：ask 规则必须生效"
}）
- `还原治理规则（删 access 覆盖 + 恢复 .eterna）` → EXIT=0
- `移除 fake provider / 恢复默认模型（cleanupFakeRoute）` → EXIT=0
- `还原后重启` → EXIT=0（"rc5-e2suite\n"）
- `还原后 healthy` → EXIT=0（health=healthy）

## 边界

- 只动 E2 测试 lane；规则文件与 fake provider 跑完还原（access 覆盖删除、.eterna 恢复原文件、默认模型恢复）。
- ask 的「决策卡截图」在 `approval: never` 下不可达（内核在征求任何人之前确定性 rejected）；如要验卡片，需改 profile 审批策略，那已不是本产品出厂形态。