#!/bin/sh
# 部署前活动会话检查:重建/重启容器会杀死进行中的 turn(2026-11-13 #68 部署事故:
# 未查活动 turn 即 `docker compose up -d`,用户回合被 disposed)。
#
# 信号源(容器内卷):审计 jsonl 与会话日志 zstd 的最近写入时间——任一在静默窗内
# 即视为有活动 turn。注意审计按工具调用落盘、会话日志按事件追加,LLM 长思考期间
# 可能两者都暂无写入 → 本检查是「必要不充分」护栏,低峰窗口重建仍是纪律。
#
# 用法:bash deploy/pre-restart-check.sh [容器名] [静默窗秒]
#   FORCE=1 bash deploy/pre-restart-check.sh   # 确认可中断活动后强行放行
set -eu

CONTAINER="${1:-eterna-agent}"
WINDOW="${2:-120}"

now=$(date +%s)
newest=$(docker exec "$CONTAINER" sh -c '
  find /data/.eterna /data/sessions -type f \( -name "audit-*.jsonl" -o -name "session.v4.jsonl.zstd" \) -newermt "'"$WINDOW"' seconds ago" 2>/dev/null | head -3
' 2>/dev/null || true)

if [ "${FORCE:-0}" != "1" ] && [ -n "$newest" ]; then
  echo "⛔ 检测到静默窗(${WINDOW}s)内有会话活动,重建将杀死进行中的 turn:"
  echo "$newest" | sed 's/^/    /'
  echo "   等待回合结束/用户确认后重试;确认可中断则:FORCE=1 bash deploy/pre-restart-check.sh"
  exit 1
fi

if [ -n "$newest" ]; then
  echo "⚠️ FORCE=1:忽略静默窗内的会话活动,继续执行"
else
  echo "✅ 静默窗(${WINDOW}s)内无会话活动,可安全重建"
fi
