#!/usr/bin/env bash
# RC5-DATA-008：冷备 → 删除测试文件 → 恢复 演练（48 §8.1/§8.2；51 DATA-008）。
# 演练对象：迁移副本实例 p6b-e5a（测试根），容器 eterna-rc5-p6b-a。
# 两阶段：A) 走脚本内置 stop→tar→start（证明冷备链可用）；B) 容器冷态取样 +
# SKIP_STOP=1 备份 → 删除测试文件 → 空目录恢复 → 清单/内容/全库一致性比对。
set -u
cd /Users/sunny/code/agent-basis-rc5 || exit 1
source artifacts/rc5/DATA/_tools/record.sh

CASE="$PWD/artifacts/rc5/DATA/RC5-DATA-008"
ROOT="$HOME/eterna-data/test-rc5"
INSTANCE="p6b-e5a"
SRC="$ROOT/$INSTANCE"
RESTORE="$ROOT/p6b-restore"
BACKUP_DIR="$ROOT/.p6b-data008-backups"
TOOLS="$PWD/artifacts/rc5/DATA/_tools"
mkdir -p "$CASE" "$BACKUP_DIR"
case_init "$CASE"
PASS=0; FAIL=0
chk() { if assert_line "$CASE" "$1" "$2" "$3"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi; }

MARKER="$SRC/p6b-backup-marker.txt"
printf 'p6b marker %s payload=0123456789abcdef\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$MARKER"
chmod 600 "$MARKER"
MARKER_SHA="$(shasum -a 256 "$MARKER" | awk '{print $1}')"
record_note "marker sha256=$MARKER_SHA"

manifest() {
  local dir="$1"
  ( cd "$dir" && find . -type f \
      ! -path './office-kit/outputs/*' ! -path './.pnpm-store/*' \
      -print0 | LC_ALL=C sort -z | xargs -0 stat -f '%N|%z|%Lp' | sed 's|^\./||' )
}

# ── A) 脚本内置 stop → tar → start ─────────────────────────────────────
record "backup-data.sh 全链（内置 stop/start）" -- env ETERNA_DATA_ROOT="$ROOT" BACKUP_DIR="$BACKUP_DIR" \
  ETERNA_CONTAINER_NAME=eterna-rc5-p6b-a bash deploy/backup-data.sh "$INSTANCE"
RC_BACKUP=$?
chk "备份脚本 EXIT=0" "$RC_BACKUP" "0"
TGZ_A=$(ls -t "$BACKUP_DIR"/*.tgz 2>/dev/null | head -1)
[ -n "$TGZ_A" ] && chk "备份文件存在" "yes" "yes" || chk "备份文件存在" "no" "yes"
chk "备份包权限 0600" "$(stat -f '%Lp' "$TGZ_A")" "600"
chk "备份目录权限 0700" "$(stat -f '%Lp' "$BACKUP_DIR")" "700"
record "tar tzf 校验（条目数）" -- sh -c "tar tzf '$TGZ_A' | wc -l"
chk "包内含 marker" "$(tar tzf "$TGZ_A" | grep -c 'p6b-backup-marker.txt')" "1"
chk "包内不含 office-kit/outputs" "$(tar tzf "$TGZ_A" | grep -c '^\./office-kit/outputs/' || true)" "0"
chk "包内不含 .pnpm-store" "$(tar tzf "$TGZ_A" | grep -c '^\./\.pnpm-store/' || true)" "0"
chk "脚本已把容器重新启动" "$(docker inspect eterna-rc5-p6b-a --format '{{.State.Running}}')" "true"
record "容器健康（脚本 restart 后）" -- sh -c "docker inspect eterna-rc5-p6b-a --format '{{.State.Status}}/{{.State.Health.Status}}'"

# ── B) 冷态确定性备份 → 删除 → 恢复 ───────────────────────────────────
record "docker stop（取冷态基线）" -- docker stop -t 60 eterna-rc5-p6b-a
manifest "$SRC" > "$CASE/manifest-before.txt"
BEFORE_FILES=$(wc -l < "$CASE/manifest-before.txt" | tr -d ' ')
record_note "冷态基线文件数=${BEFORE_FILES}（排除 office-kit/outputs 与 .pnpm-store）"

record "SKIP_STOP=1 backup-data.sh（冷态归档）" -- env SKIP_STOP=1 ETERNA_DATA_ROOT="$ROOT" BACKUP_DIR="$BACKUP_DIR" \
  ETERNA_CONTAINER_NAME=eterna-rc5-p6b-a bash deploy/backup-data.sh "$INSTANCE"
TGZ=$(ls -t "$BACKUP_DIR"/*.tgz 2>/dev/null | head -1)
record_note "用于恢复的归档: ${TGZ}（sha256 $(shasum -a 256 "$TGZ" | awk '{print $1}')）"
record "docker start（恢复容器运行）" -- docker start eterna-rc5-p6b-a

rm -f "$MARKER"
chk "测试文件已删除" "$( [ -e "$MARKER" ] && echo exists || echo deleted )" "deleted"

rm -rf "$RESTORE"; mkdir -p "$RESTORE"; chmod 700 "$RESTORE"
record "tar xzf 恢复到空目录" -- sh -c "tar xzf '$TGZ' -C '$RESTORE'"
RC_RESTORE=$?
chk "恢复解包 EXIT=0" "$RC_RESTORE" "0"
chk "恢复后 marker 内容一致" "$(shasum -a 256 "$RESTORE/p6b-backup-marker.txt" 2>/dev/null | awk '{print $1}')" "$MARKER_SHA"

manifest "$RESTORE" > "$CASE/manifest-restored.txt"
if diff -q "$CASE/manifest-before.txt" "$CASE/manifest-restored.txt" >/dev/null; then
  assert_line "$CASE" "恢复后清单（路径|大小|权限）与备份前一致" "identical ($BEFORE_FILES files)" "identical ($BEFORE_FILES files)"
  PASS=$((PASS+1))
else
  assert_line "$CASE" "恢复后清单（路径|大小|权限）与备份前一致" "diff" "identical"; FAIL=$((FAIL+1))
  diff "$CASE/manifest-before.txt" "$CASE/manifest-restored.txt" > "$CASE/manifest-diff.txt" 2>&1
fi

docker run --rm --network none -v "$RESTORE:/src:ro" -v "$TOOLS:/tools:ro" \
  eterna-agent:rc5-test node /tools/check-sqlite.mjs /src --copy \
  > "$CASE/restore-integrity.json" 2>&1
RC_INT=$?
chk "恢复副本全库 integrity_check" "$RC_INT" "0"
chk "恢复副本 DB 数 = 16（源 17 − 备份排除项 .pnpm-store/v11/index.db）" "$(python3 -c 'import json;print(json.load(open("'"$CASE"'/restore-integrity.json"))["checked"])')" "16"
chk "被排除的库不含 .pnpm-store（备份口径）" "$(python3 - "$CASE" <<'PY'
import json,sys,os
d=json.load(open(os.path.join(sys.argv[1],'restore-integrity.json')))
paths={x['path'] for x in d['dbs']}
print('yes' if not any(p.startswith('.pnpm-store/') for p in paths) else 'no')
PY
)" "yes"

record_note "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1