#!/usr/bin/env python3
"""T21 重放校验:品牌副本 = rc.5 基线文件 + 替换表(+ 两处已登记的增量段)。

- 43 个基线文件必须全部存在;
- 对每个文件施加替换表后与品牌副本逐字比较;不一致只允许出现在
  SKILL.md / references/plugin-development.md(品牌部署增量段)。
退出码 0 = PASS,1 = 意外差异/缺文件。
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

WORKTREE = Path(__file__).resolve().parents[4]
SRC = Path('/tmp/t21/rc5/packages/preset/agent-preset/skills/dsh-doc')
DST = WORKTREE / 'packages' / 'brand' / 'skills' / 'dsh-doc'
TOKEN = re.compile(r'(?<![A-Za-z0-9_$@\-])DSH(?![A-Za-z0-9_\-])')
INCREMENT_FILES = {'SKILL.md', 'references/plugin-development.md'}


def transform(text: str) -> str:
    text = text.replace('DeepSeek Harness (DSH)', 'EternaAgent')
    text = text.replace('DeepSeek Harness', 'EternaAgent')
    text = TOKEN.sub('EternaAgent', text)
    return text.replace('a EternaAgent', 'an EternaAgent')


def main() -> int:
    files = sorted(p for p in SRC.rglob('*') if p.is_file())
    problems: list[str] = []
    for path in files:
        rel = path.relative_to(SRC).as_posix()
        target = DST / rel
        if not target.exists():
            problems.append(f'MISSING {rel}')
            continue
        expected = transform(path.read_text(encoding='utf-8'))
        actual = target.read_text(encoding='utf-8')
        if expected == actual:
            continue
        if rel in INCREMENT_FILES:
            print(f'ALLOWED-INCREMENT {rel}')
        else:
            problems.append(f'UNEXPECTED-DIFF {rel}')
    extras = sorted(
        p.relative_to(DST).as_posix()
        for p in DST.rglob('*')
        if p.is_file() and p.relative_to(DST).as_posix() not in {
            f.relative_to(SRC).as_posix() for f in files
        }
    )
    print(f'baseline files compared: {len(files)}')
    print(f'brand extras (documented increments): {len(extras)}')
    for rel in extras:
        print(f'  EXTRA {rel}')
    print(f'unexpected: {len(problems)}')
    for problem in problems:
        print(f'  {problem}')
    print('verdict:', 'FAIL' if problems else 'PASS')
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())