# Eterna Agent 容器镜像(多阶段):builder 装工作区+构建客户端 bundle;runtime 装
# 全局 dsh 内核(registry 钉版,与验收实例同版 0.2.2-alpha.3)+仓库本体。
# 运行内核来自 npm registry,对 deepseek-harness 源仓库零依赖(自包含部署)。
FROM node:24-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm -r --if-present run build:client \
 && (cd packages/llm-openai && pnpm build)

FROM node:24-bookworm-slim
# python3/make/g++:npm 全局装 dsh 时 koffi/node-pty 等原生依赖 node-gyp 需要
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ curl \
 && rm -rf /var/lib/apt/lists/* \
 && npm i -g @deepseek-ai/dsh@0.2.2-alpha.3 \
 && npm cache clean --force

COPY --from=build /repo /repo
COPY docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh && mkdir -p /data

ENV DSH_HOME=/data
# 载体 env(compose 注入):DEEPSEEK_API_KEY / MIMO_API_KEY / BIGMODEL_API_KEY /
# ETERNA_PUBLIC_URL / ETERNA_TRUSTED_HOST(反代场景)
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -s -o /dev/null "http://$(hostname -i | awk '{print $1}'):8080/" || exit 1
ENTRYPOINT ["/app/entrypoint.sh"]
