# Eterna Agent 容器镜像(多阶段):builder 装工作区+构建客户端 bundle;runtime 装
# 全局 dsh 内核(registry 钉版,与验收实例同版 0.2.2-alpha.3)+仓库本体。
# 运行内核来自 npm registry,对 deepseek-harness 源仓库零依赖(自包含部署)。
FROM node:24-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
# pnpm run 前的 depsStatusCheck 强制关闭(2026-11-16):仓库 .npmrc 的两种拼写
# (verify-deps-before-run/verifyDepsBeforeRun=false)在容器内未拦住该自检,
# 它以单包 scope 触发子 install,解析 rc.1 依赖树中的私有 optional 包
# (@deepseek-ai/dsh-type-meta)在公网 registry 404 → build 链路断。ENV 优先级
# 最高;dsh 内核升 rc.1 且私有包可公网解析后可移除。
ENV npm_config_verify_deps_before_run=false \
    npm_config_verifyDepsBeforeRun=false \
    npm_config_auto_install_peers=false
# auto-install-peers=false(2026-11-16):glue 新增 @deepseek-ai/* peer(catalog:
# rc.1)后,主 install 的 peer 自动安装开始解析 rc.1 依赖树中的私有 optional 包
# (@deepseek-ai/dsh-type-meta)公网 404 → frozen install 断。关掉后 install 只走
# lockfile(本地实测 exit 0);peer 语义由下方 peer 对齐步 + 运行时全局内核满足。
# dsh 内核升 rc.1 且私有包可公网解析后一并移除。
# zip：companion 扩展分发包打包需要（仅 build 阶段，runtime 不带）
# build:client=dsh 客户端半边 bundle（access/panel/brand 等）；build=各包产物
# （browser-relay relay+mcp dist、extension-companion dist+zip、llm-openai tsc）
RUN apt-get update \
 && apt-get install -y --no-install-recommends zip \
 && pnpm install --frozen-lockfile \
# peer 对齐(过渡态,2026-11-16):仓库 catalog 已升 rc.1,内核钉 alpha.3(见下方
# runtime 注释的 11-11 已知坑)——宿主按插件 peer 声明判版本族,catalog 解析出的
# rc.1 不满足 alpha.3,@eterna/* 插件整组被静默 disable。install 后(避开
# frozen-lockfile 校验)把各插件包的 @deepseek-ai/* peer 声明放宽为 "*"(仅声明
# 面,实装版本不变);dsh 内核升级 rc.1 后移除本步。
 && node -e 'const fs=require("fs");const dirs=fs.readdirSync("/repo/packages");for(const p of dirs){const f="/repo/packages/"+p+"/package.json";try{const j=JSON.parse(fs.readFileSync(f,"utf8"));if(!j.peerDependencies)continue;let changed=false;for(const k of Object.keys(j.peerDependencies)){if(k.startsWith("@deepseek-ai/")&&j.peerDependencies[k]!=="*"){j.peerDependencies[k]="*";changed=true}}if(changed)fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n")}catch(e){}}' \
# 逐包 node 直跑构建脚本(2026-11-16):peer 对齐改动 manifest 后,pnpm -r run 会
# 检测 manifest↔lockfile 失配并自动全量重解析,rc.1 依赖树的私有 optional 包
# (dsh-type-meta)公网 404 断链(ENV 关自检亦拦不住该失配重装)——node 直跑
# 零 pnpm run 自检面;内核升 rc.1 且私有包可解析后可还原 pnpm -r run。
 && sh -c 'for d in /repo/packages/*/; do if [ -f "$d/scripts/build-client.mjs" ]; then (cd "$d" && node scripts/build-client.mjs); fi; done' \
 && sh -c 'cd /repo/packages/browser-relay && node build.mjs && cd /repo/packages/extension-companion && node build.mjs' \
 && sh -c 'cd /repo/packages/llm-openai && ./node_modules/.bin/tsc -p tsconfig.build.json' \
 && rm -rf /var/lib/apt/lists/*

FROM node:24-bookworm-slim
# python3/make/g++:npm 全局装 dsh 时 koffi/node-pty 等原生依赖 node-gyp 需要
# dsh-mcp-client：companion 浏览器执行面挂载用。必须与内核版本族严格一致
# （rc.1 在 alpha.3 内核上被静默 disable——requirements 整组 rc.1 包不匹配，
# 2026-11-11 生产实测；「@deepseek-ai symlink 须指全局同版本」老坑的版本族变体）
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ curl \
 && rm -rf /var/lib/apt/lists/* \
 && npm i -g @deepseek-ai/dsh@0.2.2-alpha.3 @deepseek-ai/dsh-mcp-client@0.2.2-alpha.3 \
 && npm cache clean --force \
# pnpm 运行态可用：插件市场安装走 `pnpm add`（2026-11-11 E2E：镜像无 pnpm →
# .plugin-manager 全部 spawn pnpm ENOENT，发现页安装必败）。钉 root packageManager
# 同版，corepack prepare 烧进镜像避免首装拉取。
 && corepack enable \
 && corepack prepare pnpm@11.7.0 --activate

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
