#!/usr/bin/env bash
# T52 回归复跑 · E0 静态批次（P0：ENV/ACC/SEC/UI/V1）。
# 只读：不改产品代码；输出落 artifacts/rc5/p7/regression/rerun/E0/**。
set -u
ROOT=/Users/sunny/code/agent-basis-rc5
OUT=$ROOT/artifacts/rc5/p7/regression/rerun/E0
mkdir -p "$OUT"
cd "$ROOT" || { echo "FATAL: cannot cd $ROOT"; exit 2; }

echo "# T52 E0 静态复跑 — 命令原文与 EXIT"
echo "# worktree=$ROOT head=$(git rev-parse HEAD) at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo

run() {
  echo "\$ $*"
  "$@"
  local rc=$?
  echo "EXIT=$rc"
  echo
  return $rc
}

FAILED=0

echo "== UI-001 lint-ui-tokens =="
run node scripts/lint-ui-tokens.mjs || FAILED=1

echo "== ENV-002/003 + API-008/009 verify-rc5-env --api-static =="
run node scripts/verify-rc5-env.mjs --api-static --json "$OUT/verify-rc5-env.json" || FAILED=1

echo "== ACC-001/002/003 packctl =="
run node tools/packctl/bin/packctl.mjs tenant-scan || FAILED=1
run node tools/packctl/bin/packctl.mjs prompt-scan || FAILED=1
run node tools/packctl/bin/packctl.mjs form-check || FAILED=1

echo "== SEC-001 跟踪文件凭据/运行态目录 =="
echo "\$ git ls-files | grep -Ei credential/runtime patterns"
git ls-files | grep -Ei "(^|/)\.eterna[-._]?[a-z]*home|(^|/)\.secrets(/|$)|(^|/)\.env($|\.)|(^|/)\.test-accounts" || echo "NO_TRACKED_MATCH"
echo "EXIT=$?"
echo

echo "== SEC-002 凭据扫描（脱敏输出） =="
run node artifacts/rc5/SEC/RC5-SEC-002/scan-secrets.mjs || FAILED=1

echo "== SEC-003 遥测 =="
run node artifacts/rc5/SEC/RC5-SEC-003/check-telemetry.mjs || FAILED=1

echo "== V1-001 源/清单跟踪 =="
run bash artifacts/rc5/V1/RC5-V1-001/check-tracked.sh || FAILED=1

echo "== V1-004 core/cordis test =="
run pnpm --filter @core/cordis test || FAILED=1

echo "== V1-005 core/runtime test + basis chat =="
run pnpm --filter @core/runtime test || FAILED=1
run node core/runtime/bin/basis.mjs chat --bundle basis.yml || FAILED=1

echo "T52_E0=$([ "$FAILED" -eq 0 ] && echo ALL_GREEN || echo HAS_RED)"
exit "$FAILED"