#!/usr/bin/env bash
# T50 自检重放：只读 evidence，仅写 artifacts/rc5/**（矩阵、阶段 summary、本目录证据）。
# 用法（在 worktree 根）：bash artifacts/rc5/p6a/run-t50-verify.sh > artifacts/rc5/p6a/scan-cmd.log 2>&1
# 输出每一行 `$ 命令` 后紧跟真实 stdout/stderr 与 `EXIT=<码>`；不做任何伪造。
set -u
ROOT=/Users/sunny/code/agent-basis-rc5
cd "$ROOT" || { echo "FATAL: cannot cd $ROOT"; exit 2; }

echo "# T50 验收矩阵汇编 — 实跑命令与 EXIT"
echo "# worktree=$ROOT branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) head=$(git rev-parse HEAD 2>/dev/null)"
echo "# generatedAt=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "# boundary: 未 git push/merge；未停改生产容器；未写 deepseek-harness；未触碰 /Users/sunny/code/agent-basis；仅写 artifacts/rc5/**"
echo

run() {
  local rc
  echo "\$ $*"
  "$@"
  rc=$?
  echo "EXIT=$rc"
  echo
  return $rc
}

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cp artifacts/rc5/p0/summary.json "$TMP/p0-before.json"
cp artifacts/rc5/p6b/summary.json "$TMP/p6b-before.json"
shasum artifacts/rc5/p6a/pre-merge-backup/*.json > "$TMP/backups.sha"

echo "== 1. 重放汇编脚本（幂等：重跑后矩阵/断言/脱敏扫描重新生成） =="
run node artifacts/rc5/p6a/scan-matrix.mjs

echo "== 2. 幂等核对：重跑不得改动已合并的 p0/p6b summary 与 pre-merge 备份 =="
run cmp "$TMP/p0-before.json" artifacts/rc5/p0/summary.json
run cmp "$TMP/p6b-before.json" artifacts/rc5/p6b/summary.json
run shasum -c "$TMP/backups.sha"

echo "== 3. 独立自检（矩阵行数/唯一 ID/状态分布/阶段 summary 键/浸泡窗口/脱敏） =="
echo "\$ node artifacts/rc5/p6a/verify-matrix.mjs"
VERIFY_OUT=$(node artifacts/rc5/p6a/verify-matrix.mjs)
VERIFY_RC=$?
echo "$VERIFY_OUT"
echo "EXIT=$VERIFY_RC"
echo

echo "== 4. 产出清单与关键痕迹 =="
run ls -l artifacts/rc5/p6a
run wc -l artifacts/rc5/acceptance-matrix.md artifacts/rc5/p6a/assertions.log artifacts/rc5/p6a/secret-scan.log
run head -n 24 artifacts/rc5/acceptance-matrix.md
run cat artifacts/rc5/p6a/secret-scan.log
run cat artifacts/rc5/p6a/soak-window.json
run git status --short artifacts/rc5

echo "T50_SELFTEST=$([ "$VERIFY_RC" -eq 0 ] && echo PASS || echo FAIL)"
exit "$VERIFY_RC"