#!/usr/bin/env bash
# T52 证据收口自检（只读 artifacts/rc5/** 与 git 状态；不改产品文件）。
# 用法：bash artifacts/rc5/p7/run-t52-recheck.sh | tee artifacts/rc5/p7/t52-recheck.log
set -u
cd /Users/sunny/code/agent-basis-rc5 || exit 2

echo "# T52 证据收口自检"
echo "# started $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "# worktree $(pwd) branch $(git branch --show-current) HEAD $(git rev-parse --short HEAD)"

echo
echo "## 1) 矩阵/阶段 summary 自检"
node artifacts/rc5/p6a/verify-matrix.mjs
echo "EXIT=$?"

echo
echo "## 2) 提交前卫生检查（禁止路径/高置信凭据）"
node artifacts/rc5/p7/check-commit-hygiene.mjs
echo "EXIT=$?"

echo
echo "## 3) 矩阵关键行"
grep -E '^\| B 用 A sessionId 调 6 unary 全拒|^\| RC5-TERM-004 ' artifacts/rc5/acceptance-matrix.md | sed 's/|/ | /g'
echo "EXIT=$?"

echo
echo "## 4) 修后复跑证据"
for f in artifacts/rc5/p6a/repairs/final-terminal-guard.json artifacts/rc5/p6a/repairs/final-chat-import.json artifacts/rc5/p6a/repairs/unit-vitest.log; do
  [ -f "$f" ] && echo "PRESENT $f" || echo "MISSING $f"
done
echo "EXIT=$?"

echo
echo "# finished $(date -u +%Y-%m-%dT%H:%M:%SZ)"