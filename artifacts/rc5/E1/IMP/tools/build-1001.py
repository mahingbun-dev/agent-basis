#!/usr/bin/env python3
"""生成 1001 会话的 chat-import 归档（zip v3；复用夹具 conv-01 结构，id 唯一）。

用法：python3 -I build-1001.py <fixture.zip> <out.zip>
退出码 0=成功。
"""
import json
import sys
import zipfile

fixture, out = sys.argv[1], sys.argv[2]
src = zipfile.ZipFile(fixture)
session = json.loads(src.read('chat_sessions/conv-01.json'))
count = 1001
index = []
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as dst:
    dst.writestr('manifest.json', json.dumps({'export_format_version': 3}))
    for i in range(1, count + 1):
        cid = f'conv-{i:04d}'
        item = dict(session)
        item['id'] = cid
        item['title'] = f'容量自检 {i}'
        dst.writestr(f'chat_sessions/{cid}.json', json.dumps(item, ensure_ascii=False))
        index.append({
            'id': cid,
            'inserted_at': '2026-11-10T00:00:00.000Z',
            'updated_at': f'2026-11-10T00:{i % 60:02d}:00.000Z',
        })
    dst.writestr('chat_session_index.json', json.dumps(index, ensure_ascii=False))
print(f'sessions={count} bytes_out={__import__("os").path.getsize(out)}')