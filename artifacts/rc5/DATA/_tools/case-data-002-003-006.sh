#!/usr/bin/env bash
# RC5-DATA-002/003/006：E1 compose bind 到测试根；容器内 DSH_HOME=/data；
# DSH_AGENTS_HOME=/data/agents；entrypoint 漏挂拒启（48 §6.1/§10）。
set -u
cd /Users/sunny/code/agent-basis-rc5 || exit 1
source artifacts/rc5/DATA/_tools/record.sh

CASE2="$PWD/artifacts/rc5/DATA/RC5-DATA-002"
CASE3="$PWD/artifacts/rc5/DATA/RC5-DATA-003"
CASE6="$PWD/artifacts/rc5/DATA/RC5-DATA-006"
SCRATCH="$HOME/eterna-data/test-rc5/.p6b-data002"
mkdir -p "$SCRATCH" "$CASE2" "$CASE3" "$CASE6"
case_init "$CASE2"; : > "$CASE3/cmd.log"; : > "$CASE6/cmd.log"
PASS=0; FAIL=0
chk() { local c="$1"; shift; if assert_line "$c" "$1" "$2" "$3"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi; }

record "inspect E1 mounts" -- docker inspect eterna-rc5-e1 --format '{{json .Mounts}}'
MOUNTS="$(docker inspect eterna-rc5-e1 --format '{{json .Mounts}}')"
DATA_SRC="$(printf '%s' "$MOUNTS" | python3 -c 'import json,sys; m=json.load(sys.stdin); print(next((x["Source"] for x in m if x["Destination"]=="/data"),""))')"
DATA_TYPE="$(printf '%s' "$MOUNTS" | python3 -c 'import json,sys; m=json.load(sys.stdin); print(next((x["Type"] for x in m if x["Destination"]=="/data"),""))')"
DATA_RW="$(printf '%s' "$MOUNTS" | python3 -c 'import json,sys; m=json.load(sys.stdin); print(next((str(x["RW"]) for x in m if x["Destination"]=="/data"),""))')"
record_note "parsed: source=$DATA_SRC type=$DATA_TYPE rw=$DATA_RW"
chk "$CASE2" "/data 绑定源为测试根 e1" "$DATA_SRC" "$HOME/eterna-data/test-rc5/e1"
chk "$CASE2" "/data 挂载类型为 bind" "$DATA_TYPE" "bind"
chk "$CASE2" "/data 读写挂载" "$DATA_RW" "True"

# compose config（只保留 volumes 段里 /data 相关行；不落 env 全量，避免凭据入证据）
docker compose --env-file "$HOME/eterna-data/test-rc5/.env.e1" -f docker-compose.yml config 2>"$CASE2/compose-config.err" \
  | grep -E 'source:|target: /data|type: bind|read_only' | head -20 > "$CASE2/compose-volumes.txt"
RC_COMPOSE=${PIPESTATUS[0]}
record_note "compose config EXIT=$RC_COMPOSE"
cat "$CASE2/compose-volumes.txt" >> "$CASE2/cmd.log"
grep -q "target: /data" "$CASE2/compose-volumes.txt" && grep -q "source: $HOME/eterna-data/test-rc5/e1" "$CASE2/compose-volumes.txt"
VC=$?
chk "$CASE2" "compose config 中 /data 为 bind 到测试根" "$([ $VC -eq 0 ] && echo ok || echo mismatch)" "ok"

# 缺省缺 ETERNA_DATA_ROOT 时的 compose 行为（W4 修复：不再 :? 硬必填）
COMPOSE_MIN="./docker-compose.yml"
env -u ETERNA_DATA_ROOT -u ETERNA_INSTANCE docker compose -f "$COMPOSE_MIN" config 2>"$CASE2/compose-default.err" \
  | grep -E 'target: /data' -B2 | head -5 > "$CASE2/compose-default.txt"
RC_DEFAULT=${PIPESTATUS[0]}
record_note "compose config without ETERNA_DATA_ROOT EXIT=${RC_DEFAULT}（缺省口径见 docker-compose.yml 头注）"
cat "$CASE2/compose-default.txt" >> "$CASE2/cmd.log"
chk "$CASE2" "无 ETERNA_DATA_ROOT 时 compose config 仍可用（W4 缺省口径）" "$RC_DEFAULT" "0"

# entrypoint 漏挂拒启（48 §6.1）：不给 /data 挂载点，必须 exit!=0 且日志含 FATAL
printf 'MIMO_API_KEY=p6b-dummy-not-a-credential\n' > "$SCRATCH/mimo.env"; chmod 600 "$SCRATCH/mimo.env"
set +e
docker run --rm --network none --env-file "$SCRATCH/mimo.env" eterna-agent:rc5-test \
  > "$CASE2/entrypoint-nodata.log" 2>&1
RC_NODATA=$?
set -e
record_note "entrypoint without /data mount EXIT=$RC_NODATA"
tail -5 "$CASE2/entrypoint-nodata.log" >> "$CASE2/cmd.log"
chk "$CASE2" "漏挂 /data 时 entrypoint 拒启（非 0）" "$RC_NODATA" "1"
grep -q "不是挂载点" "$CASE2/entrypoint-nodata.log"
G=$?
chk "$CASE2" "拒启日志含「不是挂载点」" "$([ $G -eq 0 ] && echo ok || echo missing)" "ok"

# DATA-003 / DATA-006：容器内环境变量
case_switch "$CASE3"
record "E1 DSH_HOME" -- docker exec eterna-rc5-e1 sh -c 'printf %s "$DSH_HOME"'
DSH="$(docker exec eterna-rc5-e1 sh -c 'printf %s "$DSH_HOME"')"
chk "$CASE3" "容器内 DSH_HOME=/data" "$DSH" "/data"
case_switch "$CASE6"
record "E1 DSH_AGENTS_HOME" -- docker exec eterna-rc5-e1 sh -c 'printf %s "$DSH_AGENTS_HOME"'
AG="$(docker exec eterna-rc5-e1 sh -c 'printf %s "$DSH_AGENTS_HOME"')"
chk "$CASE6" "容器内 DSH_AGENTS_HOME=/data/agents" "$AG" "/data/agents"
record "E1 /data/agents 目录" -- docker exec eterna-rc5-e1 sh -c 'ls -ld /data/agents && stat -c "%a" /data/agents'
chk "$CASE6" "容器内 /data/agents 存在" "$(docker exec eterna-rc5-e1 sh -c 'test -d /data/agents && echo yes || echo no')" "yes"
chk "$CASE6" "宿主侧 e1/agents 存在（/data 实为 bind）" "$( [ -d "$HOME/eterna-data/test-rc5/e1/agents" ] && echo yes || echo no )" "yes"
record_note "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1