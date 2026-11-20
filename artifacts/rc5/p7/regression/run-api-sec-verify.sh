#!/usr/bin/env bash
# T52 复跑：API-001..004 包 verify + 全仓 verify（ENV-007 / SEC-009）。
# 只读；日志落 artifacts/rc5/p7/regression/rerun/E2/SEC/_evidence/verify.log 与 logs/。
set -u
ROOT=/Users/sunny/code/agent-basis-rc5
OUT=$ROOT/artifacts/rc5/p7/regression
cd "$ROOT" || exit 2
mkdir -p "$OUT/rerun/E2/SEC/_evidence" "$OUT/rerun/logs"

run() { echo "\$ $*"; "$@"; local rc=$?; echo "EXIT=$rc"; echo; return $rc; }
FAILED=0

echo "# T52 API/SEC 单测复跑 — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo
echo "== API-001 compaction =="
run pnpm --filter @eterna/compaction verify > "$OUT/rerun/logs/API-001.log" 2>&1 || FAILED=1
tail -6 "$OUT/rerun/logs/API-001.log"
echo
echo "== API-002 memory =="
run pnpm --filter @eterna/memory verify > "$OUT/rerun/logs/API-002.log" 2>&1 || FAILED=1
tail -6 "$OUT/rerun/logs/API-002.log"
echo
echo "== API-003 llm-openai typecheck =="
run pnpm --filter @eterna/llm-openai typecheck > "$OUT/rerun/logs/API-003.log" 2>&1 || FAILED=1
tail -6 "$OUT/rerun/logs/API-003.log"
echo
echo "== API-004 tasks =="
run pnpm --filter @eterna/tasks verify > "$OUT/rerun/logs/API-004.log" 2>&1 || FAILED=1
tail -6 "$OUT/rerun/logs/API-004.log"
echo
echo "== ENV-007 / SEC-009 全仓 verify =="
echo "\$ pnpm -w run verify > $OUT/rerun/E2/SEC/_evidence/verify.log 2>&1"
pnpm -w run verify > "$OUT/rerun/E2/SEC/_evidence/verify.log" 2>&1
V=$?
echo "EXIT=$V"
echo "EXIT=$V" >> "$OUT/rerun/E2/SEC/_evidence/verify.log"
grep -E "Test Files|Tests  " "$OUT/rerun/E2/SEC/_evidence/verify.log" | tail -6
echo
echo "T52_VERIFY=$([ "$FAILED" -eq 0 ] && [ "$V" -eq 0 ] && echo ALL_GREEN || echo HAS_RED)"
exit $(( FAILED != 0 || V != 0 ))