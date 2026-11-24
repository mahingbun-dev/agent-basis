#!/usr/bin/env bash
# 发布说明部署前检查(55 号 §5.3 ①)。
#
# 用法: bash deploy/release-notes-check.sh [ENV_FILE] [-- gate 参数]
#   ENV_FILE 默认仓库根 .env(读 ETERNA_IMAGE 做 tag 比对;文件缺失则跳过该项)
#
# 两件事:
#   1) 镜像 tag 必须等于 VERSION(同版本重发会让已读用户永远看不到新内容);
#   2) 12 条内容门禁全过(node scripts/release-notes-gate.mjs)。
#
# 退出码非 0 = 不要部署。有人绕过本脚本直接 `docker compose up -d` 时,
# 容器 entrypoint 会 fail-closed 再拦一次(③),部署后 verify.sh 第 15 项复验(④)。
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-$REPO/.env}"
[[ $# -gt 0 ]] && shift

if [ ! -f "$REPO/VERSION" ]; then
  echo "FATAL 缺少 $REPO/VERSION —— 版本号是发布说明的前提(55 号 §5.1)" >&2
  exit 1
fi
VERSION="$(tr -d '[:space:]' < "$REPO/VERSION")"

if [ -f "$ENV_FILE" ]; then
  IMAGE="$(grep -E '^ETERNA_IMAGE=' "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
  if [ -n "${IMAGE:-}" ]; then
    TAG="${IMAGE##*:}"
    if [ "$TAG" != "$VERSION" ]; then
      echo "FATAL 镜像 tag($TAG)≠ VERSION($VERSION):$ENV_FILE 的 ETERNA_IMAGE=$IMAGE" >&2
      echo "      同版本重发会让已读用户看不到新内容——先升 VERSION 并补说明(55 号 §5.4)" >&2
      exit 1
    fi
    echo "PASS 镜像 tag = VERSION = $VERSION"
  else
    echo "WARN $ENV_FILE 没有 ETERNA_IMAGE,跳过 tag 比对"
  fi
else
  echo "WARN 未找到 $ENV_FILE,跳过 tag 比对(内容门禁照跑)"
fi

cd "$REPO"
node scripts/release-notes-gate.mjs "$@"