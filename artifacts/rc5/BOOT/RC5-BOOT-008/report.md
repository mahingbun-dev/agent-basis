# RC5-BOOT-008 — 旧 profile 卷副本首启追加默认 bundle（DEFERRED to W5）

- 方式：A（自动化，起容器）｜前置：旧 profile 卷副本
- 结论：**DEFERRED to W5（不标绿）** — 本用例要求「起容器触发迁移」，属 3108 容器
  环境；本地双 boot 不覆盖旧卷。

## 为什么不能在本地双 boot 覆盖

本地 verify 每次在全新 `ETERNA_PROFILE_HOME` 里物化 profile，不存在「旧卷 + 旧
manifest」，也不运行 `docker/entrypoint.sh`（只直接跑 dsh CLI）。用例判据
「默认 bundle 追加一次；二次启动不重复」只有在容器入口的 H11 接线里才能观察。

## 已有本地支撑（不等于用例通过）

- `migrate-profile-bundles.test.log`：`node --test docker/profile/migrate-profile-bundles.test.mjs`
  → 7/7 pass，覆盖「追加缺失默认项 / 二次运行零追加 / opt-out marker」逻辑。
- 入口 H11 时序已接线：`docker/entrypoint.sh:136-140`（manifest 渲染之后）。
- 但「旧卷副本起容器 + 二次启动」未执行 → 本用例保持 DEFERRED。

## W5 建议执行

1. 用旧 rc.1/rc.4 profile 卷副本起容器（E1），验证首启 `dsh.profile.bundles` 恰好
   追加 rc.5 默认集一次，写 `.eterna-default-bundles.json`；
2. 重启容器，断言 bundles 与 marker 字节不变（幂等）；
3. 证据落 `artifacts/rc5/BOOT/RC5-BOOT-008/`（容器日志 + 卷内 manifest）。

## 证据

- `migrate-profile-bundles.test.log`
- `docs/design/54-...workflow.md` §4.4 T14 / §4.11 T14
- `docker/entrypoint.sh:136-140`