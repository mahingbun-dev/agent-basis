#!/usr/bin/env bash
# 证据记录工具（DATA lane）。用法：
#   source record.sh
#   record <case-dir> <label> -- <command...>
# 行为：把命令原文、完整输出、EXIT 追加进 <case-dir>/cmd.log。
# 纪律：不打印环境变量值（argv 只写命令原文）；凭据不落盘/不进 argv。
set -u

CASE_DIR=""
CASE_LOG=""

case_init() { # case_init <case-dir>
  CASE_DIR="$1"
  mkdir -p "$CASE_DIR"
  CASE_LOG="$CASE_DIR/cmd.log"
  : >"$CASE_LOG"
  printf '# case: %s\n# host: %s  user: %s  time: %s\n\n' \
    "$(basename "$CASE_DIR")" "$(hostname)" "$(id -un)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$CASE_LOG"
}

case_switch() { # case_switch <case-dir> —— 追加写模式（不截断），供多 case 复用
  CASE_DIR="$1"
  mkdir -p "$CASE_DIR"
  CASE_LOG="$CASE_DIR/cmd.log"
  printf '# case: %s  switched: %s\n' "$(basename "$CASE_DIR")" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$CASE_LOG"
}

record() { # record <label> -- <cmd...>
  local label="$1"; shift
  [ "${1-}" = "--" ] && shift
  {
    printf '$ %s\n' "$*"
    printf '# label: %s\n' "$label"
    printf '# started: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } >>"$CASE_LOG"
  local out
  out="$(mktemp)"
  "$@" >"$out" 2>&1
  local rc=$?
  cat "$out" >>"$CASE_LOG"
  [ -s "$out" ] && [ -n "$(tail -c 1 "$out")" ] && printf '\n' >>"$CASE_LOG"
  rm -f "$out"
  printf 'EXIT=%d\n\n' "$rc" >>"$CASE_LOG"
  printf '[%s] %s -> EXIT=%d\n' "$(basename "$CASE_DIR")" "$label" "$rc"
  return $rc
}

record_note() { # record_note <text>
  printf '%s\n\n' "$*" >>"$CASE_LOG"
}

assert_line() { # assert_line <case-dir> <expr-description> <actual> <expected>
  local dir="$1" desc="$2" actual="$3" expected="$4"
  if [ "$actual" = "$expected" ]; then
    printf 'ASSERT PASS | %s | actual=%s expected=%s\n' "$desc" "$actual" "$expected" >>"$dir/cmd.log"
    printf 'ASSERT PASS | %s\n' "$desc"
    return 0
  fi
  printf 'ASSERT FAIL | %s | actual=%s expected=%s\n' "$desc" "$actual" "$expected" >>"$dir/cmd.log"
  printf 'ASSERT FAIL | %s | actual=%s expected=%s\n' "$desc" "$actual" "$expected"
  return 1
}