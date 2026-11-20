#!/usr/bin/env bash
# 宿主数据区初始化（48 §6.4 / §10；54 §4.7 T45）。
#
# 职责：
#   - 默认根 ETERNA_DATA_ROOT="${ETERNA_DATA_ROOT:-$HOME/eterna-data}"（必须绝对路径）；
#   - install -d -m 0700 根 + 实例子目录；幂等（重复执行不改已有内容、只收紧权限）；
#   - 打印最终树供人工核对；
#   - 不写任何密钥内容；不把根目录纳入 git。
#
# 用法：
#   bash deploy/init-data-dirs.sh                 # 只建生产实例根 super
#   bash deploy/init-data-dirs.sh super super-2   # 生产 + 并存 super 实例
#   bash deploy/init-data-dirs.sh test-20261120   # E1 隔离测试实例(配 ETERNA_PORT=3108)
#
# 环境变量：
#   ETERNA_DATA_ROOT  宿主数据区根（缺省 $HOME/eterna-data）
#
# 设计与边界（48 §3.1/§9）：根 0700；实例目录互不共享（一个运行中实例一个根）；
# backups/、exports/ 在根下但不挂进容器；宿主上由运行 Docker 的用户执行。
set -euo pipefail

ROOT="${ETERNA_DATA_ROOT:-$HOME/eterna-data}"

fail() { printf '[init-data-dirs] %s\n' "$*" >&2; exit 1; }

# 绝对路径（48 §5.1：compose 只引用绝对路径，不引用相对路径）
case "$ROOT" in
  /*) ;;
  *) fail "ETERNA_DATA_ROOT 必须是绝对路径（当前: ${ROOT}）" ;;
esac
# 不跟随软链写入（避免把数据写到未知位置）
[ -L "$ROOT" ] && fail "ETERNA_DATA_ROOT 是符号链接，拒绝写入: $ROOT"

# 不纳入 git（48 §6.4）：根目录可能尚未创建，向上找最近的已存在祖先再判定
if command -v git >/dev/null 2>&1; then
  probe="$ROOT"
  while [ ! -d "$probe" ]; do
    parent="$(dirname "$probe")"
    [ "$parent" = "$probe" ] && break
    probe="$parent"
  done
  if git -C "$probe" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    fail "${ROOT} 位于 git 工作树内（${probe}）——数据根不得纳入版本控制（48 §6.4）"
  fi
fi

# 实例名：参数优先；缺省只建生产实例根 super（与 docker-compose.yml 默认 ETERNA_INSTANCE 一致）
INSTANCES=("$@")
if [ "${#INSTANCES[@]}" -eq 0 ]; then
  INSTANCES=(super)
fi
for inst in "${INSTANCES[@]}"; do
  case "$inst" in
    ""|.|..|*/*) fail "非法实例名: '$inst'（必须是单层目录名）" ;;
  esac
done

# 根与实例目录一律 0700（umask 兜底新文件；chmod 保证既有目录也被收紧）
umask 077
mkdir -p "$ROOT"
chmod 700 "$ROOT"
# 备份/导出在根下、不挂进容器（48 §3.1）
for extra in backups exports; do
  mkdir -p "$ROOT/$extra"
  chmod 700 "$ROOT/$extra"
done

# 实例子目录（48 §3.1 树）：rc.5 新增 agents/cache；office-kit 由 office 工具写。
# 预建可避免 Docker 以 root 在宿主侧新建目录（Linux binder 属主与模式不可控）。
SUBDIRS=".eterna access agents attachments cache logs market memory-distill office-kit profiles sessions storages workspaces eterna-prompt-studio knowledge-admin knowledge.wiki"

for inst in "${INSTANCES[@]}"; do
  dir="$ROOT/$inst"
  mkdir -p "$dir"
  chmod 700 "$dir"
  for sub in $SUBDIRS; do
    mkdir -p "$dir/$sub"
    chmod 700 "$dir/$sub"
  done
done

# 打印最终树（人工核对；不列文件内容）
printf '[init-data-dirs] 数据根: %s (0700)\n' "$ROOT"
printf '  %s\n' "$ROOT/backups" "$ROOT/exports"
for inst in "${INSTANCES[@]}"; do
  dir="$ROOT/$inst"
  printf '  %s/(0700)\n' "$dir"
  find "$dir" -mindepth 1 -maxdepth 1 -type d -print | LC_ALL=C sort | sed 's|^|    |'
done
printf '[init-data-dirs] OK —— 下一步: 设 .env 的 ETERNA_DATA_ROOT=%s 后 docker compose up -d\n' "$ROOT"