#!/usr/bin/env bash
# RC5-DATA-005：迁移副本全库 PRAGMA integrity_check（48 §7.5；51 §3.14）。
# 在 rc.5 镜像容器内用 node:sqlite 检查；源目录只读挂载，DB(+wal/shm) 复制到 /tmp 再开。
set -u
cd /Users/sunny/code/agent-basis-rc5 || exit 1
source artifacts/rc5/DATA/_tools/record.sh

CASE="$PWD/artifacts/rc5/DATA/RC5-DATA-005"
mkdir -p "$CASE"
case_init "$CASE"
TOOLS="$PWD/artifacts/rc5/DATA/_tools"
TEST_ROOT="$HOME/eterna-data/test-rc5"

check_root() { # check_root <name> <host-root>
  local name="$1" root="$2"
  docker run --rm --network none \
    -v "$root:/src:ro" -v "$TOOLS:/tools:ro" \
    eterna-agent:rc5-test node /tools/check-sqlite.mjs /src --copy \
    > "$CASE/$name.json" 2> "$CASE/$name.err"
  local rc=$?
  python3 - "$CASE/$name.json" "$name" "$root" "$rc" <<'PY'
import json,sys
path,name,root,rc=sys.argv[1],sys.argv[2],sys.argv[3],sys.argv[4]
try:
    d=json.load(open(path))
    print(f"{name}: checked={d['checked']} ok={d['ok']} fail={d['fail']} rc={rc}")
    for x in d['dbs']:
        print(f"  {x['integrity']:6} {x.get('journal','?'):8} {x['path']}")
except Exception as e:
    print(f"{name}: report unreadable ({e}) rc={rc}")
PY
}

record "drill-1 全库 integrity_check" -- check_root drill1 "$TEST_ROOT/p6b-e5a"
record "drill-2 全库 integrity_check" -- check_root drill2 "$TEST_ROOT/p6b-e5b"
record "P5 e5（既有迁移副本）全库 integrity_check" -- check_root p5-e5 "$TEST_ROOT/e5"
record "冷备解包 staging 全库 integrity_check" -- check_root staging1 "$TEST_ROOT/.p6b-cold/p6b-e5a-eterna-home-20261120-021802"

# 汇总断言：四份都 checked>0 且 fail=0
python3 - "$CASE" <<'PY'
import json, sys, os
case = sys.argv[1]
rows = []
for name in ['drill1','drill2','p5-e5','staging1']:
    p = os.path.join(case, f'{name}.json')
    try:
        d = json.load(open(p)); rows.append((name, d['checked'], d['fail']))
    except Exception:
        rows.append((name, -1, -1))
bad = [r for r in rows if r[1] <= 0 or r[2] != 0]
print('SUMMARY', rows, 'bad=', bad)
sys.exit(0 if not bad else 1)
PY
RC=$?
assert_line "$CASE" "四份副本全库 integrity_check 全 ok 且覆盖 >0 个库" "$([ $RC -eq 0 ] && echo ok || echo bad)" "ok"
exit $RC