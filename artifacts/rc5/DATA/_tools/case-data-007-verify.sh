#!/usr/bin/env bash
# RC5-DATA-007：迁移副本起 rc.5 容器 → 重启前后数据面比对（51 DATA-007；48 §7.5）。
# 本脚本把此前实跑得到的 preboot/postboot/postrestart 快照做断言，并复核当前容器状态。
set -u
cd /Users/sunny/code/agent-basis-rc5 || exit 1
source artifacts/rc5/DATA/_tools/record.sh

CASE="$PWD/artifacts/rc5/DATA/RC5-DATA-007"
mkdir -p "$CASE"
case_switch "$CASE"
PASS=0; FAIL=0
chk() { if assert_line "$CASE" "$1" "$2" "$3"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi; }

record "容器状态（重启后）" -- docker inspect eterna-rc5-p6b-a --format 'status={{.State.Status}} health={{.State.Health.Status}} restarts={{.RestartCount}} image={{.Image}}'
record "容器 /data 挂载" -- docker inspect eterna-rc5-p6b-a --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}} ({{.Type}}){{end}}{{end}}'
record "重启后 GET /login" -- sh -c "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3230/login"
record "重启后 GET /access/api/me" -- sh -c "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3230/access/api/me"
record "重启后 GET / 重定向" -- sh -c "curl -s -o /dev/null -w '%{http_code} %{redirect_url}' http://127.0.0.1:3230/"
chk "容器 healthy" "$(docker inspect eterna-rc5-p6b-a --format '{{.State.Health.Status}}')" "healthy"
chk "容器 start 时间晚于创建时间（经历过 restart）" "$(python3 - <<'PY'
import subprocess,datetime
f=subprocess.run(['docker','inspect','eterna-rc5-p6b-a','--format','{{.Created}}|{{.State.StartedAt}}'],capture_output=True,text=True).stdout.strip()
c,s=f.split('|')
print('yes' if datetime.datetime.fromisoformat(s.replace('Z','+00:00'))>datetime.datetime.fromisoformat(c.replace('Z','+00:00')) else 'no')
PY
)" "yes"
chk "/login 200" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3230/login)" "200"
chk "匿名 /access/api/me 401" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3230/access/api/me)" "401"
chk "根路径 302→/login" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3230/)" "302"
chk "容器日志无 FATAL" "$(docker logs eterna-rc5-p6b-a 2>&1 | grep -c 'FATAL' || true)" "0"

python3 - "$CASE" <<'PY' >> "$CASE/cmd.log" 2>&1
import json,sys,os
case=sys.argv[1]
a=json.load(open(os.path.join(case,'preboot.json')))
b=json.load(open(os.path.join(case,'postboot.json')))
c=json.load(open(os.path.join(case,'postrestart.json')))
def chk(desc, actual, expected):
    st='PASS' if actual==expected else 'FAIL'
    print(f'ASSERT {st} | {desc} | actual={actual} expected={expected}')
    return 0 if st=='PASS' else 1
fail=0
fail+=chk('迁移启动后 users 行数不变', b['db']['users']==a['db']['users'], True)
fail+=chk('迁移启动后访问会话行数不变', b['db']['accessSessions']==a['db']['accessSessions'], True)
fail+=chk('迁移启动后工作区行数不变', b['db']['workspaces']==a['db']['workspaces'], True)
fail+=chk('迁移启动后记忆实体数不变', b['db']['memoryEntities']==a['db']['memoryEntities'], True)
fail+=chk('迁移启动后工作区记忆实体数不变', b['db']['workspaceMemoryEntities']==a['db']['workspaceMemoryEntities'], True)
fail+=chk('迁移启动后 sessions 文件数不变', b['sessions']['files']==a['sessions']['files'], True)
fail+=chk('迁移启动后 storages 文件数不变', b['storages']['files']==a['storages']['files'], True)
fail+=chk('迁移启动后 relay-token 指纹不变', b['secretFiles']==a['secretFiles'], True)
fail+=chk('重启后 DB 行数全部一致', c['db']==b['db'], True)
fail+=chk('重启后 sessions 文件数一致', c['sessions']['files']==b['sessions']['files'], True)
fail+=chk('重启后 storages 文件数一致', c['storages']['files']==b['storages']['files'], True)
fail+=chk('重启后 relay-token/凭据指纹一致', c['secretFiles']==b['secretFiles'], True)
fail+=chk('重启后 profile 文件指纹一致', c['profiles']==b['profiles'], True)
fail+=chk('重启后总文件数一致', c['files']==b['files'], True)
print('PY-ASSERT-FAILS=%d' % fail)
sys.exit(0 if fail==0 else 1)
PY
PYRC=$?
if [ "$PYRC" -eq 0 ]; then PASS=$((PASS+14)); else FAIL=$((FAIL+1)); fi

record_note "PASS=$PASS FAIL=${FAIL}（PY-ASSERT-FAILS 见 cmd.log）"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1