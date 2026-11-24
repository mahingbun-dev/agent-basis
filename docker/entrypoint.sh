#!/bin/sh
# Eterna Agent 容器入口:渲染 profile → 建立插件 symlink → 启动 dsh(web 或 ACP)。
#
# 关键事实(2026-11-09 实测):
# - `dsh --host` 只收具体接口地址,拒通配 → 启动时解析容器 eth0 IP。
# - profile node_modules 只放本仓 @eterna 插件 symlink;@deepseek-ai 家族一律
#   指向全局 dsh 自带拷贝(版本与运行时严格一致——指向工作区/registry 另装拷贝
#   会因版本错配被 dsh 静默 disable preset 行,宿主验收实例 2026-11-09 实测)。
#   rc.5 起 dsh 自带 dsh-mcp-client/dsh-acp-app 同版依赖(T37),不再单独全局安装。
# - patch/manifest 模板渲染走哈希门控(2026-11-12 重构):模板(+relay token 盐)
#   未变则保留卷上用户文件——插件页启停(cordis.patch.yml disabled: 标记)、包级
#   启停与模型设置(package.json dsh.profile / patch llm-pi-ai 行)跨重启持久;
#   模板变更(镜像升级)才重渲染,并把旧文件的启停标记/追加覆写行/bundles 选择
#   窄移植到新渲染。模型行 config 升级仍按模板重置(既有口径),但设置页新增的
#   provider 路由(llm-pi-ai config.providers 下模板没有的键)例外——整块保留,
#   理由见 2026-11-19 事故注(docker/profile/transplant-profile.mjs 头注)。
#   提示词工坊托管值(2026-11-18 补:migrate-prompt-edits.mjs)另走基线快照移植
#   ——persona/plan-mode section/maxBytes 共 6 条,经「旧文件 vs 基线快照」判定
#   用户编辑后搬到新渲染;模板基线自身的更新照常落地。此前模板变更升级会把
#   工坊编辑打回默认(0.1.13→0.1.14 实证)。
#   会话/存储/审计全在卷,升级镜像不丢数据。
# - bootstrap token 打印在 stdout(docker logs 取);首次浏览器连接消费后,
#   BrowserAuth 会话签名落卷 credentials(重启不掉线)。
#
# 2026-11-20 rc.5(T31/T42;49 §5.7/50 §3.7):
# - ETERNA_FORM=acp:独立 profile eterna-acp(package.acp.json=base+acp-app),
#   **stdout 是 ACP JSON-RPC 专用通道**——entrypoint 自身日志逐条走 stderr(log()),
#   禁止全局 `exec 1>&2`(它会把 dsh 的 JSON-RPC 一并改道,54 §4.11);不启动 relay、
#   不起 web server,不跑 web 存量迁移;最后 exec dsh --profile eterna-acp。
# - profile 渲染加 flock($DSH_HOME/.profile-render.lock):web 与 ACP 共享 /data
#   同时首启时互斥,避免并发写 package.json/cordis.patch.yml。
# - /data mountpoint 预检(48 §6.1):漏挂 → 拒启,把「静默丢数据」变成启动失败。
# - DSH_AGENTS_HOME 缺省 /data/agents(48 §6.2;compose 显式注入同值)。
set -eu

# ── 直接命令模式(2026-11-20 W4 基座门禁修复)────────────────────────────────
# `docker run <img> dsh --version` / `node -v` / `sh -c '…'` 是镜像自检的标准形态。
# 历史实现在此处无条件先过 MIMO_API_KEY 断言(下一行),任何探针都被拦死——W4 门禁
# 的 dsh --version / node -v / v1 stripped / fonts-python 四节全部只输出
# "MIMO_API_KEY required",零断言可达。
# 规则:首个参数以 `-` 开头 = dsh 旗标,保持历史语义(继续走完整启动链,末尾
# `exec dsh "$@"`);否则视为显式命令,直接 exec —— 不渲染 profile、不碰 /data、
# 不要求 MIMO_API_KEY。生产 compose 均不传 command(两份 compose 无 command: 行),
# 故生产路径零变化。凭据无需注入:探针只读。
case "${1-}" in
  -*) : ;;
  *)
    # 单个 argv 里带空格(如 docker run <img> "dsh --version")的探针形态按 sh -c 解释
    # ——门禁脚本的引号习惯各不相同,两种写法都要能到达断言,否则又是一轮白跑。
    if [ "$#" -eq 1 ] && [ "${1#* }" != "$1" ]; then
      exec sh -c "$1"
    fi
    exec "$@"
    ;;
esac

: "${MIMO_API_KEY:?MIMO_API_KEY required (env / compose .env——默认模型走 MiMo 直连)}"
REPO=/repo
DSH_HOME="${DSH_HOME:-/data}"
export DSH_HOME
DSH_AGENTS_HOME="${DSH_AGENTS_HOME:-$DSH_HOME/agents}"
export DSH_AGENTS_HOME

# ── 0. 形态分派(ETERNA_FORM,31 号 §2.5/40 号 S-5;rc.5 增 acp)──────────────
# 缺省=base:现网 docker-compose.yml 无此 env(40 号 §1 表第 2 行),缺省行为必须与
# 历史现状逐字等价——2.5 裁剪/2.6 治理/4 家族链接/4.5 relay/5 启动各步一行不改,
# 仅 profile 目录、patch 模板、manifest 模板、第 3 步 @eterna 清单按形态取值。
# web 是 base 的同义别名(50 §6 表把 web 列为合法值,历史实现叫 base)。
# 非法值 fail-closed 拒启(40 号 §9 Q4):不静默按 base 落。
ETERNA_FORM="${ETERNA_FORM:-base}"
case "$ETERNA_FORM" in
  base|web)
    PROFILE_NAME=eterna-web
    PATCH_TEMPLATE="$REPO/docker/profile/cordis.patch.yml.template"
    PROFILE_PACKAGE="$REPO/docker/profile/package.json"
    ;;
  super)
    PROFILE_NAME=eterna-super
    PATCH_TEMPLATE="$REPO/docker/profile/cordis.super.patch.yml.template"
    PROFILE_PACKAGE="$REPO/docker/profile/package.json"
    ;;
  acp)
    PROFILE_NAME=eterna-acp
    PATCH_TEMPLATE="$REPO/docker/profile/cordis.acp.patch.yml.template"
    PROFILE_PACKAGE="$REPO/docker/profile/package.acp.json"
    ;;
  *)
    printf '%s\n' "[entrypoint] ETERNA_FORM 非法值: $ETERNA_FORM(仅 base|web|super|acp)——fail-closed 拒启(31 号 §2.5/40 号 S-5)" >&2
    exit 1
    ;;
esac
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE_NAME"

# log(): ACP 形态下 stdout 只能有 JSON-RPC;entrypoint 自己的输出逐条进 stderr。
# 其它形态保持历史行为(docker logs 走 stdout)。
log() {
  if [ "$ETERNA_FORM" = "acp" ]; then
    printf '%s\n' "$*" >&2
  else
    printf '%s\n' "$*"
  fi
}
log "[entrypoint] form=$ETERNA_FORM profile=$PROFILE_NAME template=$(basename "$PATCH_TEMPLATE") manifest=$(basename "$PROFILE_PACKAGE")"

# ── 0.1 /data 持久化预检(48 §6.1,必须)──────────────────────────────────
# /data 必须是挂载点(host bind 或 named volume 均成立)。漏挂时数据全落容器层,
# 容器一换镜像就丢——把静默丢失改成启动失败是唯一可靠护栏。
if ! awk '$2 == "/data" { found = 1 } END { exit found ? 0 : 1 }' /proc/mounts; then
  printf '%s\n' "[entrypoint] FATAL /data 不是挂载点——数据会落容器层,拒启(48 §6.1)" >&2
  exit 1
fi
log "[entrypoint] /data mountpoint OK (DSH_HOME=$DSH_HOME DSH_AGENTS_HOME=$DSH_AGENTS_HOME)"

# ── 0.2 DSH_AGENTS_HOME(48 §6.2)─────────────────────────────────────────
# 上游 rc.5 用它装用户级 AGENTS.md 与 user skills(默认 ~/.agents = 容器层)。
# 这里兜底建目录并收紧 0700;不在 $DSH_HOME 下时只告警(可能是运维显式指定)。
mkdir -p "$DSH_AGENTS_HOME"
chmod 700 "$DSH_AGENTS_HOME" 2>/dev/null || true
case "$DSH_AGENTS_HOME" in
  "$DSH_HOME"/*) ;;
  *) log "[entrypoint] WARNING DSH_AGENTS_HOME=$DSH_AGENTS_HOME 不在 $DSH_HOME 下——用户级 AGENTS/skills 可能落容器层" ;;
esac

# ── 1. profile 渲染公共件(在 render_profile 内使用)─────────────────────
# 插件启停清单(T2.3,2026-11-19 修正):停用/删除清单必须参与渲染哈希——否则
# 「停用 → 2.5 步裁掉 patch 行 → 重启启用」时模板哈希未变走 keep 路径,
# 被裁掉的行永远回不来(隔离容器 E2E 实测:停用知识底座后重新启用,行不恢复)。
# 清单变化 = 强制从模板重渲染 + 移植用户标记,再按当前清单裁剪;幂等。
DISABLED_FILE="$DSH_HOME/access/disabled-plugins.json"
REMOVED_FILE="$DSH_HOME/access/removed-plugins.json"
RENDER_SALT="${ETERNA_RELAY_TOKEN:-}"
PREV_PATCH=""
PREV_ARG="--"

ensure_rendered() {
  tpl="$1"; dst="$2"; hashfile="$3"; mode="$4"
  want="$( { cat "$tpl"; printf '%s' "$RENDER_SALT"; if [ "$mode" = "patch" ]; then cat "$DISABLED_FILE" "$REMOVED_FILE" 2>/dev/null; fi; } | sha256sum | cut -d' ' -f1 )"
  if [ -f "$dst" ] && [ -f "$hashfile" ] && [ "$(cat "$hashfile")" = "$want" ]; then
    log "[entrypoint] profile 渲染:模板未变,保留用户文件 $(basename "$dst")(启停/模型设置跨重启持久)"
    return 0
  fi
  if [ -f "$dst" ]; then
    log "[entrypoint] profile 渲染:模板变更/首启接管,移植用户标记后重渲染 $(basename "$dst")"
    node /repo/docker/profile/transplant-profile.mjs "$tpl" "$dst" "$mode" || cp "$tpl" "$dst"
  else
    log "[entrypoint] profile 渲染:全新卷,直拷模板 $(basename "$dst")"
    cp "$tpl" "$dst"
  fi
  printf '%s' "$want" > "$hashfile"
}

# ── 2. profile 渲染全链(flock 包裹;web 与 ACP 共享 /data 时互斥)────────
# 时序纪律(不可换序):
#   2(manifest+patch 哈希门控) → prompt 移植 → 2.4 rc.5 存量迁移 → 2.5 启停裁剪
#   → 2.6 治理规则 → 3/3.5 symlink 与旧卷清理 → 4 @deepseek-ai 链。
# 4.5 relay 与 5 启动不在函数内(ACP 不做 relay/web)。
render_profile() {
  # ── 1. profile 骨架(不覆盖既有会话数据) ───────────────────────────────
  mkdir -p "$PROFILE_DIR/node_modules/@eterna" "$PROFILE_DIR/node_modules/@deepseek-ai"

  # ── 2. 模板哈希门控渲染(2026-11-12 重构,修复「插件启停/模型设置重启即丢」)──
  # 过去每启裸 cp 模板覆盖卷上 cordis.patch.yml 与 package.json——dsh 插件页启停
  # 写 patch 的 disabled: 标记(boot/plugin-manager patch.ts:25-78)、包级启停与
  # 设置弹窗「模型」分区(dsh-config-editor 写 llm-pi-ai 行)全部重启即丢。
  # 现按 sha256(模板内容 + ETERNA_RELAY_TOKEN 盐) 门控:未变→保留用户文件;
  # 首启/模板变更→重渲染,且把旧文件的显式 disabled 标记、仅存于旧文件的用户
  # 覆写行、manifest 的 dsh.profile 块移植到新渲染(2026-11-12 用户拍板)。
  # 2026-11-19 补:设置页新增的 LLM provider 路由(llm-pi-ai config.providers 下模板
  # 没有的键)也随升级移植——此前重渲染整份重置模型行 config,用户自建路由静默消失,
  # 存量会话 lastUsed 仍指向它,dsh-llm 逐轮 NO_ADAPTER(已发生的生产事故)。
  # 移植逻辑见 docker/profile/transplant-profile.mjs(可单测,node --test)。
  # 治理红线行不参与移植(其装载由本文件第 2.5 步 admin 清单独立管理)。
  #
  # manifest 模板按形态取值(base/super=package.json,acp=package.acp.json;
  # 50 §3.7)。哈希文件 .rendered.*.sha256 随 profile 目录自然隔离(40 号 §9 Q2)。
  ensure_rendered "$PROFILE_PACKAGE" "$PROFILE_DIR/package.json" "$PROFILE_DIR/.rendered.package.json.sha256" manifest
  # 工坊托管值移植(2026-11-18):渲染前快照旧 patch → 渲染后按基线判定把用户改过的
  # persona/section/maxBytes 搬进新渲染。时序纪律:必须在 2.5 启停裁剪之前(其后会按
  # disabled/removed 清单再裁,移植不会复活停用行),也必须在下方 relay token sed 之前
  # (此后除 sed 外不再改本文件)。keep 路径(模板未变)同样跑——基线在册时等值零写,
  # 基线缺席(存量卷首启)借机建立。脚本逐条 fail-closed,失败仅告警不阻塞启动。
  BASELINE_JSON="$PROFILE_DIR/.rendered.cordis.patch.yml.baseline.json"
  if [ -f "$PROFILE_DIR/cordis.patch.yml" ]; then
    PREV_PATCH="$PROFILE_DIR/.prev.cordis.patch.yml"
    cp "$PROFILE_DIR/cordis.patch.yml" "$PREV_PATCH"
    PREV_ARG="$PREV_PATCH"
  fi
  ensure_rendered "$PATCH_TEMPLATE" "$PROFILE_DIR/cordis.patch.yml" "$PROFILE_DIR/.rendered.cordis.patch.yml.sha256" patch
  # acp:模板无 preset/工坊托管行(ACP 不挂 prompt-studio),跳过移植,避免无谓写读。
  if [ "$ETERNA_FORM" = "acp" ]; then
    log "[entrypoint] form=acp:跳过工坊托管值移植(ACP 模板无 preset/studio 行)"
  else
    node /repo/docker/profile/migrate-prompt-edits.mjs \
      "$PATCH_TEMPLATE" "$PREV_ARG" "$PROFILE_DIR/cordis.patch.yml" "$BASELINE_JSON" \
      || log "[entrypoint] WARNING 工坊值移植失败(该批托管值保模板默认;成因见上一行)"
  fi

  # ── 2.4 rc.5 存量迁移(B1/H9/H11;54 §4.4 T12–T14)────────────────────────
  # 时序纪律(50 §3.4.1 H9 / §5.5):必须在 prompt 移植之后、4.5 段 relay token sed
  # 之前——sed 之后除占位替换外不再改 patch。
  # 失败策略(47 §H9/H11、50 §5.5、54 §4.11):
  #   - 脚本自身在原文件解析失败时保留原文件、写 0600 留痕
  #     (.upgrade-profile-bundles-backup.json / .upgrade-mcp-servers-backup.json)
  #     并以非 0 退出;
  #   - entrypoint 只告警不阻塞启动——MCP 配置丢失时 dsh 仍可按模板空表启动
  #     (47 §H9「解析失败只告警并保留模板空表」);manifest 真损坏时 dsh 会自己
  #     报错,不必由入口先杀容器。预检(B1)同款:坏 bundle 留痕、boot 不炸。
  #   H11/B18: package.json 的 dsh.profile.bundles 只追加缺失的 rc.5 默认项;
  #            .eterna-default-bundles.json 记 opt-out,用户关闭的项不回加;
  #            写回前备份 package.json.bak-<ts>。
  #   H9:      旧 patch 的 mcp-manager.config.servers / mcp-browser 行合并进新渲染
  #            patch 的 mcp-manager 行(保留模板其余默认;新 patch 自带同名 mcp-client
  #            行时不重复写,防 serverName 双实例;见 migrate-mcp-servers.mjs 头注)。
  # ACP(T31/T42):eterna-acp 是独立清单(base+acp-app),web 默认 bundle 与旧
  # mcp-manager servers 一律**不得**并入——否则 ACP 会拉起 UI/web 行、破坏
  # 「stdout 只含 JSON-RPC、只挂治理三行」的形态。跳过,只留结构预检。
  DSH_PKG="$(dirname "$(dirname "$(readlink -f "$(command -v dsh)")")")"
  if [ "$ETERNA_FORM" = "acp" ]; then
    log "[entrypoint] form=acp:跳过 web 存量迁移(默认 bundle / MCP servers)——ACP 清单只认 package.acp.json"
  else
    MIGRATE_WARN=0
    if ! node /repo/docker/profile/migrate-profile-bundles.mjs \
      "$PROFILE_DIR/package.json" "$PROFILE_PACKAGE" \
      "$PROFILE_DIR/.eterna-default-bundles.json"; then
      MIGRATE_WARN=1
    fi
    if [ -n "$PREV_PATCH" ] && [ -f "$PREV_PATCH" ]; then
      if ! node /repo/docker/profile/migrate-mcp-servers.mjs \
        "$PREV_PATCH" "$PROFILE_DIR/cordis.patch.yml" \
        "$PROFILE_DIR/.upgrade-mcp-servers-backup.json"; then
        MIGRATE_WARN=1
      fi
    fi
    if [ "$MIGRATE_WARN" != "0" ]; then
      log "[entrypoint] WARNING profile 存量迁移有失败项(原文件保留、留痕已写;成因见上方日志)"
    fi
  fi
  # 迁移后预检(B1,47 §B1 第 4 条):坏 bundle 留痕 .upgrade-removed-bundles.json,
  # 上游已下架项删除(先备份 package.json.bak-<ts>)。预检异常不阻塞启动——坏项
  # 由 dsh 的 skippedBundles 语义跳过(profile.ts:543-551),boot 不炸。
  node /repo/scripts/profile-upgrade-check.mjs "$PROFILE_DIR" \
    --boot --apply-removals --install-anchor "$DSH_PKG/package.json" \
    || log "[entrypoint] WARNING profile 预检脚本异常(不阻塞启动;留痕见 $PROFILE_DIR/.upgrade-removed-bundles.json)"
  if [ -n "$PREV_PATCH" ]; then rm -f "$PREV_PATCH"; fi

  # ── 2.5 插件启停清单(T2.3):admin 停用的可停插件 → 渲染时裁剪对应 insert 行
  # (清单文件在文件头定义,已计入渲染哈希:启停变化触发重渲染,行可恢复)──
  if [ -f "$DISABLED_FILE" ] || [ -f "$REMOVED_FILE" ]; then
    node -e '
      const fs = require("fs")
      const read = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")) } catch { return [] } }
      const disabled = new Set([...read(process.argv[1]), ...read(process.argv[2])])
      const removed = new Set(read(process.argv[2]))
      const redLine = new Set(["eterna-governance", "eterna-audit", "eterna-egress", "eterna-access"])
      // 家族行展开(M-M3 T12,2026-11-14):双面包插件拆成 载具行+数据面行 后,
      // 停用主 id 必须连带裁掉家族行,否则浏览器半边仍在(设置分区空转)。
      const family = { "eterna-memory": ["eterna-memory-client", "eterna-memory-admin"] }
      for (const [main, rows] of Object.entries(family)) {
        if (disabled.has(main)) for (const row of rows) disabled.add(row)
      }
      const file = process.argv[3]
      const lines = fs.readFileSync(file, "utf8").split("\n")
      const out = []
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^\s*- id: (\S+)\s*$/)
        if (m && disabled.has(m[1]) && !redLine.has(m[1]) && /^\s*name:/.test(lines[i + 1] ?? "")) { i++; continue }
        out.push(lines[i])
      }
      fs.writeFileSync(file, out.join("\n"))
      console.log("[entrypoint] plugin strip applied:", [...disabled].filter((id) => !redLine.has(id)).join(", ") || "(none)", "| removed:", [...removed].join(", ") || "(none)")
    ' "$DISABLED_FILE" "$REMOVED_FILE" "$PROFILE_DIR/cordis.patch.yml"
  fi

  # ── 2.6 治理规则渲染(2026-11-10「完全权限全拒」事故修复,方案 A)──────────
  # governance-plugin 读 process.cwd()/.eterna/governance.rules.yml(governance-plugin.ts:74)。
  # 容器 working_dir=/data(compose:23)= $DSH_HOME——渲染目标必须是 ${DSH_HOME}/.eterna/。
  # 【2026-11-10 I2 事故修正】原实现按「WORKDIR=/repo」的错误假设渲染到 /repo/.eterna/,
  # 插件读不到 → 空规则集 → fail-closed 默认 ask × 完全权限预设 approval=never = 同毫秒全拒
  # (cherry 会话 session-6b03c31d 实证)。规则集随镜像入仓
  # (docker/profile/governance.rules.yml,工具名逐字对账见其头注);卷上
  # $DSH_HOME/access/governance.rules.yml 存在时优先(运维免重建改规则)。
  GOV_SRC="$DSH_HOME/access/governance.rules.yml"
  if [ ! -f "$GOV_SRC" ]; then
    GOV_SRC=/repo/docker/profile/governance.rules.yml
  fi
  mkdir -p "$DSH_HOME/.eterna"
  cp "$GOV_SRC" "$DSH_HOME/.eterna/governance.rules.yml"
  log "[entrypoint] governance rules: $GOV_SRC -> $DSH_HOME/.eterna/governance.rules.yml (cwd=$(pwd))"

  # ── 3. 插件 symlink(本仓 @eterna/*;形态即清单,40 号 S-5)────────────────
  # compaction(2026-11-12 fork 的上下文压缩家族)必须在此清单内,否则容器内解析不到。
  # attachments(2026-11-12 附件入口,客户端双面包)同理——缺 symlink 即 insert 行静默 disable。
  # memory(2026-11-15 补记):T12 双面插件(引擎行+client/admin 家族行)同样依赖本清单
  # ——实测缺链时 eterna-memory-client/admin 行静默 disable,设置分区「记忆」不出现。
  # knowledge-admin(2026-11-19 融合):知识底座唯一宿主 @eterna/knowledge-admin(四工具 +
  # 知识库工作台 + 账号面),装载行 id 仍是 eterna-knowledge(模板 baked row);symlink
  # 必须在此清单内,否则 insert 行静默 disable。
  # acp(rc.5):模板只挂 eterna-governance/audit/egress 三行,全部来自 @eterna/glue
  # ——profile 目录只链 glue(47 B17「只链需要的包」),不链 UI/业务包。
  if [ "$ETERNA_FORM" = "acp" ]; then
    ETERNA_PKGS="glue"
  else
    ETERNA_PKGS="glue llm-doctor brand panel prompt-studio llm-openai access usage-stats compaction attachments memory governance knowledge-admin"
  fi
  for pkg in $ETERNA_PKGS; do
    ln -sfn "$REPO/packages/$pkg" "$PROFILE_DIR/node_modules/@eterna/$pkg"
  done
  if [ "$ETERNA_FORM" != "acp" ]; then
    # creation-skills 别名(preset-cordis skill-filesystem 解析名)
    ln -sfn "$REPO/packages/brand" "$PROFILE_DIR/node_modules/@eterna/creation-skills"
  fi
  # super 形态守卫式补链(31 号 §2.1 super=base⊕tasks+channels+interact+workbench+toolkit):
  # 单镜像内 Tier2 源码始终在(§5 D2),但只有 super 形态建链——base 形态的 profile
  # node_modules/@eterna/ 物理上不存在 Tier2 链接(31 号 §3「base 的轻在于挂载面」与
  # §2.2 铁律 1 的装配对偶)。守卫=包目录 [ -d ] 存在才建链(登记先于落地:tasks/
  # workbench/toolkit 未落地时不建;channels/interact 已落地即建,无挂载行则链路闲置)。
  if [ "$ETERNA_FORM" = "super" ]; then
    for pkg in tasks channels interact workbench toolkit; do
      if [ -d "$REPO/packages/$pkg" ]; then
        ln -sfn "$REPO/packages/$pkg" "$PROFILE_DIR/node_modules/@eterna/$pkg"
        log "[entrypoint] super symlink: @eterna/$pkg"
      fi
    done
  fi

  # ── 3.5 旧卷迁移(2026-11-19 知识底座融合)──────────────────────────────
  # 融合前 PR #121 曾把 @eterna/knowledge-admin 登记为 profile bundle,另有旧模板/
  # 手工补挂可能留下顶层 `- id: eterna-knowledge-admin` 行。融合后只保留模板 baked
  # row(id=eterna-knowledge,name=@eterna/knowledge-admin)——此处幂等清掉两处遗留,
  # 避免双 Loader source / 重复 provide('eterna-knowledge-accounts')/重复工具注册。
  node - "$PROFILE_DIR/package.json" <<'KBADMIN_LEGACY_MANIFEST'
const fs = require('fs')
const [file] = process.argv.slice(2)
try {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'))
  const bundles = j && j.dsh && j.dsh.profile && j.dsh.profile.bundles
  if (!Array.isArray(bundles) || !bundles.includes('@eterna/knowledge-admin')) process.exit(0)
  j.dsh.profile.bundles = bundles.filter((name) => name !== '@eterna/knowledge-admin')
  fs.writeFileSync(file, JSON.stringify(j, null, 2) + '\n')
  console.log('[entrypoint] 迁移: profile bundle 移除 @eterna/knowledge-admin(改为内置行 eterna-knowledge)')
} catch (error) {
  console.log('[entrypoint] 警告: profile manifest 迁移失败 ' + error.message)
}
KBADMIN_LEGACY_MANIFEST
  node - "$PROFILE_DIR/cordis.patch.yml" <<'KBADMIN_LEGACY_PATCH'
const fs = require('fs')
const [file] = process.argv.slice(2)
try {
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  const out = []
  let skipIndent = -1
  for (const line of lines) {
    const match = /^(\s*)- id: eterna-knowledge-admin\s*$/.exec(line)
    if (match) { skipIndent = match[1].length; continue }
    if (skipIndent >= 0) {
      const trimmed = line.trim()
      const indent = /^\s*/.exec(line)[0].length
      // 行块内续行(更深缩进或同缩进的 key)一并删除;同缩进的 `- ` 是新行,停止跳过
      if (trimmed === '' || indent > skipIndent || (indent === skipIndent && !trimmed.startsWith('- '))) continue
      skipIndent = -1
    }
    out.push(line)
  }
  const text = out.join('\n')
  if (text !== lines.join('\n')) {
    fs.writeFileSync(file, text)
    console.log('[entrypoint] 迁移: patch 移除遗留 eterna-knowledge-admin 行')
  }
} catch (error) {
  console.log('[entrypoint] 警告: patch 迁移失败 ' + error.message)
}
KBADMIN_LEGACY_PATCH

  # ── 4. @deepseek-ai 家族 → 全局拷贝 ─────────────────────────────────────
  # preset 必须指 dsh 包内拷贝（版本与运行内核严格一致——指向别处会静默 disable）；
  # mcp-client 自 rc.5 起是 dsh 的同版依赖(T37/T48):dsh 包内
  # node_modules/@deepseek-ai/dsh-mcp-client,不再单独全局安装。运行时仍做一次
  # 版本对账(realpath 与内核同版),错版会在 dsh 装载时静默 disable mcp-browser
  # 行,日志里必须看得见。
  # DSH_PKG 在 2.4 段计算（profile 预检的安装锚点复用同一值）。
  if [ "$ETERNA_FORM" = "acp" ]; then
    log "[entrypoint] form=acp:不链 dsh-agent-preset/dsh-mcp-client(ACP 清单用 dsh 自带 bundle 解析)"
  else
    ln -sfn "$DSH_PKG/node_modules/@deepseek-ai/dsh-agent-preset" \
      "$PROFILE_DIR/node_modules/@deepseek-ai/dsh-agent-preset"
    MCP_CLI="$DSH_PKG/node_modules/@deepseek-ai/dsh-mcp-client"
    if [ -d "$MCP_CLI" ]; then
      ln -sfn "$MCP_CLI" "$PROFILE_DIR/node_modules/@deepseek-ai/dsh-mcp-client"
      MCP_VER="$(node -e 'try { console.log(require(process.argv[1] + "/package.json").version) } catch { console.log("unreadable") }' "$MCP_CLI")"
      DSH_VER="$(node -e 'try { console.log(require(process.argv[1] + "/package.json").version) } catch { console.log("unreadable") }' "$DSH_PKG")"
      if [ "$MCP_VER" = "$DSH_VER" ]; then
        log "[entrypoint] dsh-mcp-client $MCP_VER == dsh $DSH_VER ($MCP_CLI)"
      else
        log "[entrypoint] WARNING dsh-mcp-client($MCP_VER) 与 dsh($DSH_VER) 版本不一致——mcp-browser 挂载会被静默 disable"
      fi
    else
      log "[entrypoint] WARNING dsh 包内缺少 @deepseek-ai/dsh-mcp-client（${MCP_CLI}）——mcp-browser 挂载将失效(镜像应自带,见 Dockerfile 构建期探针)"
    fi
  fi
}

# flock 互斥(T42):web 与 ACP 共享同一 /data,同时首启会并发写 profile
# package.json/cordis.patch.yml。锁文件放 $DSH_HOME(随卷持久,跨容器可见)。
# 无 flock(极简镜像)时告警放行——单形态场景与历史行为等价。
run_render() {
  if [ "$ETERNA_FORM" = "acp" ]; then
    render_profile >&2
  else
    render_profile
  fi
}
PROFILE_RENDER_LOCK="$DSH_HOME/.profile-render.lock"
if command -v flock >/dev/null 2>&1; then
  exec 9>"$PROFILE_RENDER_LOCK"
  flock -x 9
  run_render
  flock -u 9
  exec 9>&-
else
  log "[entrypoint] WARNING flock 不可用——profile 渲染无互斥锁(web/ACP 同时首启有竞争风险)"
  run_render
fi

# ── 2.7 版本与发布说明(55 号 §5.3 ③):缺当前版本说明 = 镜像不合规,拒启 ──
# VERSION 是唯一事实源(仓库根,随镜像进 /repo);镜像 tag 与它一致由部署脚本
# deploy/release-notes-check.sh 在 build 之前判。这里只兜「镜像里没有这一版的
# 说明」——有人绕过 SOP 直接 compose up 时,这是最后一道。
# ALLOW_MISSING_RELEASE_NOTES=1 是留痕式后门(仅限热修):必须显式打开,日志一行可 grep。
RELEASE_VERSION="$(tr -d '[:space:]' < /repo/VERSION 2>/dev/null || true)"
if [ -z "$RELEASE_VERSION" ]; then
  printf '%s\n' "[entrypoint] FATAL 缺少 /repo/VERSION——镜像不合规(55 号 §5.1)" >&2
  exit 1
fi
if [ ! -s "/repo/releases/$RELEASE_VERSION/release.json" ]; then
  if [ "${ALLOW_MISSING_RELEASE_NOTES:-0}" = "1" ]; then
    log "[entrypoint] WARN $RELEASE_VERSION 缺发布说明,ALLOW_MISSING_RELEASE_NOTES=1 已放行(仅限热修)"
  else
    printf '%s\n' "[entrypoint] FATAL 缺少 releases/$RELEASE_VERSION/release.json——部署规范要求每次发布先写更新内容(55 号 §5.4)" >&2
    exit 1
  fi
else
  log "[entrypoint] release notes: $RELEASE_VERSION"
fi

# ── 沙箱 runner 预检(P1-T3):landlock probe 非 full → 告警(沙箱 fail-closed 由上游保证,
#    预检只做可见性;实测基镜像 probe=full,见隔离计划 T0.1)。
# 沙箱 runner 预检(P1-T3):直调 landlock-run --probe(等价 probe() 语义:exit 0 且无
# partial 标记=full)。包不入顶层 node_modules(可选依赖),按 .pnpm 实际路径定位。
probe_sandbox() {
  LAUNCHER="$(find /repo/node_modules/.pnpm -path '*node-addon-system-*/bin/landlock-run' -type f 2>/dev/null | head -1)"
  SANDBOX_PROBE="unusable"
  if [ -n "$LAUNCHER" ] && [ -x "$LAUNCHER" ]; then
    if OUT="$("$LAUNCHER" --probe 2>/dev/null)"; then
      case "$OUT" in
        *partially\ enforced*) SANDBOX_PROBE="partial" ;;
        *) SANDBOX_PROBE="full" ;;
      esac
    fi
  fi
  if [ "$SANDBOX_PROBE" = "full" ]; then
    log "[entrypoint] sandbox runner: landlock full"
  else
    log "[entrypoint] WARNING sandbox runner probe: $SANDBOX_PROBE — 沙箱可能 fail-closed(全拒)或降级,请检查内核"
  fi
}

# ── 5A. ACP 形态(T31;49 §5.7/50 §3.7)───────────────────────────────────
# stdout 只留 ACP JSON-RPC:此后不再有任何 stdout 写;不启动 relay(无 web 面)。
# 治理 ask 由 ACP session/request_permission 承接(模板只挂 governance/audit/egress)。
if [ "$ETERNA_FORM" = "acp" ]; then
  probe_sandbox
  log "[entrypoint] acp:exec dsh --profile $PROFILE_NAME(stdout 保留给 JSON-RPC;日志走 stderr)"
  exec dsh --profile "$PROFILE_NAME" "$@"
fi

# ── 4.5 companion 中继（浏览器执行面）：后台监督循环拉起 ──────────────────
# relay=用户浏览器扩展的 ws 接入腿 + mcp-browser 工具的 HTTP 后端。
# token：ETERNA_RELAY_TOKEN env 优先；缺省生成随机 token 落卷（重启不变），
# docker logs 提示路径。红线 9（中继鉴权）：生产必带 token。
RELAY_TOKEN="${ETERNA_RELAY_TOKEN:-}"
if [ -z "$RELAY_TOKEN" ]; then
  TOKEN_FILE="$DSH_HOME/relay-token"
  if [ -f "$TOKEN_FILE" ]; then
    RELAY_TOKEN="$(cat "$TOKEN_FILE")"
  else
    RELAY_TOKEN="rl-$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    printf '%s' "$RELAY_TOKEN" > "$TOKEN_FILE"
    chmod 600 "$TOKEN_FILE"
  fi
fi
# 用户令牌清单（access /access/api/companion 按用户生成，relay 直读校验；
# 文件缺省不存在=仅主 token 有效）。mcp-browser 的容器内凭据同源渲染进 patch。
TOKENS_FILE="$DSH_HOME/access/companion-tokens.json"
RELAY_ARGS="start --host 0.0.0.0 --port 9310 --token $RELAY_TOKEN --tokens-file $TOKENS_FILE --zip /repo/packages/extension-companion/eterna-companion.zip"
if [ -n "${ETERNA_RELAY_PUBLIC_URL:-}" ]; then
  RELAY_ARGS="$RELAY_ARGS --public-ws-url $ETERNA_RELAY_PUBLIC_URL"
fi

# patch 渲染期 mcp-browser env 的容器内凭据（LLM base 渲染在步骤 2，token 生成在其后的
# 4.5 段——故此处对已落卷的 patch 做第二遍 sed 替换占位）
sed -i "s|__ETERNA_RELAY_TOKEN__|$RELAY_TOKEN|g" "$PROFILE_DIR/cordis.patch.yml"
(
  while true; do
    node /repo/packages/browser-relay/dist/cli.mjs $RELAY_ARGS || true
    sleep 2
  done
) &
if [ -n "${ETERNA_RELAY_TOKEN:-}" ]; then
  log "[entrypoint] companion relay 后台启动 :9310（token=env 注入；publicWsUrl=${ETERNA_RELAY_PUBLIC_URL:-未设（guide 按本机默认展示）}）"
else
  log "[entrypoint] companion relay 后台启动 :9310（token 已生成落卷 $DSH_HOME/relay-token；publicWsUrl=${ETERNA_RELAY_PUBLIC_URL:-未设（guide 按本机默认展示）}）"
fi

# ── 5. 启动(--host 拒通配:解析容器具体地址) ────────────────────────────
IP="$(hostname -i | awk '{print $1}')"
# profile 名随形态取值(40 号 S-5:super 容器 boot eterna-super——容器探针实测硬编码
# eterna-web 时 super 形态 fresh 卷直接 "profile does not exist" 拒启;启动机制本身
# --host/--port/--no-open 与 public-url/trusted-host 处理逐字不变)。
set -- --profile "$PROFILE_NAME" --host "$IP" --port 8080 --no-open
if [ -n "${ETERNA_PUBLIC_URL:-}" ]; then
  set -- "$@" --public-url "$ETERNA_PUBLIC_URL"
fi
if [ -n "${ETERNA_TRUSTED_HOST:-}" ]; then
  for host in $ETERNA_TRUSTED_HOST; do
    set -- "$@" --trusted-host "$host"
  done
fi

log "[entrypoint] container IP: $IP  LLM: 三家直连(deepseek/mimo/glm,P2 网关)"

probe_sandbox

exec dsh "$@"