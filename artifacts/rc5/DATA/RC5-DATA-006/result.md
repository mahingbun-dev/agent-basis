# RC5-DATA-006 · 容器内 `DSH_AGENTS_HOME=/data/agents`

- 依据：51 §3.14 DATA-006；48 §6.2（用户级 AGENTS/skills 不得落容器层）
- 环境：E1 容器 `eterna-rc5-e1`

```bash
docker exec eterna-rc5-e1 sh -c 'printf %s "$DSH_AGENTS_HOME"'   # → /data/agents
docker exec eterna-rc5-e1 sh -c 'test -d /data/agents && echo yes'  # → yes
test -d ~/eterna-data/test-rc5/e1/agents                         # 宿主侧存在（bind 实证）
```

断言（3/3 PASS）：环境变量 `/data/agents`、容器内目录存在、宿主侧 `e1/agents` 存在。

结论：**PASS**。用户级 AGENTS 目录持久化在 bind 数据根内。