# RC5-IMP-007 · 512MiB 边界归档经真实反代上传（不 OOM）

- 套件：IMP
- 结论：**PASS**
- 开始/结束：2026-11-20T06:20:20.505Z / 2026-11-20T06:20:28.060Z

## 预期

精确 512MiB 经 client_max_body_size 512m 的反代上传；200 + outcome.ok；无 413/OOM；容器健康

## 实际

bytes=536870912 upload=200 ok=true elapsed=4325ms respBytes=342 sessionIds=0 skipped=1 oom=false restarts=0→0 health=healthy peak=570.3MiB→1000.9MiB

## 备注

- lane=rc5-e1suite（独立测试容器，未触碰生产）；临时反代 rc5-imp-nginx @3129 → http://127.0.0.1:3118
- 夹具内的会话故意无消息：本用例隔离「体积边界」变量，outcome 里以 skipped（conversation has no messages）呈现，不是导入失败
- 临时反代把 Host 置为应用 authority（127.0.0.1:3118）：会话令牌绑定 authority，生产反代在真实域名下天然一致
- 上传为 Node 流式（createReadStream → http.request，content-length 精确），测试进程不整包进内存
- 内存判据用容器 cgroup memory.peak（单调峰值）：上传前/后对比，并核 OOMKilled/重启/health

## 证据附件

- `cmd.log`

## 执行命令

```
$ python3 artifacts/rc5/E1/IMP/make-512m-export.py /tmp/imp-007-512m.zip  # EXIT=0
$ node -e statSync(/tmp/imp-007-512m.zip).size  # EXIT=0
$ POST /api/deepseek-chat-import/archive（坏包探针，逐个候选 workspaceId，直连容器）  # EXIT=0
$ 会话：B(rc5userb) 登录 + dsh 会话  # EXIT=200
$ docker rm -f rc5-imp-nginx  # EXIT=0
$ docker run -d --name rc5-imp-nginx -p 3129:80 --add-host host.docker.internal:host-gateway -v /tmp/rc5-imp-nginx.conf:/etc/nginx/nginx.conf:ro nginx:alpine  # EXIT=0
$ docker exec rc5-imp-nginx nginx -t  # EXIT=0
$ GET http://127.0.0.1:3129/login（反代连通）  # EXIT=200
$ POST /api/deepseek-chat-import/archive（坏包 10B 经反代，前置鉴权探针）  # EXIT=200
$ docker exec rc5-e1suite cat /sys/fs/cgroup/memory.peak（上传前）  # EXIT=0
$ POST http://127.0.0.1:3129/api/deepseek-chat-import/archive?workspaceId=6fd0ca27-26be-443a-bab0-453b37a1e244（536870912 bytes 流式）  # EXIT=0
$ docker exec rc5-e1suite cat /sys/fs/cgroup/memory.peak（上传后）  # EXIT=0
$ docker logs rc5-imp-nginx（过滤访问日志）  # EXIT=0
$ GET http://127.0.0.1:3129/login（上传后仍可服务）  # EXIT=200
```
