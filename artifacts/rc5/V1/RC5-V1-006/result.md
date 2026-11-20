# RC5-V1-006 — v1 CI 车道（静态半）

- 用例来源：`docs/design/51-上游rc.5合并测试用例与回归.md:283`（优先级 P1 / 方式 A）
- 执行时间：2026-11-19T22:10:21Z → 2026-11-19T22:10:21Z
- 命令与退出码：见 `cmd.log`
- 判定：**PASS**（静态半；运行时半 NOT RUN）

## 预期

独立 job 绿；不依赖 dsh 安装。

## 实际

`.github/workflows/ci.yml` 存在独立 job `v1-line`（无 `needs`、非 schedule 触发，12 steps）：frozen install、cordis declarations/typecheck/test、contracts+runtime、六插件循环、dsh import guard、basis.yml chat 冒烟；未发现全局 `npm i -g @deepseek-ai/dsh`。CI 实际运行状态未在本地验证。

## 断言

- [x] 独立 v1-line job 定义完整
- [x] 无全局 dsh 安装步骤
- [ ] CI 实际 job 绿（运行时） — NOT RUN

## 备注

- CI 绿需远端运行记录；本 lane 只能核对车道定义。

## 证据

- `cmd.log`
- `check-ci-lane.mjs`
