# RC5-V1-008 — 镜像不含 v1 源/清单

- 用例来源：`docs/design/51-上游rc.5合并测试用例与回归.md:285`（优先级 P1 / 方式 A）
- 执行时间：NOT RUN
- 命令与退出码：见 `cmd.log`
- 判定：**NOT RUN**

## 预期

`docker run --rm <tag> sh -c 'test ! -e /repo/core && …'` 退出 0；镜像不含 v1 源/清单。

## 实际

NOT RUN：需 P5 构建镜像与 tag；E0 不启容器、无镜像 tag。

## 断言

- [ ] 未执行（NOT RUN）

## 备注

- P5 镜像检查补齐；Dockerfile 静态面见 ENV-006。

## 证据

