# RC5-TERM-013 · 24h 浸泡：长进程 + 多次 attach/close，无 fd 泄漏/内存增长

- 套件：TERM
- 结论：**NOTRUN**
- 开始/结束：2026-11-20T07:03:42.238Z / 2026-11-20T07:03:42.239Z

## 预期

24h 窗口完成；fd/内存采样平稳；churn（create→attach→close 循环）全成功

## 实际

窗口未满：plannedEnd=2026-11-21T05:06:19.450Z samples=61 churnAllOk=true（当前进度证据）

## 备注

- 24h 属 P6b 长跑轨（54 §3.5），不在套件运行期内等待；套件只读窗口证据
- 本窗口在终版镜像（ae5ce8cb）上起跑；legacy 老镜像窗口证据在 p6b/soak/legacy-old-image（churn=fail，仅存档）

## 证据附件

- `cmd.log`

## 执行命令

```
$ cat artifacts/rc5/p6b/soak/final-image/{meta,summary,term-013}-24h-final.*  # EXIT=1
```
