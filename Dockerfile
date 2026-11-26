# Eterna Agent 容器镜像(多阶段):builder 装工作区+构建客户端 bundle;runtime 装
# 全局 dsh 内核(registry 钉版 0.2.2-rc.5,与验收实例同版)+仓库本体。
# 运行内核来自 npm registry,对 deepseek-harness 源仓库零依赖(自包含部署)。
#
# 2026-11-20 rc.5(T37/T40/B9):
# - 只装 `@deepseek-ai/dsh@0.2.2-rc.5`——dsh 自身依赖里已带同版 dsh-mcp-client /
#   dsh-acp-app 等全部 @deepseek-ai 面(实测 npm 全局安装把它们放在
#   `<dsh>/node_modules/@deepseek-ai/*`),不再单独 `npm i -g dsh-mcp-client`。
#   entrypoint 第 4 步从 `$DSH_PKG/node_modules/@deepseek-ai/dsh-mcp-client` 建链,
#   与内核 realpath 同版(构建期探针断言)。
# - Node ≥24.9(root engines 与 dsh engines 同线):构建期断言,基镜像 tag 漂移就炸。
# - T41 office:字体 Noto CJK/Liberation/DejaVu + python-docx/openpyxl/python-pptx,
#   构建期探针(`python3 -c 'import docx, openpyxl, pptx'` + `fc-list` 断言)。
# - 构建末剥离 v1(B11;50 §3.3):core/、basis.yml、6 个 @basis 包在 install/构建后
#   删除——不能用 .dockerignore,否则 workspace install 直接缺包。
# - 构建期网络韧性(2026-11-20 构建事故修复,见下方 build 阶段注释):apt 默认
#   Acquire::Retries=0 → 一次 TCP 超时整层 exit 100。改为「apt 逐文件重试 6 次 +
#   外层 3 次重试 + BuildKit cache mount(apt/pip/npm/corepack 跨构建复用)」;
#   另留 `DEBIAN_MIRROR` build-arg 作为出口被墙时的换源逃生口(缺省行为不变)。

# 构建期镜像源逃生口:默认空 = 仍走基镜像自带的 http://deb.debian.org(零行为变化)。
# 现场故障是「向 151.101.74.132:80 的连接成批超时」;若出口本身不可达(重试也救不回),
# 可 `docker build --build-arg DEBIAN_MIRROR=https://mirrors.aliyun.com .` 换源
# (bookworm 的 /debian 与 /debian-security 路径在各镜像站同构)。compose 已透传同名变量。
ARG DEBIAN_MIRROR=

FROM node:24-bookworm-slim AS build
# 把全局 ARG 带进本阶段作用域(ARG 在 FROM 前声明,阶段内须重新 ARG 才可见)。
ARG DEBIAN_MIRROR
RUN corepack enable
WORKDIR /repo
COPY . .
# Node ≥24.9 构建期断言(T40):基镜像 tag 漂移低于该线时直接失败,不产半坏镜像。
RUN node -e 'const [maj, min] = process.versions.node.split(".").map(Number); if (maj < 24 || (maj === 24 && min < 9)) { console.error("[build] FATAL node " + process.versions.node + " < 24.9"); process.exit(1); } console.log("[build] node " + process.versions.node)'
# 2026-11-20 rc.5(T40):rc.1 时代三步 workaround 全部删除——(a) 关闭 depsStatusCheck /
# auto-install-peers 的 ENV、(b) install 后把 @deepseek-ai 产物的 peer 声明放宽为 "*"、
# (c) 因 manifest 失配而改用 node 直跑构建脚本绕开 pnpm run 的全量重装。依据:rc.5
# 依赖树里私有 optional 包 `@deepseek-ai/dsh-type-meta` 在 pnpm-lock.yaml 命中 0 次
# (此前公网 404 断链的根因);仓库 catalog 与全局内核同为 0.2.2-rc.5,peer 自然满足。
# 保留下来的只是「按包的显式构建命令」本身(与 pnpm 自检无关)。
# zip：companion 扩展分发包打包需要（仅 build 阶段，runtime 不带）
# build:client=dsh 客户端半边 bundle（access/panel/brand/knowledge-admin 等）；build=各包产物
# （browser-relay relay+mcp dist、extension-companion dist+zip、llm-openai tsc、
#   knowledge-admin 额外 tsc 仅留排查用 dist/——包 exports["."] 指 ./src/index.ts，
#   Node 24 type-stripping 直读，不需要 dist 也能装载；客户端半边由 build-client 产出 lib/client.js）
# knowledge-admin host 产物(2026-11-19 融合后不再是装载条件):exports["."] 指
# src/index.ts(Node 24 type-stripping 直读),内置行由模板 baked row 提供;镜像内
# 保留一份 dist/ 仅作排查/旧卷兼容,缺失不影响启动。
#
# 网络韧性(2026-11-20 rc.5 构建事故;实测):
# - 现场:apt 53s 拉完 104MB(@1952 kB/s)后,成批 .deb 报
#   `Could not connect to deb.debian.org:80 (151.101.74.132), connection timed out`,
#   `apt-get install` exit 100 → 整个 RUN 失败。同一 apt 命令在链路正常时实测 28s 通过
#   (artifacts/rc5/p5/image-repairs/repro-apt-install.txt),故根因是「瞬时断链 + 零容错」,
#   不是包名/版本问题。
# - apt 默认 Acquire::Retries=0(实测 `apt-config dump | grep -i retries` 无该键;对照实测
#   Retries=3 时同一坏源产生 3 次重试尝试、Retries=0 时 0 次)。故每个 apt/pip/npm 命令
#   都加逐文件重试,外层再套 3 次(间隔 5s),瞬时抖动不再直接炸整层。
# - `/var/cache/apt`、`/var/lib/apt/lists` 走 BuildKit cache mount:.deb 与索引跨构建复用,
#   重跑不再重下 100MB+(重跑本身即最大的一次风险暴露);cache mount 内容不进镜像层,
#   故原来收尾的 `rm -rf /var/lib/apt/lists/*` 一并删除(否则每次构建都把索引缓存清掉)。
# - pnpm store 同样挂 cache mount,install 重跑命中本地 tarball。
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    --mount=type=cache,target=/root/.local/share/pnpm/store,sharing=locked \
    set -eu; \
    export DEBIAN_FRONTEND=noninteractive; \
    if [ -n "${DEBIAN_MIRROR:-}" ]; then \
      echo "[build] DEBIAN_MIRROR=${DEBIAN_MIRROR:-}"; \
      for f in /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources; do \
        if [ -f "$f" ]; then sed -i "s|http://deb.debian.org|${DEBIAN_MIRROR:-}|g" "$f"; fi; \
      done; \
    fi; \
    retry() { n=0; until "$@" </dev/null; do n=$((n + 1)); if [ "${n}" -ge 3 ]; then echo "[build] FATAL retry exhausted: $*" >&2; return 1; fi; echo "[build] retry ${n}/3 after failure: $*" >&2; sleep 5; done; }; \
    apt_get() { apt-get -o Acquire::Retries=6 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 "$@"; }; \
    retry apt_get update; \
    retry apt_get install -y --no-install-recommends zip; \
    retry pnpm install --frozen-lockfile; \
    sh -c 'for d in /repo/packages/*/; do if [ -f "$d/scripts/build-client.mjs" ]; then (cd "$d" && node scripts/build-client.mjs); fi; done'; \
    sh -c 'cd /repo/packages/browser-relay && node build.mjs && cd /repo/packages/extension-companion && node build.mjs'; \
    sh -c 'cd /repo/packages/llm-openai && ./node_modules/.bin/tsc -p tsconfig.build.json'; \
    sh -c 'cd /repo/packages/knowledge-admin && ./node_modules/.bin/tsc -p tsconfig.build.json'

# 构建末剥离 v1(B11;50 §3.3/T40):v1 线源码与清单仍入仓、参与 workspace install
# (T18–T23 的 CI 走源码树),但**运行镜像不带**。2026-11-26 增 packages/skills
# (新增 v1 技能插件,依赖 @core/contracts,须与 core 同步剥离)。剥离点必须在
# install/构建之后、final COPY 之前——放 .dockerignore 会让 `pnpm install --frozen-lockfile` 缺包。
RUN rm -rf /repo/core /repo/basis.yml \
      /repo/packages/system-prompt /repo/packages/session /repo/packages/tools \
      /repo/packages/skills \
      /repo/packages/llm /repo/packages/approval-cli /repo/packages/agent-loop \
 && test ! -e /repo/core \
 && test ! -e /repo/basis.yml \
 && for p in system-prompt session tools skills llm approval-cli agent-loop; do \
      test ! -e "/repo/packages/$p" || { echo "[build] FATAL v1 包未剥离: $p"; exit 1; }; \
    done \
 && echo "[build] v1 stripped: core/, basis.yml, 7 @basis packages"

FROM node:24-bookworm-slim
# 与 build 阶段同一换源逃生口(ARG 作用域按阶段隔离,须重新声明)。
ARG DEBIAN_MIRROR
# python3/make/g++:npm 全局装 dsh 时 koffi/node-pty 等原生依赖 node-gyp 需要
# git(2026-11-19):插件市场 git 源安装(plugin-manager→pnpm→git)与一键发布
# (submit_plugin_to_market)都依赖 git CLI——此前镜像缺 git,发现页装 git 源
# 插件必败(ENOENT),一键发布同样不可用。
# ca-certificates(2026-11-19):bookworm-slim 默认无系统 CA,且 --no-install-recommends
# 也不会被 git 拖进来 → 容器内 git/curl 访问 https 全败(git: "CAfile: none";
# 0.1.33 实测 git ls-remote github 报 server certificate verification failed)。
# Node fetch 自带 Mozilla 根证书故不受影响,掩盖了该缺口——git 路径必须系统 CA。
#
# T41 office(B15;50 §3.5):字体 Noto CJK/Liberation/DejaVu 供 office_render 预览;
# fontconfig 显式装(--no-install-recommends 下字体包不带 fc-list/缓存)。Python:
# python3-docx/python3-openpyxl 走 Debian 包;python-pptx 在 bookworm 无 apt 包
# (packages.debian.org/bookworm/python3-pptx = No such package,2026-11-20 核对),
# 按 50 §3.5「apt 不可用则 pip」用 pip 钉版装入系统 site-packages(镜像内 root,
# --break-system-packages 即 PEP 668 语义)。
#
# mcp-client 收敛(T37/T48):内核安装是唯一 @deepseek-ai 来源,不再 `npm i -g
# dsh-mcp-client`——避免「两个全局包各自解析版本族」的漂移面。
# pnpm 运行态可用：插件市场安装走 `pnpm add`（2026-11-11 E2E：镜像无 pnpm →
# .plugin-manager 全部 spawn pnpm ENOENT，发现页安装必败）。钉 root packageManager
# 同版，corepack prepare 烧进镜像避免首装拉取。
#
# 网络韧性(2026-11-20 rc.5 构建事故,失败行即本 RUN 的 apt 段):
# - apt 逐文件重试(Acquire::Retries=6,30s 超时)+ 外层 3 次重试;
# - pip / npm 同为公网下载,同样套外层重试(pip 再加 --retries 10);
# - /var/cache/apt、/var/lib/apt/lists、/root/.cache/pip、/root/.npm 全部 cache mount:
#   跨构建复用下载物、不进镜像层 → 原 `rm -rf /var/lib/apt/lists/*` 与
#   `npm cache clean --force` 不再需要(前者会清掉索引缓存,后者会清掉挂载缓存)。
# - **不能**整体挂 /root/.cache:corepack home 在 /root/.cache/node/corepack,
#   `corepack prepare pnpm@11.7.0 --activate` 的产物必须留在镜像层(实测整体挂载后
#   镜像内 pnpm 又去下 latest 12.x,钉版失效——故只挂 pip 子目录)。
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    --mount=type=cache,target=/root/.cache/pip,sharing=locked \
    --mount=type=cache,target=/root/.npm,sharing=locked \
    set -eu; \
    export DEBIAN_FRONTEND=noninteractive; \
    if [ -n "${DEBIAN_MIRROR:-}" ]; then \
      echo "[build] DEBIAN_MIRROR=${DEBIAN_MIRROR:-}"; \
      for f in /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources; do \
        if [ -f "$f" ]; then sed -i "s|http://deb.debian.org|${DEBIAN_MIRROR:-}|g" "$f"; fi; \
      done; \
    fi; \
    retry() { n=0; until "$@" </dev/null; do n=$((n + 1)); if [ "${n}" -ge 3 ]; then echo "[build] FATAL retry exhausted: $*" >&2; return 1; fi; echo "[build] retry ${n}/3 after failure: $*" >&2; sleep 5; done; }; \
    apt_get() { apt-get -o Acquire::Retries=6 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 "$@"; }; \
    retry apt_get update; \
    retry apt_get install -y --no-install-recommends \
      python3 make g++ curl git ca-certificates \
      fontconfig fonts-noto-cjk fonts-liberation fonts-dejavu-core \
      python3-pip python3-docx python3-openpyxl; \
    retry pip3 install --break-system-packages --retries 10 --timeout 60 "python-pptx==1.0.2"; \
    retry npm i -g --fetch-retries=5 --fetch-retry-maxtimeout=120000 @deepseek-ai/dsh@0.2.2-rc.5; \
    corepack enable; \
    retry corepack prepare pnpm@11.7.0 --activate

# ── 构建期探针(T37/T40/T41/T48 的镜像内断言前置)────────────────────────────
# 全部 fail-closed:任一不满足即构建失败,不让带病镜像出闸。
# - dsh --version 必须逐字 0.2.2-rc.5;
# - dsh-mcp-client 必须在 dsh 安装目录内且版本与内核一致(entrypoint 第 4 步按该
#   路径建链;实测 npm -g 把依赖嵌在 `<dsh>/node_modules/@deepseek-ai/*`);
# - dsh-acp-app 可达(ACP profile bundles=base+acp-app);
# - flock 存在(entrypoint ACP/web 渲染锁依赖 util-linux);
# - 字体/Python 三库可 import/fc-list。
RUN set -eu; \
    DSH_PKG="$(dirname "$(dirname "$(readlink -f "$(command -v dsh)")")")"; \
    [ "$(dsh --version)" = "0.2.2-rc.5" ] || { echo "[build] FATAL dsh --version=$(dsh --version) != 0.2.2-rc.5"; exit 1; }; \
    test -f "$DSH_PKG/node_modules/@deepseek-ai/dsh-mcp-client/package.json" || { echo "[build] FATAL dsh-mcp-client 不在 $DSH_PKG/node_modules/@deepseek-ai/"; exit 1; }; \
    test -d "$DSH_PKG/node_modules/@deepseek-ai/dsh-acp-app" || { echo "[build] FATAL dsh-acp-app 缺失(ACP profile 不可 boot)"; exit 1; }; \
    node -e 'const root = process.argv[1]; const kernel = require(root + "/package.json").version; const mcp = require(root + "/node_modules/@deepseek-ai/dsh-mcp-client/package.json").version; if (kernel !== mcp) { console.error("[build] FATAL mcp-client " + mcp + " != dsh " + kernel); process.exit(1); } console.log("[build] mcp-client " + mcp + " == dsh " + kernel)' "$DSH_PKG"; \
    command -v flock >/dev/null || { echo "[build] FATAL flock 缺失(entrypoint 渲染锁)"; exit 1; }; \
    python3 -c 'import docx, openpyxl, pptx; print("[build] python-docx/openpyxl/python-pptx OK")'; \
    fc-list | grep -qi 'Noto Sans CJK' || { echo "[build] FATAL Noto Sans CJK 字体缺失"; exit 1; }; \
    fc-list | grep -qi 'Liberation' || { echo "[build] FATAL Liberation 字体缺失"; exit 1; }; \
    fc-list | grep -qi 'DejaVu' || { echo "[build] FATAL DejaVu 字体缺失"; exit 1; }; \
    echo "[build] probes OK: dsh $DSH_PKG"

COPY --from=build /repo /repo
# 剥离结果的运行层复核(v1 源/清单/6 包不得出现在最终镜像;T40/T48)。
RUN test ! -e /repo/core && test ! -e /repo/basis.yml \
 && for p in system-prompt session tools llm approval-cli agent-loop; do test ! -e "/repo/packages/$p" || exit 1; done
COPY docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh && mkdir -p /data

ENV DSH_HOME=/data
# rc.5 用户级 AGENTS.md/skills 根(上游默认 ~/.agents 会落容器层;48 §6.2)。
# compose 显式注入同名值;镜像缺省也给一致落点,裸 docker run 不丢。
ENV DSH_AGENTS_HOME=/data/agents
# 载体 env(compose 注入):DEEPSEEK_API_KEY / MIMO_API_KEY / BIGMODEL_API_KEY /
# ETERNA_PUBLIC_URL / ETERNA_TRUSTED_HOST(反代场景) / ETERNA_FORM(base|super|acp)
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -s -o /dev/null "http://$(hostname -i | awk '{print $1}'):8080/" || exit 1
ENTRYPOINT ["/app/entrypoint.sh"]
