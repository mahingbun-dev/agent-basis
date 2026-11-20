# RC5-BOOT-002 · E3 super 形态启动

- 套件：BOOT
- 结论：**PASS**
- 开始/结束：2026-11-20T01:42:33.579Z / 2026-11-20T01:42:40.022Z

## 预期

super 容器 healthy；super 路由（/login）可访问；日志 form=super profile=eterna-super

## 实际

health=healthy login=200 logForm=true

## 备注

- super 实例独立根：$HOME/eterna-data/test-20261120/super；端口 3117（避开 3109 的另一 lane 容器）

## 证据附件

- `boot.log`
- `cmd.log`

## 执行命令

```
$ docker run -d … rc5-e1suite-super（ETERNA_FORM=super，127.0.0.1:3117:8080）  # EXIT=0
$ curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3117/login  # EXIT=0
```
