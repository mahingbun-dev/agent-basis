#!/usr/bin/env bash
# RC5-DATA-004：迁移演练两遍——副本硬链接/大小/符号链接与源一致（48 §7.3；51 DATA-004）。
set -u
cd /Users/sunny/code/agent-basis-rc5 || exit 1
source artifacts/rc5/DATA/_tools/record.sh

CASE="$PWD/artifacts/rc5/DATA/RC5-DATA-004"
ROOT="$HOME/eterna-data/test-rc5"
mkdir -p "$CASE"
case_init "$CASE"
PASS=0; FAIL=0
chk() { if assert_line "$CASE" "$1" "$2" "$3"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi; }

record "第一遍 stats" -- cat "$CASE/drill-1/stats.json"
record "第二遍 stats" -- cat "$CASE/drill-2/stats.json"

# P5 既有 E5 副本复测（第三份独立副本）
stats() {
  find "$1" -type f -print0 2>/dev/null | xargs -0 stat -f '%z %i' 2>/dev/null | awk '
    { bytes += $1; files += 1; seen[$2] += 1 }
    END { groups = 0; for (i in seen) if (seen[i] > 1) groups += 1;
          printf "%d %d %d", files, bytes, groups }'
}
read -r P5_FILES P5_BYTES P5_GROUPS <<<"$(stats "$ROOT/e5")"
P5_LINKS=$(find "$ROOT/e5" -type l | wc -l | tr -d ' ')
record_note "p5-e5 copy: files=$P5_FILES bytes=$P5_BYTES linkGroups=$P5_GROUPS symlinks=$P5_LINKS"

python3 - "$CASE" "$P5_FILES" "$P5_BYTES" "$P5_GROUPS" "$P5_LINKS" <<'PY' >> "$CASE/cmd.log" 2>&1
import json,sys,os
case=sys.argv[1]; p5=(int(sys.argv[2]),int(sys.argv[3]),int(sys.argv[4]),int(sys.argv[5]))
d1=json.load(open(os.path.join(case,'drill-1','stats.json')))
d2=json.load(open(os.path.join(case,'drill-2','stats.json')))
def chk(desc, actual, expected):
    st='PASS' if actual==expected else 'FAIL'
    print(f'ASSERT {st} | {desc} | actual={actual} expected={expected}')
    return 0 if st=='PASS' else 1
fail=0
fail+=chk('第一遍 files/bytes/linkGroups/symlinks 与源一致', d1['equal'], True)
fail+=chk('第二遍 files/bytes/linkGroups/symlinks 与源一致', d2['equal'], True)
fail+=chk('两遍副本统计完全一致', d1['dst'], d2['dst'])
fail+=chk('P5 E5 副本与两遍一致（第三份）', (p5[0],p5[1],p5[2],p5[3]), (d1['dst']['files'],d1['dst']['bytes'],d1['dst']['linkGroups'],d1['dst']['symlinks']))
print('VALUES', d1['dst'], d2['dst'], p5)
print('PY-ASSERT-FAILS=%d' % fail)
sys.exit(0 if fail==0 else 1)
PY
PYRC=$?
if [ "$PYRC" -eq 0 ]; then PASS=$((PASS+4)); else FAIL=$((FAIL+1)); fi

record_note "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1