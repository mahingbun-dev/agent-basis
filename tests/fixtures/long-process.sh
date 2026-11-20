#!/bin/sh
# 长进程夹具（51 §1「长进程命令」；TERM-009/TERM-013；T47）。
#
# 用 5s 心跳持续写 stdout，验证 terminal attach 后切页/重连输出连续、
# 24h 浸泡期间进程存活；SIGTERM/SIGINT 干净退出（无僵尸/无残留子进程）。
#
# 等价内联命令（51 §1 原文）：
#   while true; do date; sleep 5; done
#
# 用法：
#   sh tests/fixtures/long-process.sh           # 输出 ISO 时间心跳
#   sh tests/fixtures/long-process.sh 2         # 2s 间隔（快速验证）
set -eu
INTERVAL="${1:-5}"
case "$INTERVAL" in
  ''|*[!0-9]*) echo "[long-process] interval 必须是正整数秒: $INTERVAL" >&2; exit 2 ;;
esac
trap 'echo "[long-process] stopped" ; exit 0' TERM INT
echo "[long-process] start pid=$$ interval=${INTERVAL}s"
while true; do
  date '+%Y-%m-%dT%H:%M:%S%z 待机心跳'
  sleep "$INTERVAL"
done