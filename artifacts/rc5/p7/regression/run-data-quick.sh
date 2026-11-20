#!/usr/bin/env bash
# T52 回归复跑 · DATA 快检（P0：DATA-001/002/003/006/007）。
# 目标容器 rc5-e1suite（3118，测试容器）；生产容器 eterna-agent 不触碰。
set -u
ROOT=/Users/sunny/code/agent-basis-rc5
OUT=$ROOT/artifacts/rc5/p7/regression/rerun/DATA
mkdir -p "$OUT"
cd "$ROOT" || exit 2
C=rc5-e1suite
FAILED=0
run() { echo "\$ $*"; "$@"; local rc=$?; echo "EXIT=$rc"; echo; return $rc; }

echo "# T52 DATA 快检 — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo

echo "== DATA-001 init-data-dirs 幂等 + 0700 =="
PROBE=/Users/sunny/eterna-data/test-20261120/p7-data001
rm -rf "$PROBE"
run env ETERNA_DATA_ROOT="$PROBE" bash deploy/init-data-dirs.sh p7probe || FAILED=1
run env ETERNA_DATA_ROOT="$PROBE" bash deploy/init-data-dirs.sh p7probe || FAILED=1
echo "\$ stat -c %a $PROBE / $PROBE/p7probe"
stat -c "%a %n" "$PROBE" "$PROBE/p7probe"
echo "ASSERT root-0700 $([ "$(stat -c %a "$PROBE")" = 700 ] && echo PASS || echo FAIL)"
echo "ASSERT instance-0700 $([ "$(stat -c %a "$PROBE/p7probe")" = 700 ] && echo PASS || echo FAIL)"
echo

echo "== DATA-002 E1 compose /data bind 测试数据根 =="
run docker inspect "$C" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}} ({{.Type}}){{end}}{{end}}'
MDATA=$(docker inspect "$C" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}')
echo "ASSERT bind=$MDATA expected=/Users/sunny/eterna-data/test-20261120/e1"
echo

echo "== DATA-003 容器内 DSH_HOME=/data =="
run docker exec "$C" sh -c 'printf %s "$DSH_HOME"'
echo

echo "== DATA-006 DSH_AGENTS_HOME=/data/agents =="
run docker exec "$C" sh -c 'printf %s "$DSH_AGENTS_HOME"'
run docker exec "$C" sh -c 'ls -ld /data/agents && stat -c "%a" /data/agents'
echo

echo "== DATA-007 重启后数据仍在（测试容器自身） =="
echo "\$ before: sessions / settings / memory 行数"
sqlite3 /Users/sunny/eterna-data/test-20261120/e1/access/users.db "select 'sessions', count(*) from sessions; select 'users', count(*) from users; select 'mcp_personal', count(*) from mcp_personal_server;"
ls -l /Users/sunny/eterna-data/test-20261120/e1/.eterna/memory.sqlite3 2>/dev/null | awk '{print "memory.sqlite3 bytes="$5}'
run docker restart "$C"
for i in $(seq 1 60); do H=$(docker inspect "$C" --format '{{.State.Health.Status}}'); [ "$H" = healthy ] && break; sleep 2; done
echo "health=$H"
echo "\$ after"
sqlite3 /Users/sunny/eterna-data/test-20261120/e1/access/users.db "select 'sessions', count(*) from sessions; select 'users', count(*) from users; select 'mcp_personal', count(*) from mcp_personal_server;"
CODE=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3118/login)
echo "GET /login -> $CODE"

echo "T52_DATA=$([ "$FAILED" -eq 0 ] && echo DONE || echo HAS_RED)"
exit "$FAILED"