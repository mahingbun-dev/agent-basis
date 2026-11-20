# E1 套件测试环境

- 生成：2026-11-19T22:10:10.226Z
- 镜像：`eterna-agent:rc5-test` → `sha256:99d8e85b509b6e3e1990481b2742a98cd550161621491cba16964d801d838f00`
- 容器：`rc5-e1suite`（项目 `rc5-e1suite`），宿主端口 **3118** → 8080
- 数据根：`/Users/sunny/eterna-data/test-20261120/e1`（fresh 根：`/Users/sunny/eterna-data/test-20261120/fresh`）
- 夹具：`/Users/sunny/code/agent-basis-rc5/tests/fixtures` → `/fixtures:ro`
- 健康：healthy
- 账号快照：users 行数 3（口令不落证据）

## 环境偏差（必须知悉）

- 54 §6.1 规定 E1 用 **3108**。本 lane 运行期间 3108 由另一 lane 的 24h 浸泡容器
  `eterna-rc5-e1` 占用（PID 记录 `artifacts/rc5/p5/testbed/soak/soak.pid`）；该浸泡
  以容器连续性为判据，重启/改写会破坏其 P0 证据。故本 lane 使用同一镜像（当前
  worktree 构建）在**独立项目/独立容器/独立数据根/独立端口 3118** 上执行，
  容器隔离强度与 3108 等价；生产容器 `eterna-agent`（3210）全程未触碰。

## 复现

```bash
node artifacts/rc5/E1/_setup/setup.mjs init
node artifacts/rc5/E1/_setup/setup.mjs up
```
