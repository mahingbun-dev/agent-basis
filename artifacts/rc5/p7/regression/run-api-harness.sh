#!/usr/bin/env bash
# T52 复跑：RC5-API-005/006/007（P0）容器内真宿主 harness。
# 与 W5 相同命令，仅补 `mkdir -p /tmp/api-harness`（重建后的容器没有该目录）。
set -u
ROOT=/Users/sunny/code/agent-basis-rc5
OUT=$ROOT/artifacts/rc5/p7/regression/rerun/API
C=eterna-rc5-e1
cd "$ROOT" || exit 2
mkdir -p "$OUT"

echo "# T52 API-005/006/007 harness — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo

run() { echo "\$ $*"; "$@"; local rc=$?; echo "EXIT=$rc"; echo; return $rc; }

run docker exec "$C" mkdir -p /tmp/api-harness
run docker cp artifacts/rc5/API/_harness/index.js "$C":/tmp/api-harness/index.js
run docker cp artifacts/rc5/API/_harness/package.json "$C":/tmp/api-harness/package.json
run docker cp artifacts/rc5/API/_harness/run-api005-007.sh "$C":/tmp/run-api005-007.sh
run docker exec "$C" sh /tmp/run-api005-007.sh
HARNESS_EXIT=$?
echo "HARNESS_EXIT=$HARNESS_EXIT"
run docker cp "$C":/tmp/api-run-home/out "$OUT/out"
run docker exec "$C" sh -c 'ls -l /tmp/api-run-home/out 2>/dev/null | head -20'
exit "$HARNESS_EXIT"