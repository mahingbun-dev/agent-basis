#!/usr/bin/env bash
# RC5-DATA-010：回滚演练（48 §7.6；51 DATA-010）。
# 停新容器 → 旧镜像(0.1.51) + 旧卷副本(p6b-e5b，rc.5 从未触碰) → 旧版本可用；
# 再起新容器 → 新根无二次损坏。全程独立容器/独立端口，绝不触碰生产 eterna-agent。
set -u
cd /Users/sunny/code/agent-basis-rc5 || exit 1
source artifacts/rc5/DATA/_tools/record.sh

CASE="$PWD/artifacts/rc5/DATA/RC5-DATA-010"
ROOT="$HOME/eterna-data/test-rc5"
OLD_ROOT="$ROOT/p6b-e5b"      # 旧卷副本：冷备解包的 rsync 副本，rc.5 从未启动过
NEW_ROOT="$ROOT/p6b-e5a"      # 新根：rc.5 已迁移并运行
TOOLS="$PWD/artifacts/rc5/DATA/_tools"
mkdir -p "$CASE"
case_init "$CASE"
PASS=0; FAIL=0
chk() { if assert_line "$CASE" "$1" "$2" "$3"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi; }

ENVF="$ROOT/.env.p6b-old"
cat > "$ENVF" <<'EOF'
MIMO_API_KEY=p6b-dummy-not-a-credential
DEEPSEEK_API_KEY=p6b-dummy-not-a-credential
ETERNA_FORM=super
DSH_HOME=/data
DSH_AGENTS_HOME=/data/agents
EOF
chmod 600 "$ENVF"

record_note "旧镜像 $(docker image inspect eterna-agent:0.1.51 --format '{{.Id}}')"
record_note "新镜像 $(docker image inspect eterna-agent:rc5-test --format '{{.Id}}')"

# 回滚前新根快照（比对基线）
docker run --rm --network none -v "$NEW_ROOT:/data:ro" -v "$TOOLS:/tools:ro" \
  eterna-agent:rc5-test node /tools/snapshot-data.mjs /data > "$CASE/new-before-rollback.json" 2>&1

# 1) 停新容器
record "停新容器 eterna-rc5-p6b-a" -- docker stop -t 60 eterna-rc5-p6b-a
chk "新容器已停" "$(docker inspect eterna-rc5-p6b-a --format '{{.State.Running}}')" "false"

# 2) 旧镜像 + 旧卷副本（直接 docker run，不挂 rc.5 compose 的模板，模拟旧 compose）
docker rm -f eterna-rc5-p6b-old >/dev/null 2>&1 || true
record "起旧容器（0.1.51 + 旧卷副本）" -- docker run -d --name eterna-rc5-p6b-old \
  --env-file "$ENVF" -v "$OLD_ROOT:/data" -p 3231:8080 -p 9331:9310 \
  --restart no eterna-agent:0.1.51
OLD_START=$?
chk "旧容器启动 EXIT=0" "$OLD_START" "0"

OLD_HEALTH="unknown"
for i in $(seq 1 60); do
  OLD_HEALTH="$(docker inspect eterna-rc5-p6b-old --format '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{else}}nohc{{end}}')"
  case "$OLD_HEALTH" in running/healthy|running/nohc|exited*) break ;; esac
  sleep 2
done
record_note "旧容器状态: $OLD_HEALTH"
chk "旧容器 running" "$(printf '%s' "$OLD_HEALTH" | cut -d/ -f1)" "running"

record "旧版本 GET /login" -- sh -c "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3231/login"
record "旧版本 GET /access/api/me" -- sh -c "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3231/access/api/me"
chk "旧版本 /login 返回 200" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3231/login)" "200"
chk "旧版本匿名 /access/api/me 返回 401" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3231/access/api/me)" "401"
chk "旧版本中继 /api/status 200" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:9331/api/status)" "200"

docker logs eterna-rc5-p6b-old 2>&1 | sed -E 's/token=[A-Za-z0-9_-]+/token=<redacted>/' > "$CASE/old-container.log"
record_note "旧容器日志行数 $(wc -l < "$CASE/old-container.log" | tr -d ' ')"
record "旧版本会话数据可见（旧卷副本快照）" -- sh -c \
  "docker run --rm --network none -v '$OLD_ROOT:/data:ro' -v '$TOOLS:/tools:ro' eterna-agent:rc5-test node /tools/snapshot-data.mjs /data > '$CASE/old-volume-after-boot.json' 2>&1 || true"

OLD_USERS="$(python3 -c 'import json;print(json.load(open("'"$CASE"'/old-volume-after-boot.json"))["db"]["users"])')"
OLD_SESSIONS="$(python3 -c 'import json;print(json.load(open("'"$CASE"'/old-volume-after-boot.json"))["db"]["accessSessions"])')"
chk "旧卷副本用户=2" "$OLD_USERS" "2"
chk "旧卷副本会话=145" "$OLD_SESSIONS" "145"

record "停旧容器" -- docker stop -t 60 eterna-rc5-p6b-old

# 3) 旧卷副本全库一致性（旧版本运行后无损坏）
docker run --rm --network none -v "$OLD_ROOT:/src:ro" -v "$TOOLS:/tools:ro" \
  eterna-agent:rc5-test node /tools/check-sqlite.mjs /src --copy > "$CASE/old-volume-integrity.json" 2>&1
RC_OLD_INT=$?
chk "旧卷副本全库 integrity_check" "$RC_OLD_INT" "0"

# 4) 起回新容器 → 新根无二次损坏
record "起回新容器 eterna-rc5-p6b-a" -- docker start eterna-rc5-p6b-a
NEW_HEALTH="unknown"
for i in $(seq 1 60); do
  NEW_HEALTH="$(docker inspect eterna-rc5-p6b-a --format '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{else}}nohc{{end}}')"
  [ "$NEW_HEALTH" = "running/healthy" ] && break
  sleep 2
done
record_note "新容器状态: $NEW_HEALTH"
chk "新容器恢复 healthy" "$NEW_HEALTH" "running/healthy"
chk "新版本 /login 200" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3230/login)" "200"

docker run --rm --network none -v "$NEW_ROOT:/data:ro" -v "$TOOLS:/tools:ro" \
  eterna-agent:rc5-test node /tools/snapshot-data.mjs /data > "$CASE/new-after-rollback.json" 2>&1
docker run --rm --network none -v "$NEW_ROOT:/src:ro" -v "$TOOLS:/tools:ro" \
  eterna-agent:rc5-test node /tools/check-sqlite.mjs /src --copy > "$CASE/new-after-rollback-integrity.json" 2>&1
RC_NEW_INT=$?
chk "新根全库 integrity_check（回滚往返后）" "$RC_NEW_INT" "0"
python3 - "$CASE" <<'PY' > "$CASE/compare.txt"
import json,sys
a=json.load(open(sys.argv[1]+'/new-before-rollback.json'))
b=json.load(open(sys.argv[1]+'/new-after-rollback.json'))
same_db = a['db']==b['db']
same_secret = a['secretFiles']==b['secretFiles']
same_storages = a['storages']==b['storages']
same_sessions_count = a['sessions']['files']==b['sessions']['files']
same_files = a['files']==b['files']
print('db', same_db); print('secretFiles', same_secret); print('storages', same_storages)
print('sessions.files', same_sessions_count, a['sessions']['files'], b['sessions']['files'])
print('files', same_files, a['files'], b['files'])
print('db values', a['db'], b['db'])
PY
cat "$CASE/compare.txt" >> "$CASE/cmd.log"
chk "往返后 DB 行数完全一致" "$(grep -c '^db True' "$CASE/compare.txt")" "1"
chk "往返后 relay-token/凭据指纹一致" "$(grep -c '^secretFiles True' "$CASE/compare.txt")" "1"
chk "往返后 storages 文件数一致" "$(grep -c '^storages True' "$CASE/compare.txt")" "1"
chk "往返后 sessions 文件数一致" "$(grep -c '^sessions.files True' "$CASE/compare.txt")" "1"
chk "往返后总文件数一致" "$(grep -c '^files True' "$CASE/compare.txt")" "1"

record_note "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1