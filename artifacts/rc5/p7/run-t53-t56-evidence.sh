#!/bin/sh
# T53/T56 证据采集：只读命令 + 原文 + EXIT（不 push/不合并/不部署/不碰生产容器）
# 用法：sh artifacts/rc5/p7/run-t53-t56-evidence.sh
set -u
cd /Users/sunny/code/agent-basis-rc5 || exit 1
OUT=artifacts/rc5/p7/t53-t56-commands.log
: > "$OUT"

run() {
  echo "== $1 ==" >> "$OUT"
  echo "\$ $2" >> "$OUT"
  sh -c "$2" >> "$OUT" 2>&1
  echo "EXIT=$?" >> "$OUT"
  echo >> "$OUT"
}

echo "# T53/T56 证据 — $(date -u +%Y-%m-%dT%H:%M:%SZ) — worktree=$(pwd)" >> "$OUT"
echo "# head=$(git rev-parse HEAD) branch=$(git branch --show-current)" >> "$OUT"
echo >> "$OUT"

run "branch/remote 状态（未 push）" "git status -sb | head -8"
run "远端是否已有本分支（空=未 push）" "git ls-remote --heads origin feat/dsh-rc5-merge"
run "merge-base / 领先落后" "echo base=\$(git merge-base HEAD origin/main); echo ahead=\$(git rev-list --count origin/main..HEAD); echo behind=\$(git rev-list --count HEAD..origin/main); git log --oneline HEAD..origin/main"
run "差异规模" "git diff --shortstat origin/main...HEAD"
run "差异按目录" "git diff --name-only origin/main...HEAD | awk -F/ '{print \$1\"/\"\$2}' | sort | uniq -c | sort -rn | head -20"
run "P0 结果聚合（T52 P0-comparison.json）" "python3 -I -c \"
import json,collections
d=json.load(open('artifacts/rc5/p7/regression/P0-comparison.json'))
rows=d['matrix']
print('counts',json.dumps(d['counts'],ensure_ascii=False,sort_keys=True))
by=collections.defaultdict(collections.Counter)
for r in rows: by[r['id'].replace('RC5-','').split('-')[0]][r['rerun']]+=1
cols=['PASS','FAIL','MISSING','NOTRUN','NOT_RERUN']
for s in sorted(by):
    c=by[s]; print(s, sum(c.values()), [c.get(x,0) for x in cols])
print('total', len(rows))
\""
run "leftovers 条数" "grep -c '^| [A-Z]' artifacts/rc5/p7/regression/leftovers.md"
run "版本族（catalog）" "grep -nE \"'@deepseek-ai/(dsh-[a-z-]+|cordis|cosmokit)':\" pnpm-workspace.yaml | head -40"
run "Dockerfile 内核钉版" "grep -n '@deepseek-ai/dsh@' Dockerfile | head -5"
run "默认 bundle 集" "sed -n '1,30p' docker/profile/package.json"
run "terminal 配置（web 模板）" "sed -n '174,178p' docker/profile/cordis.patch.yml.template"
run "MCP 个人层边界常量" "grep -n 'MCP_PERSONAL_MAX_SERVERS\|MCP_PERSONAL_MAX_CONFIG_BYTES\|MCP_PERSONAL_MAX_CONNECTIONS\|MCP_PERSONAL_STARTUP_TIMEOUT_MS\|METADATA_HOSTS\|DEFAULT_TOOL_CALL_TIMEOUT_MS' packages/access/src/mcp-personal.ts packages/access/src/mcp-personal-runtime.ts"
run "回滚点（p0 summary 摘要）" "python3 -I -c \"
import json
d=json.load(open('artifacts/rc5/p0/summary.json'))
print('prod_image', d['prod']['container']['image'], d['prod']['container']['image_id'])
for i in d['rollback_point']['images']: print(i['role'], i['tag'], i['id'])
b=d['backup']; print('backup', b['path'], b['bytes'], b['sha256'], b['db_files'], b['sqlite_integrity_check'])
print('backup_exit', b['exit'], 'dir_mode', b['dir_mode'])
\""
run "浸泡窗口（只读 tail）" "tail -1 artifacts/rc5/p5/testbed/soak/data-009-24h.jsonl | cut -c1-200"
run "产出文件" "wc -l artifacts/rc5/p7/PR.md artifacts/rc5/p7/release-notes.md artifacts/rc5/p7/rollback-record.md"
run "产出脱敏自查（应无命中）" "grep -nEi 'token=|cookie:|password[[:space:]]*[:=]' artifacts/rc5/p7/PR.md artifacts/rc5/p7/release-notes.md artifacts/rc5/p7/rollback-record.md || true"

echo "# 完成 $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$OUT"
echo "wrote $OUT"