# RC5-DATA-003 · 容器内 `DSH_HOME=/data`

- 依据：51 §3.14 DATA-003；48 §5.2（只换宿主源，不换容器目标）
- 环境：E1 容器 `eterna-rc5-e1`

```bash
docker exec eterna-rc5-e1 sh -c 'printf %s "$DSH_HOME"'
# → /data
```

断言（1/1 PASS）：容器内 `DSH_HOME=/data`。

结论：**PASS**。容器内路径与迁移前逐字一致。