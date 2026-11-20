#!/usr/bin/env bash
# RC5-DATA-001：deploy/init-data-dirs.sh 幂等、根/实例根 0700、子目录齐全 + 负控。
# 51 §3.14 DATA-001；48 §6.4/§9/§10。
set -u
cd /Users/sunny/code/agent-basis-rc5 || exit 1
source artifacts/rc5/DATA/_tools/record.sh

CASE="$PWD/artifacts/rc5/DATA/RC5-DATA-001"
SCRATCH="$HOME/eterna-data/test-rc5/.p6b-data001"
rm -rf "$SCRATCH"
mkdir -p "$SCRATCH"
case_init "$CASE"

# 期望子目录（逐字来自 deploy/init-data-dirs.sh:69 SUBDIRS）
SUBDIRS=".eterna access agents attachments cache logs market memory-distill office-kit profiles sessions storages workspaces eterna-prompt-studio knowledge-admin knowledge.wiki"

record "first run" -- env ETERNA_DATA_ROOT="$SCRATCH/root" bash deploy/init-data-dirs.sh probe
record "second run (idempotency)" -- env ETERNA_DATA_ROOT="$SCRATCH/root" bash deploy/init-data-dirs.sh probe

snapshot() { # 路径+权限+inode（幂等性比对；不含文件内容/mtime）
  cd "$SCRATCH/root" && find . -print0 | LC_ALL=C sort -z | xargs -0 stat -f '%N %Sp %i' | sed "s|$SCRATCH/root||"
}
snapshot > "$CASE/tree-run1.txt"
snapshot > "$CASE/tree-run2.txt"

record_note "== 断言 =="
PASS=0; FAIL=0
chk() { if assert_line "$CASE" "$1" "$2" "$3"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi; }

chk "根目录 0700" "$(stat -f '%Lp' "$SCRATCH/root")" "700"
chk "实例根 0700" "$(stat -f '%Lp' "$SCRATCH/root/probe")" "700"
chk "backups 0700" "$(stat -f '%Lp' "$SCRATCH/root/backups")" "700"
chk "exports 0700" "$(stat -f '%Lp' "$SCRATCH/root/exports")" "700"

missing=""; badmode=""
for sub in $SUBDIRS; do
  if [ -d "$SCRATCH/root/probe/$sub" ]; then
    m="$(stat -f '%Lp' "$SCRATCH/root/probe/$sub")"
    [ "$m" = "700" ] || badmode="$badmode $sub=$m"
  else
    missing="$missing $sub"
  fi
done
chk "子目录齐全（16 个）" "$( [ -z "$missing" ] && echo ok || echo "missing:$missing" )" "ok"
chk "子目录权限均 0700" "$( [ -z "$badmode" ] && echo ok || echo "bad:$badmode" )" "ok"

# 幂等：第二次执行后树（路径/权限/inode）完全一致
if diff -q "$CASE/tree-run1.txt" "$CASE/tree-run2.txt" >/dev/null; then
  assert_line "$CASE" "二次执行树快照一致（幂等）" "identical" "identical"; PASS=$((PASS+1))
else
  assert_line "$CASE" "二次执行树快照一致（幂等）" "diff" "identical"; FAIL=$((FAIL+1))
  diff "$CASE/tree-run1.txt" "$CASE/tree-run2.txt" > "$CASE/tree-diff.txt" 2>&1
fi
record_note "tree entries: $(wc -l < "$CASE/tree-run1.txt" | tr -d ' ')"

# 负控（48 §6.4）：相对路径 / 符号链接根 / 非法实例名 / git 工作树内 → 非 0 且不创建
set +e
env ETERNA_DATA_ROOT="relative/path" bash deploy/init-data-dirs.sh probe > "$CASE/neg-relative.log" 2>&1
rc_rel=$?
ln -sfn "$SCRATCH/root" "$SCRATCH/link-root"
env ETERNA_DATA_ROOT="$SCRATCH/link-root" bash deploy/init-data-dirs.sh probe > "$CASE/neg-symlink.log" 2>&1
rc_link=$?
env ETERNA_DATA_ROOT="$SCRATCH/root" bash deploy/init-data-dirs.sh "../evil" > "$CASE/neg-instance.log" 2>&1
rc_inst=$?
env ETERNA_DATA_ROOT="$PWD/artifacts/rc5/DATA/_negcontrol-inrepo" bash deploy/init-data-dirs.sh probe > "$CASE/neg-inrepo.log" 2>&1
rc_git=$?
set -e
inrepo_exists="no"; [ -e "$PWD/artifacts/rc5/DATA/_negcontrol-inrepo" ] && inrepo_exists="yes"
chk "负控-相对路径被拒" "$( [ "$rc_rel" -ne 0 ] && echo rejected || echo accepted )" "rejected"
chk "负控-符号链接根被拒" "$( [ "$rc_link" -ne 0 ] && echo rejected || echo accepted )" "rejected"
chk "负控-越界实例名被拒" "$( [ "$rc_inst" -ne 0 ] && echo rejected || echo accepted )" "rejected"
chk "负控-git 工作树内被拒且未创建目录" "$( [ "$rc_git" -ne 0 ] && [ "$inrepo_exists" = "no" ] && echo rejected || echo "accepted/exists=$inrepo_exists" )" "rejected"

record_note "PASS=$PASS FAIL=$FAIL"
printf 'PASS=%d FAIL=%d\n' "$PASS" "$FAIL" > "$CASE/counts.txt"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1