#!/bin/bash
# V1-001: core/*, basis.yml, six @basis packages are all tracked; no untracked files in scope.
set -u
cd /Users/sunny/code/agent-basis-rc5 || exit 2
fail=0
for p in core/cordis core/contracts core/runtime basis.yml \
         packages/system-prompt packages/session packages/tools \
         packages/llm packages/approval-cli packages/agent-loop; do
  n=$(git ls-files -- "$p" | wc -l | tr -d ' ')
  if [ "$n" -gt 0 ]; then echo "tracked $p: $n files"; else echo "FAIL tracked $p: 0 files"; fail=1; fi
done
untracked=$(git ls-files --others --exclude-standard -- core basis.yml \
  packages/system-prompt packages/session packages/tools packages/llm packages/approval-cli packages/agent-loop)
if [ -n "$untracked" ]; then
  echo "FAIL untracked files in scope:"; printf '%s\n' "$untracked"; fail=1
else
  echo "untracked files in scope: none"
fi
echo "SUMMARY failures=$fail"
exit $fail
