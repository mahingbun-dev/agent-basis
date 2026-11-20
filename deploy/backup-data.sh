#!/usr/bin/env bash
# 数据根冷备（48 §6.5 / §8.1；54 §4.7 T45）。
#
# 语义：冷备 = 停容器 → tar czf → 起容器（SQLite WAL 一致性安全）。
# 热备（rsync，容忍 WAL 不一致）不在本脚本内——按 48 §8.1 用 rsync 手工执行。
#
# 用法：
#   bash deploy/backup-data.sh                 # 备份默认实例 super
#   bash deploy/backup-data.sh super-2         # 备份指定实例
#   SKIP_STOP=1 bash deploy/backup-data.sh     # 容器已是冷态（不执行 stop/start）
#
# 环境变量：
#   ETERNA_DATA_ROOT       宿主数据区根（缺省 $HOME/eterna-data）
#   ETERNA_INSTANCE        实例目录名（位置参数优先；缺省 super）
#   ETERNA_CONTAINER_NAME  容器名（缺省 eterna-agent；T43 参数化同源）
#   BACKUP_DIR             备份目录（缺省 $ETERNA_DATA_ROOT/backups）
#   STOP_TIMEOUT           docker stop 宽限秒数（缺省 60；有活动 turn 先跑 pre-restart-check）
#
# 排除项（48 §8.1/§3.1）：
#   - office-kit/outputs  临时转换产物，24h/512MB 自清理，无需备份；
#   - .pnpm-store         可重建（D5）。
# 备份包含全部敏感面（用户库/凭据/令牌），视同密钥：目录 0700、文件 0600；
# 传输/落盘加密与异地归档按 §8.1「归档」执行。脚本不打印任何密钥内容。
set -euo pipefail

ROOT="${ETERNA_DATA_ROOT:-$HOME/eterna-data}"
INSTANCE="${1:-${ETERNA_INSTANCE:-super}}"
CONTAINER="${ETERNA_CONTAINER_NAME:-eterna-agent}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
STOP_TIMEOUT="${STOP_TIMEOUT:-60}"

fail() { printf '[backup-data] %s\n' "$*" >&2; exit 1; }

case "$ROOT" in
  /*) ;;
  *) fail "ETERNA_DATA_ROOT 必须是绝对路径（当前: ${ROOT}）" ;;
esac
case "$INSTANCE" in
  ""|.|..|*/*) fail "非法实例名: '$INSTANCE'（必须是单层目录名）" ;;
esac

SRC="$ROOT/$INSTANCE"
[ -d "$SRC" ] || fail "实例根不存在: ${SRC}（先跑 deploy/init-data-dirs.sh ${INSTANCE} 或检查 ETERNA_DATA_ROOT）"

umask 077
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

TS="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/$INSTANCE-$TS.tgz"
[ -e "$OUT" ] && fail "备份目标已存在: $OUT"

STARTED=0
restart_container() {
  if [ "$STARTED" = 1 ]; then
    printf '[backup-data] 重启容器 %s\n' "$CONTAINER"
    if ! docker start "$CONTAINER" >/dev/null; then
      printf '[backup-data] WARNING 容器 %s 启动失败——请人工执行 docker start\n' "$CONTAINER" >&2
    fi
  fi
}
# 无论成功/失败（tar 断链、磁盘满）都把容器拉回来
trap restart_container EXIT

if [ "${SKIP_STOP:-0}" != "1" ]; then
  RUNNING="$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || printf 'false')"
  if [ "$RUNNING" = "true" ]; then
    printf '[backup-data] 停止容器（冷备）: %s\n' "$CONTAINER"
    docker stop -t "$STOP_TIMEOUT" "$CONTAINER" >/dev/null
    STARTED=1
  else
    printf '[backup-data] 容器 %s 未运行——直接归档（已是冷态）\n' "$CONTAINER"
  fi
else
  printf '[backup-data] SKIP_STOP=1：假定容器已是冷态，不执行 stop/start\n'
fi

printf '[backup-data] 归档: %s -> %s\n' "$SRC" "$OUT"
# -C + "." 保留目录结构与符号链接（48 §7.3 同口径：tar 保留符号链接）
tar czf "$OUT" -C "$SRC" \
  --exclude='./office-kit/outputs' \
  --exclude='./.pnpm-store' \
  .
chmod 600 "$OUT"

# 完整性与体积校验（不全量解包；只验证 gzip 流与可列出首层）
tar tzf "$OUT" >/dev/null
SIZE="$(du -h "$OUT" | cut -f1)"
COUNT="$(tar tzf "$OUT" | wc -l | tr -d ' ')"
printf '[backup-data] 校验 OK: %s 文件条目（%s）\n' "$COUNT" "$SIZE"
printf '[backup-data] 冷备完成: %s\n' "$OUT"