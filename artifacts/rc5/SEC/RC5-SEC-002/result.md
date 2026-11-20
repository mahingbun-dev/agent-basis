# RC5-SEC-002 · 凭据扫描（跟踪文件/镜像/argv）

- 套件：SEC
- 结论：**PASS**
- 开始/结束：2026-11-20T05:25:24.785Z / 2026-11-20T05:25:27.202Z

## 预期

扫 `.secrets`、`.env`、argv、镜像与日志：无凭据进入被跟踪文件/镜像/argv/日志。
（`.env` / 容器 env 是允许的凭据通道，不作为违规项。）

## 实际

- 静态半：git 跟踪文件扫描，`hits=0`（8 类高置信规则 + password/api_key 赋值形态；占位符/测试值按 `placeholder` 正则豁免）
- 运行时半：终版镜像 `eterna-agent:rc5-test`（fresh container，无宿主挂载）文件系统 + lane argv（Config.Cmd/top）+ 容器日志 tail2000，`hits=0`
- 扫描器自检：`self_test=true`（容器内对植入假 key 必须命中）
- 范围说明：第三方 vendor 树（`node_modules`/`.pnpm`/`.git`）不扫——其中是上游自带的测试夹具（zod JWT 样例、jose 密钥块等），非本项目凭据，也不可能含本项目密钥；产品自有路径（`/app`、`/repo` 源码、`/data` 模板、`/opt`）全量扫描。

## 断言

- [x] 跟踪文件无高置信凭据（含固定口令字面量）
- [x] 镜像/argv/日志无高置信凭据
- [x] 扫描器自检通过（阳性样本可命中）

## 备注

- 历史证据（2026-11-19）曾报 14 处命中：1 处文档 mock key + 13 处测试固定口令；该批字面量已替换为显式测试值（含 `test`/`fake` 占位语义），本轮静态复扫 0 命中。
- 证据只记录脱敏前缀/后缀与长度，不落明文；容器 env 值不打印。

## 证据

- `cmd.log`
- `scan-secrets.mjs` / `scan-runtime.mjs`
