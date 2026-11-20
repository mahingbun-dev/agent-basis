DSH_PKG="$(dirname "$(dirname "$(readlink -f "$(command -v dsh)")")")"
MIGRATE_WARN=0
if ! node /Users/<user>/code/agent-basis-rc5/docker/profile/migrate-profile-bundles.mjs \
  "$PROFILE_DIR/package.json" /Users/<user>/code/agent-basis-rc5/docker/profile/package.json \
  "$PROFILE_DIR/.eterna-default-bundles.json"; then
  MIGRATE_WARN=1
fi
if [ -f "$PREV_PATCH" ]; then
  if ! node /Users/<user>/code/agent-basis-rc5/docker/profile/migrate-mcp-servers.mjs \
    "$PREV_PATCH" "$PROFILE_DIR/cordis.patch.yml" \
    "$PROFILE_DIR/.upgrade-mcp-servers-backup.json"; then
    MIGRATE_WARN=1
  fi
fi
if [ "$MIGRATE_WARN" != "0" ]; then
  echo "[entrypoint] WARNING profile 存量迁移有失败项(原文件保留、留痕已写;成因见上方日志)" >&2
fi
node /Users/<user>/code/agent-basis-rc5/scripts/profile-upgrade-check.mjs "$PROFILE_DIR" \
  --boot --apply-removals --install-anchor "$DSH_PKG/package.json" \
  || echo "[entrypoint] WARNING profile 预检脚本异常(不阻塞启动;留痕见 $PROFILE_DIR/.upgrade-removed-bundles.json)"
rm -f "$PREV_PATCH"
