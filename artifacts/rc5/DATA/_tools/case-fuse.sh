#!/usr/bin/env bash
# FUSE 声明检查（48 §4.5 / §9）：宿主 bind（Docker Desktop macOS = virtiofs/fuseblk）
# 上的文件系统类型、chmod/chown 语义、flock、硬链接，以及 SQLite WAL 并发/崩溃恢复。
set -u
cd /Users/sunny/code/agent-basis-rc5 || exit 1
source artifacts/rc5/DATA/_tools/record.sh

CASE="$PWD/artifacts/rc5/DATA/FUSE"
SCRATCH="$HOME/eterna-data/test-rc5/.p6b-fuse"
TOOLS="$PWD/artifacts/rc5/DATA/_tools"
mkdir -p "$CASE" "$SCRATCH/data"
case_init "$CASE"
PASS=0; FAIL=0
chk() { if assert_line "$CASE" "$1" "$2" "$3"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi; }

INCONTAINER='
echo "== mount info =="
grep " /data " /proc/mounts
echo "== fs type =="
stat -f -c "data=%T" /data
stat -f -c "tmp=%T" /tmp
stat -f -c "rootfs=%T" /
echo "== 权限/属主/硬链接（容器内创建） =="
mkdir -p /data/fuse/perm
umask 000
printf a > /data/fuse/perm/f600; chmod 600 /data/fuse/perm/f600
printf b > /data/fuse/perm/f644; chmod 644 /data/fuse/perm/f644
mkdir -p /data/fuse/perm/d700; chmod 700 /data/fuse/perm/d700
printf c > /data/fuse/perm/f-owned; chown 1000:1000 /data/fuse/perm/f-owned; echo "chown_rc=$?"
printf d > /data/fuse/perm/hl-a; ln /data/fuse/perm/hl-a /data/fuse/perm/hl-b; echo "ln_rc=$?"
stat -c "%a %u %g %i %n" /data/fuse/perm/f600 /data/fuse/perm/f644 /data/fuse/perm/d700 /data/fuse/perm/f-owned /data/fuse/perm/hl-a /data/fuse/perm/hl-b
echo "== flock =="
mkdir -p /data/fuse/lock
flock -n /data/fuse/lock/l1 -c "echo first-acquired"; echo "first_rc=$?"
( flock -n /data/fuse/lock/l1 -c "sleep 2" ) &
sleep 0.4
flock -n /data/fuse/lock/l1 -c "echo second-acquired"; echo "second_rc=$?"
wait
echo "== overlayfs 对照（容器层 /tmp） =="
mkdir -p /tmp/fuse/perm
umask 000
printf a > /tmp/fuse/perm/f600; chmod 600 /tmp/fuse/perm/f600
stat -c "%a %u %g %n" /tmp/fuse/perm/f600
'
record "容器内 FUSE 语义探针" -- docker run --rm --network none \
  -v "$SCRATCH/data:/data" -v "$TOOLS:/tools:ro" \
  eterna-agent:rc5-test sh -c "$INCONTAINER"

# 宿主侧视角：容器内 chmod/chown 是否落到宿主（48 §9「不落宿主」声明）
LS_HOST="$(stat -f '%Sp %Su:%Sg %i %N' "$SCRATCH/data/fuse/perm/"* 2>/dev/null)"
printf '%s\n' "$LS_HOST" >> "$CASE/cmd.log"
HOST600="$(stat -f '%Lp' "$SCRATCH/data/fuse/perm/f600")"
HOST700="$(stat -f '%Lp' "$SCRATCH/data/fuse/perm/d700")"
HOST_OWNER="$(stat -f '%Su' "$SCRATCH/data/fuse/perm/f-owned")"
HOST_HL_INODES="$(stat -f '%i' "$SCRATCH/data/fuse/perm/hl-a")/$(stat -f '%i' "$SCRATCH/data/fuse/perm/hl-b")"
chk "宿主侧 f600 权限=600（chmod 落宿主）" "$HOST600" "600"
chk "宿主侧 d700 权限=700" "$HOST700" "700"
chk "宿主侧 hl-a/hl-b 同 inode（硬链接落宿主）" "$( [ "$(stat -f '%i' "$SCRATCH/data/fuse/perm/hl-a")" = "$(stat -f '%i' "$SCRATCH/data/fuse/perm/hl-b")" ] && echo same || echo differ )" "same"
record_note "宿主侧 f-owned 属主=${HOST_OWNER}（容器内 chown 1000:1000；macOS virtiofs 不映射 uid）"

# SQLite WAL 并发 + 崩溃恢复：bind（FUSE）vs overlayfs 对照
record "FUSE(bind) SQLite WAL 8×200 并发 + 崩溃恢复" -- docker run --rm --network none \
  -v "$SCRATCH/data:/data" -v "$TOOLS:/tools:ro" \
  eterna-agent:rc5-test node /tools/fuse-sqlite-stress.mjs /data/fuse-stress --writers 8 --ops 200
RC_BIND=$?
record "overlayfs 对照 SQLite WAL 8×200 并发 + 崩溃恢复" -- docker run --rm --network none \
  -v "$TOOLS:/tools:ro" \
  eterna-agent:rc5-test node /tools/fuse-sqlite-stress.mjs /tmp/overlay-stress --writers 8 --ops 200
RC_OVER=$?

# 解析两份 JSON（从 cmd.log 尾部提取较麻烦，直接以容器再跑一次轻量摘要？改为读命令输出文件）
# record 不落 stdout 文件，这里重跑并保存 JSON 到证据目录（同一测试，幂等）。
docker run --rm --network none -v "$SCRATCH/data:/data" -v "$TOOLS:/tools:ro" \
  eterna-agent:rc5-test node /tools/fuse-sqlite-stress.mjs /data/fuse-stress --writers 8 --ops 200 \
  > "$CASE/wal-bind.json" 2>&1
JRC_BIND=$?
docker run --rm --network none -v "$TOOLS:/tools:ro" \
  eterna-agent:rc5-test node /tools/fuse-sqlite-stress.mjs /tmp/overlay-stress --writers 8 --ops 200 \
  > "$CASE/wal-overlay.json" 2>&1
JRC_OVER=$?
chk "bind(FUSE) WAL 并发写全成功且 integrity/崩溃恢复 ok" "$JRC_BIND" "0"
chk "overlayfs 对照 WAL 并发写全成功且 integrity ok" "$JRC_OVER" "0"

# 生产 DB 的日志模式与容器日志锁异常计数（DATA-009 面）
record "E1 容器日志 database is locked/SQLITE_BUSY 计数（全量）" -- sh -c \
  "docker logs eterna-rc5-e1 2>&1 | grep -c -E 'database is locked|SQLITE_BUSY' || true"
record_note "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1