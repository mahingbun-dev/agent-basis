# RC5-BOOT-010 — 损坏 package.json 的 profile：`.bak` 保留 + 告警清晰 + boot 不炸（DEFERRED to W5）

- 方式：A（起容器）｜前置：损坏 `package.json` 的 profile 副本
- 结论：**DEFERRED to W5（不标绿）**

## 原因

「起容器 + boot 不静默炸」需要容器入口（B1 预检 + H11 fail-closed）。本地双 boot
直接用 dsh CLI 启动新物化 profile，不经过损坏 manifest 的旧卷。

## 已有本地支撑（不等于用例通过）

- `migrate-profile-bundles.test.log` 7/7：含
  `坏 JSON fail-closed：旧文件保留、留痕 JSON（0600）、不写 marker`。
- B1 本地脚本：`scripts/profile-upgrade-check.mjs`（入口 `docker/entrypoint.sh:147-149` 接线）。
- `migrate-profile-bundles.test.log` 中另有「坏 JSON 留痕不落 manifest 原文」。

## W5 建议执行

1. 旧卷放损坏 `package.json`，起容器；
2. 断言旧文件保留（`.bak-<ts>` 或原样），入口有清晰告警，容器仍启动；
3. 证据（容器日志 + 卷内文件清单）落本目录。

## 证据

- `migrate-profile-bundles.test.log`
- `docker/entrypoint.sh:115-149`（2.4 迁移 + 预检，失败只告警不阻塞）
- `docs/design/54-...workflow.md` §4.4 T12/T14