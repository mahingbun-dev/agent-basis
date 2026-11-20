#!/usr/bin/env bash
# T52 复跑：RC5-OFF-001/002/003（P0）office 三格式转换（镜像自带 libreoffice WASM）。
set -u
ROOT=/Users/sunny/code/agent-basis-rc5
OUT=$ROOT/artifacts/rc5/p7/regression/rerun/E1/OFF
C=rc5-e1suite
cd "$ROOT" || exit 2
mkdir -p "$OUT/tools"
run() { echo "\$ $*"; "$@"; local rc=$?; echo "EXIT=$rc"; echo; return $rc; }

echo "# T52 OFF 复跑 — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
run docker exec "$C" mkdir -p /tmp/office/docx /tmp/office/xlsx /tmp/office/pptx /tmp/office/render
run docker cp tests/fixtures/office/sample.docx "$C":/tmp/office/docx/sample.docx
run docker cp tests/fixtures/office/sample.xlsx "$C":/tmp/office/xlsx/sample.xlsx
run docker cp tests/fixtures/office/sample.pptx "$C":/tmp/office/pptx/sample.pptx
run docker cp artifacts/rc5/E1/OFF/tools/probe.mjs "$C":/tmp/office/probe.mjs
echo "\$ docker exec $C node /tmp/office/probe.mjs > $OUT/tools/probe-output.json"
docker exec "$C" node /tmp/office/probe.mjs > "$OUT/tools/probe-output.json" 2> "$OUT/tools/probe-stderr.log"
P=$?
echo "EXIT=$P"
python3 - "$OUT/tools/probe-output.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
print('backend=',d.get('backend'))
for row in d.get('converts',[]):
    print('convert',row.get('ext'),'ok=',row.get('ok',row.get('backend') is not None),'pages=',row.get('pageCount'),'missingFonts=',row.get('missingFonts'))
print('renders=',[ (r.get('ext'), len(r.get('files',[]) or r.get('images',[]) or [])) for r in d.get('renders',[])])
print('recalculate=',d.get('recalculate'))
PY
exit "$P"