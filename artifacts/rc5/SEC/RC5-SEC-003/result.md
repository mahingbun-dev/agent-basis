# RC5-SEC-003 — telemetry 静态检查

- 用例来源：`docs/design/51-上游rc.5合并测试用例与回归.md:321`（优先级 P0 / 方式 A）
- 执行时间：2026-11-19T22:13:26Z → 2026-11-19T22:13:26Z
- 命令与退出码：见 `cmd.log`
- 判定：**PASS**（静态半；运行时半 NOT RUN）

## 预期

抓包/检查 telemetry：无外发遥测。

## 实际

base/super profile 模板中 `otel`、`session-telemetry-otel`、`desktop-product-telemetry`、`product-analytics` 四行均 `disabled: true`；ACP 模板 `otel`、`session-telemetry-otel` 均 disabled。51 个 workspace 清单无 telemetry/analytics SDK 依赖；产品源码（packages/core/tools）0 处 telemetry SDK 引用。运行时抓包未执行（E0 不启容器）。

## 断言

- [x] 产品 profile 遥测行全部 disabled
- [x] 无 telemetry SDK 依赖/源码引用
- [ ] 运行时抓包 — NOT RUN

## 备注

- `productAnalytics/watchPolicy` 只是 mux 流面动作名，不产生外联。

## 证据

- `cmd.log`
- `check-telemetry.mjs`
