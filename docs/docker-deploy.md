# 容器镜像与卷布局

> 部署操作/env 全表/外网入口/服务迁移见 **[deploy/README.md](../deploy/README.md)**。
> 2026-11-09 定案：本机 Docker 跑容器，NAS 反代做外网入口。镜像自包含：内核
> `@deepseek-ai/dsh` 从 npm registry 装（钉 0.2.2-alpha.3，与验收实例同版），
> 对源仓库零依赖。本页仅保留镜像内部结构与版本纪律细节。

> 部署操作、env 全表、外网入口、服务迁移已迁移至 **[deploy/README.md](../deploy/README.md)**
> （部署与服务迁移指南，含配置模板 [env.production.example](../deploy/env.production.example)
> 与验证脚本 [verify.sh](../deploy/verify.sh)）。本页仅保留镜像内部结构与版本纪律细节。

## 镜像内布局

- `/repo` — 仓库本体（workspace + node_modules + 构建产物 lib/）
- `/data` — DSH home（named volume）：`profiles/eterna-web/`（entrypoint 渲染）
  + 会话 + storages + 审计
- patch 模板 `docker/profile/cordis.patch.yml.template` = 验收实例 proven 配置
  收编（35 行：企业裁切 + 5 个 eterna 挂载 + llm-pi-ai 根级覆写 6 模型 +
  preset-standard/cordis 重述）；`__ETERNA_LLM_BASE_URL__` 占位符由 entrypoint
  sed 渲染——**模型密钥永不入镜像/模板**，走 env。
- 版本纪律：内核钉 `@deepseek-ai/dsh@0.2.2-alpha.3`（与 profile 内 @deepseek-ai
  symlink 同源，避免 preset 版本错配被静默 disable——2026-11-09 实测教训）。

## 与本地验收实例的关系

本地实例（宿主进程，端口 3107，home `.eterna-home-accept/`）用于开发验收；
容器实例（端口 3210，home 卷）用于云端部署。两者 profile 同源（同一 patch
模板基座），容器即「验收通过的配置」的部署形态。
