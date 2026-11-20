#!/usr/bin/env bash
# 迁移演练：冷备 .tgz → staging（安全解包）→ rsync -aH → 新实例根。
# 用法: bash migrate-drill.sh <source.tgz> <instance> <evidence-dir> [test-root]
# 纪律：只写测试根（$HOME/eterna-data/test-rc5），绝不读生产在线数据根；
#       staging/目标已存在则拒绝（保证每遍是全新演练）。
set -euo pipefail

SRC="$1"; INSTANCE="$2"; EVID="$3"; ROOT="${4:-$HOME/eterna-data/test-rc5}"
mkdir -p "$EVID"
LOG="$EVID/cmd.log"
: >>"$LOG"

say() { printf '%s\n' "$*" | tee -a "$LOG"; }
run() { printf '$ %s\n' "$*" >>"$LOG"; "$@" 2>&1 | tee -a "$LOG"; local rc=${PIPESTATUS[0]}; printf 'EXIT=%d\n\n' "$rc" >>"$LOG"; return $rc; }

[ -f "$SRC" ] || { say "源不存在: $SRC"; exit 2; }
case "$INSTANCE" in ""|.|..|*/*) say "非法实例名: $INSTANCE"; exit 2 ;; esac

STAGING="$ROOT/.p6b-cold/$INSTANCE-$(basename "$SRC" .tgz)"
DEST="$ROOT/$INSTANCE"

if [ -e "$DEST" ] && [ -n "$(ls -A "$DEST" 2>/dev/null)" ]; then
  say "拒绝：目标已存在且非空 ${DEST}（每遍演练必须全新）"; exit 3
fi
if [ -e "$STAGING" ] && [ -n "$(ls -A "$STAGING" 2>/dev/null)" ]; then
  say "拒绝：staging 已存在且非空 $STAGING"; exit 3
fi

umask 077
mkdir -p "$ROOT/.p6b-cold" "$STAGING" "$DEST"
chmod 700 "$ROOT/.p6b-cold" "$STAGING" "$DEST"

say "== 1. 归档清单与安全性 =="
run sh -c "tar tzf '$SRC' > '$EVID/archive-entries.txt'"
TOTAL=$(wc -l < "$EVID/archive-entries.txt" | tr -d ' ')
UNSAFE=$(awk '/^\//{c++} /(^|\/)\.\.(\/|$)/{c++} END{print c+0}' "$EVID/archive-entries.txt")
say "entries=$TOTAL unsafe=$UNSAFE"
[ "$UNSAFE" = "0" ] || { say "归档含越界条目，拒绝解包"; exit 4; }

say "== 2. 解包到 staging =="
run tar xzf "$SRC" -C "$STAGING"

say "== 3. rsync -aH 复制到新实例根 =="
run rsync -aH --stats "$STAGING/" "$DEST/"

say "== 4. 源/副本统计（文件数/字节/硬链接组/符号链接） =="
stats() {
  local dir="$1"
  find "$dir" -type f -print0 2>/dev/null | xargs -0 stat -f '%z %i' 2>/dev/null | awk '
    { bytes += $1; files += 1; seen[$2] += 1 }
    END { groups = 0; for (i in seen) if (seen[i] > 1) groups += 1;
          printf "%d %d %d", files, bytes, groups }'
}
read -r S_FILES S_BYTES S_GROUPS <<<"$(stats "$STAGING")"
read -r D_FILES D_BYTES D_GROUPS <<<"$(stats "$DEST")"
S_LINKS=$(find "$STAGING" -type l | wc -l | tr -d ' ')
D_LINKS=$(find "$DEST" -type l | wc -l | tr -d ' ')
say "src files=$S_FILES bytes=$S_BYTES linkGroups=$S_GROUPS symlinks=$S_LINKS"
say "dst files=$D_FILES bytes=$D_BYTES linkGroups=$D_GROUPS symlinks=$D_LINKS"
cat > "$EVID/stats.json" <<EOF
{
  "source": "$STAGING",
  "dest": "$DEST",
  "src": {"files": $S_FILES, "bytes": $S_BYTES, "linkGroups": $S_GROUPS, "symlinks": $S_LINKS},
  "dst": {"files": $D_FILES, "bytes": $D_BYTES, "linkGroups": $D_GROUPS, "symlinks": $D_LINKS},
  "equal": $([ "$S_FILES" = "$D_FILES" ] && [ "$S_BYTES" = "$D_BYTES" ] && [ "$S_GROUPS" = "$D_GROUPS" ] && [ "$S_LINKS" = "$D_LINKS" ] && echo true || echo false)
}
EOF

if [ "$S_FILES" = "$D_FILES" ] && [ "$S_BYTES" = "$D_BYTES" ] && [ "$S_GROUPS" = "$D_GROUPS" ] && [ "$S_LINKS" = "$D_LINKS" ]; then
  say "ASSERT PASS | 迁移副本与源一致"
  exit 0
fi
say "ASSERT FAIL | 迁移副本与源不一致"
exit 1