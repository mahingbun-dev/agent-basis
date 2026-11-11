# P0 基线注记（主方案 R1 回填，G-P0-10）

- 2026-11-10：侧会话完成 main+dev 合并（PR #6，merge=e5901b4）；实测 `origin/main` == `origin/dev` == e5901b4，双向差异 0。
- 双祖先核验：d294953（PR #4 新用户四症状修复）∈ origin/main = YES；869c43f（PR #5 治理规则方案 A）∈ origin/main = YES。
- 开发基线（D0 拍板）= `origin/main`（合并后）；唯一 worktree `../agent-basis-team`（分支 `feat/team-platform`）HEAD == e5901b4。
- 原 LLM 计划 T0.1「基于 origin/main」与统一方案 v1 R1「改 origin/dev」之争随合并落地自然消解：main=dev，以 main 为准。
- 凭据源勘误：LLM 计划 T0.2 所写 `/Users/sunny/code/litellm/proxy_server_config.yaml` 无三家条目；实际三家 key 在 NAS `/data/litellm/.env`（DEEPSEEK_API_KEY/MIMO_API_KEY/BIGMODEL_API_KEY，经 synology 白名单通道提取，0600 落 `.secrets/`）。
- 附带事实（影响 P2/A1）：NAS 网关 `litellm_config.yaml` 将 `deepseek-flash` 临时路由到 `xiaomi_mimo/mimo-v2.6-flash`（2026-11-05 用户指令，DeepSeek 资费高测试期）；cherry 会话 422 的上游实为 MiMo serde（错误体含 MiMo 特有 `latest_reminder` 角色）。机制根因见主方案 §2.5 I1。
