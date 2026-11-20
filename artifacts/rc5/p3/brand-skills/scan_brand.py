#!/usr/bin/env python3
"""T21 品牌扫描:packages/brand/skills 下 DeepSeek Harness / 裸 DSH 品牌词必须为 0。

豁免(与 2026-11-09 品牌替换表一致):
- `@deepseek-ai/*` 包名依赖;
- 运行时标识符 DSH_HOME / DSH_PROFILE / DSH_PROFILE_DIR / DSH_INSTALL_DIR /
  DSH_NODE_EXECUTABLE / __DSH_BOOT__ / DSH_* 前缀;
- 小写 `dsh`(CLI 命令与 dsh-* 包名)。
退出码 0 = PASS,1 = FAIL。
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4] / 'packages' / 'brand' / 'skills'
DEEPSEEK_HARNESS = 'DeepSeek Harness'
# 裸 DSH:前后都不是标识符字符;DSH_HOME/__DSH_BOOT__/@deepseek-ai/... 均不会命中。
STANDALONE_DSH = re.compile(r'(?<![A-Za-z0-9_$@\-])DSH(?![A-Za-z0-9_\-])')
IDENTIFIER_DSH = re.compile(r'DSH[A-Za-z0-9_]*|__DSH_BOOT__')


def files() -> list[Path]:
    return sorted(p for p in ROOT.rglob('*') if p.is_file())


def main() -> int:
    all_files = files()
    failures: list[str] = []

    dh_hits: list[str] = []
    dsh_hits: list[str] = []
    identifiers: dict[str, int] = {}
    package_refs = 0
    for path in all_files:
        text = path.read_text(encoding='utf-8')
        rel = path.relative_to(ROOT).as_posix()
        for lineno, line in enumerate(text.splitlines(), 1):
            if DEEPSEEK_HARNESS in line:
                dh_hits.append(f'{rel}:{lineno}: {line.strip()[:160]}')
            if STANDALONE_DSH.search(line):
                dsh_hits.append(f'{rel}:{lineno}: {line.strip()[:160]}')
            for token in IDENTIFIER_DSH.findall(line):
                identifiers[token] = identifiers.get(token, 0) + 1
        package_refs += text.count('@deepseek-ai/')

    print(f'root: {ROOT}')
    print(f'files scanned: {len(all_files)}')
    print(f'DeepSeek Harness hits: {len(dh_hits)}')
    for hit in dh_hits:
        print(f'  {hit}')
    print(f'standalone DSH hits: {len(dsh_hits)}')
    for hit in dsh_hits:
        print(f'  {hit}')
    print(f'raw @deepseek-ai/ package refs (exempt): {package_refs}')
    print('DSH_* runtime identifier tokens (exempt):')
    for token, count in sorted(identifiers.items()):
        print(f'  {token}: {count}')

    if dh_hits:
        failures.append(f'{len(dh_hits)} DeepSeek Harness hit(s)')
    if dsh_hits:
        failures.append(f'{len(dsh_hits)} standalone DSH hit(s)')
    if not all_files:
        failures.append('no skill files found')

    print('verdict:', 'FAIL' if failures else 'PASS')
    for failure in failures:
        print('  -', failure)
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())