#!/usr/bin/env bash
# RC5-DATA-009：24h SQLite/terminal 浸泡（51 DATA-009；48 §4.5；54 §3.5）。
# 窗口由 P5 lane 于 2026-11-19T21:45:37Z 起跑（PID 记录在 p5/testbed/soak/soak.pid）；
# 本 lane 只观测/归档采样，绝不把未满窗口判绿。
set -u
cd /Users/sunny/code/agent-basis-rc5 || exit 1
source artifacts/rc5/DATA/_tools/record.sh

CASE="$PWD/artifacts/rc5/DATA/RC5-DATA-009"
SOAK="$PWD/artifacts/rc5/p5/testbed/soak"
mkdir -p "$CASE" "$PWD/artifacts/rc5/p6b/soak"
case_init "$CASE"

PID="$(cat "$SOAK/soak.pid" 2>/dev/null)"
record "浸泡进程存活检查" -- ps -p "$PID" -o pid,etime,command
record "浸泡 meta" -- cat "$SOAK/meta-24h.json"

# 快照（只读拷贝；不在 p5 目录内改动）
cp "$SOAK/data-009-24h.jsonl" "$CASE/data-009-24h.snapshot.jsonl"
cp "$SOAK/term-013-24h.jsonl" "$CASE/term-013-24h.snapshot.jsonl"
cp "$SOAK/console-24h.log" "$CASE/console-24h.snapshot.log"
cp "$SOAK/soak-24h.log" "$CASE/soak-24h.snapshot.log"
cp "$SOAK/meta-24h.json" "$CASE/meta-24h.json"
cp "$SOAK/data-009-24h.jsonl" "$PWD/artifacts/rc5/p6b/soak/data-009-24h.snapshot.jsonl"
cp "$SOAK/term-013-24h.jsonl" "$PWD/artifacts/rc5/p6b/soak/term-013-24h.snapshot.jsonl"

python3 - "$CASE" "$PID" <<'PY' | tee "$CASE/window.json"
import json,sys,os,datetime
case=sys.argv[1]; pid=int(sys.argv[2])
meta=json.load(open(os.path.join(case,'meta-24h.json')))
start=datetime.datetime.fromisoformat(meta['startedAt'].replace('Z','+00:00'))
planned=datetime.datetime.fromisoformat(meta['plannedEndAt'].replace('Z','+00:00'))
now=datetime.datetime.now(datetime.timezone.utc)
data=[json.loads(l) for l in open(os.path.join(case,'data-009-24h.snapshot.jsonl')) if l.strip()]
term=[json.loads(l) for l in open(os.path.join(case,'term-013-24h.snapshot.jsonl')) if l.strip()]
last=max(x['elapsedSeconds'] for x in data) if data else 0
integrity_ok=sum(1 for x in data if all(d['ok'] for d in x['databases']))
writes_ok=sum(x['write']['ok'] for x in data)
writes_fail=sum(x['write']['failed'] for x in data)
locks=sum(x.get('lockMatches',0) for x in data)
wal_hits=sum(x.get('walLogMatches',0) for x in data)
wal_dbs=set()
for x in data:
    for d in x['databases']:
        if d.get('journal')=='wal': wal_dbs.add(d['file'])
valid_term=[x for x in term if 'fds' in x]
fds=[x['fds'] for x in valid_term]
rss=[x['rssKb'] for x in valid_term]
churn_fail=sum(1 for x in valid_term if x.get('churn')=='fail')
out={
 "case":"RC5-DATA-009",
 "window":{
   "startedAt":meta['startedAt'],
   "plannedEndAt":meta['plannedEndAt'],
   "observedAt":now.isoformat(),
   "elapsedSeconds":last,
   "elapsedHours":round(last/3600,2),
   "requiredHours":24,
   "complete": last>=86400,
   "remainingHours":round(max(0,86400-last)/3600,2),
   "processAlive": (lambda: (os.kill(pid,0) or True))() if True else None
 },
 "data":{
   "ticks":len(data),
   "integrityAllOkTicks":integrity_ok,
   "writeOk":writes_ok,
   "writeFail":writes_fail,
   "lockMatches":locks,
   "walLogMatches":wal_hits,
   "walDatabases":sorted(wal_dbs),
   "lastSessions": data[-1]['databases'][0].get('sessions') if data else None
 },
 "term":{
   "ticks":len(valid_term),
   "fdFirst": fds[0] if fds else None, "fdLast": fds[-1] if fds else None,
   "fdMin": min(fds) if fds else None, "fdMax": max(fds) if fds else None,
   "rssKbFirst": rss[0] if rss else None, "rssKbLast": rss[-1] if rss else None,
   "churnFailTicks": churn_fail
 },
 "verdict":"NOTRUN（窗口未满 24h，不得判通过）"
}
print(json.dumps(out,ensure_ascii=False,indent=2))
PY

python3 - "$CASE" <<'PY' | tee -a "$CASE/cmd.log"
import json,sys,os
d=json.load(open(os.path.join(sys.argv[1],'window.json')))
assert_line = lambda desc, actual, expected: print(f"ASSERT {'PASS' if actual==expected else 'FAIL'} | {desc} | actual={actual} expected={expected}")
assert_line("窗口未满 24h（不得标绿）", d['window']['complete'], False)
assert_line("采样 tick 数 > 0", d['data']['ticks'] > 0, True)
assert_line("已采样窗口内 integrity 全 ok", d['data']['integrityAllOkTicks'], d['data']['ticks'])
assert_line("已采样窗口内无写失败", d['data']['writeFail'], 0)
assert_line("已采样窗口内 database is locked 命中 0", d['data']['lockMatches'], 0)
assert_line("已采样窗口内 WAL 日志异常命中 0", d['data']['walLogMatches'], 0)
PY

cat "$CASE/window.json" >> "$CASE/cmd.log"
record_note "verdict=NOTRUN：窗口 $(python3 -c 'import json;d=json.load(open("'"$CASE"'/window.json"));print(d["window"]["elapsedHours"], "h / 24 h；plannedEnd", d["window"]["plannedEndAt"])')"
exit 0