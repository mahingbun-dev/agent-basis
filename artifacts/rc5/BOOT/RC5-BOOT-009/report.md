# RC5-BOOT-009 — 旧 profile 已 opt-out：marker 生效、不回加（DEFERRED to W5）

- 方式：A（起容器）｜前置：旧 profile 卷副本 + 用户已关闭某默认 bundle
- 结论：**DEFERRED to W5（不标绿）**

## 原因

本用例要观察容器入口 H11 在**已 opt-out 的旧卷**上的行为；本地双 boot 每次都
新建 profile，不存在 `.eterna-default-bundles.json` marker。

## 已有本地支撑（不等于用例通过）

- `migrate-profile-bundles.test.log` 7/7：含
  `opt-out：marker 已记录且用户从清单移除的默认项不回加`、`幂等：二次运行零追加`。
- 入口接线：`docker/entrypoint.sh:136-140`。

## W5 建议执行

1. 在旧卷写入 `.eterna-default-bundles.json`（opt-out 项）后起容器；
2. 断言该 bundle 未回到 `dsh.profile.bundles`，marker 不变；
3. 容器日志与卷内 manifest 落本目录。

## 证据

- `migrate-profile-bundles.test.log`
- `docs/design/54-...workflow.md` §4.4 T14 / §4.11 T14