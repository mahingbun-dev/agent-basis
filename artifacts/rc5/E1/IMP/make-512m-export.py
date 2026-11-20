#!/usr/bin/env python3
"""生成恰好 512MiB 的 DeepSeek 导出 ZIP（RC5-IMP-007 边界上传夹具）。

结构（满足上游 rc.5 importer 的最小合法面）：
  manifest.json                 {"export_format_version":3}
  chat_session_index.json       [{"id":"conv-1","inserted_at":...,"updated_at":...}]
  chat_sessions/conv-1.json     {"id":"conv-1","title":"IMP-007","inserted_at":...,"messages":[]}
  bulk/blob-1.bin               240MiB（ZIP_STORED；不在 index 中 → 不会被解压）
  bulk/blob-2.bin               剩余体积（同上）
整体字节数精确等于 512*1024*1024（上游 maxUploadBytes 上限）。

用法：python3 make-512m-export.py /tmp/imp-007-512m.zip
"""
import json
import os
import sys
import zipfile

TARGET = 512 * 1024 * 1024
BLOB = 240 * 1024 * 1024
CHUNK = 4 * 1024 * 1024
NOW = "2026-11-20T00:00:00Z"


def write_zip(path: str, blob2: int) -> int:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
        archive.writestr("manifest.json", json.dumps({"export_format_version": 3}))
        archive.writestr("chat_session_index.json", json.dumps([
            {"id": "conv-1", "inserted_at": NOW, "updated_at": NOW},
        ]))
        archive.writestr("chat_sessions/conv-1.json", json.dumps({
            "id": "conv-1",
            "title": "IMP-007",
            "inserted_at": NOW,
            "messages": [],
        }))
        zeros = b"\x00" * CHUNK
        for name, total in (("bulk/blob-1.bin", BLOB), ("bulk/blob-2.bin", blob2)):
            with archive.open(name, "w", force_zip64=True) as entry:
                remaining = total
                while remaining > 0:
                    chunk = zeros if remaining >= CHUNK else zeros[:remaining]
                    entry.write(chunk)
                    remaining -= len(chunk)
    return os.path.getsize(path)


def main() -> int:
    if len(sys.argv) != 2:
        sys.stderr.write("用法: python3 make-512m-export.py <输出.zip>\n")
        return 2
    path = sys.argv[1]
    # 第一遍量出固定开销，第二遍把第二个 blob 调到精确 512MiB。
    first = write_zip(path, BLOB)
    delta = TARGET - first
    size = write_zip(path, BLOB + delta)
    if size != TARGET:
        sys.stderr.write(f"体积不精确: {size} != {TARGET}\n")
        return 1
    sys.stdout.write(f"archive={path} bytes={size}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())