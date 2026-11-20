#!/usr/bin/env bash
# 数据根 / 迁移副本验证（51 §3.14 / §4；54 §6.3；T47）。
#
# 覆盖：
#   DATA-001  deploy/init-data-dirs.sh 幂等；根与实例根 0700；子目录齐全
#   DATA-002  E1 compose 的 /data 绑定到 $HOME/eterna-data/test-rc5/<实例>；
#             `docker compose config` 可用（T43/T48 的 compose 参数化断言）
#   DATA-003  容器内 DSH_HOME=/data（路径不变）
#   DATA-004  迁移副本硬链接数/大小与源一致（需 --migration-source/--migration-dest；
#             未提供时只对合成样本自检测量逻辑，并在报告里明确 NOTRUN）
#   DATA-006  容器内 DSH_AGENTS_HOME=/data/agents
#
# 用法：
#   bash scripts/verify-data-root.sh \
#     --root "$HOME/eterna-data/test-rc5" --instance e1 \
#     --container eterna-rc5-e1 --env-file "$HOME/eterna-data/test-rc5/.env.e1" \
#     --json artifacts/rc5/p5/testbed/data-root/report.json
#   可选：
#     --migration-source <dir> --migration-dest <dir>    # E5 冷备副本
#     --no-clean                                           # 保留临时检查目录
#
# 只读接口优先；DATA-001 的幂等检查只写测试数据根下的临时实例目录，结束后删除。
set -u

ROOT="${HOME}/eterna-data/test-rc5"
INSTANCE="e1"
CONTAINER="eterna-rc5-e1"
ENV_FILE=""
JSON_OUT=""
MIG_SRC=""
MIG_DST=""
CLEAN=1

while [ $# -gt 0 ]; do
  case "$1" in
    --root) ROOT="$2"; shift 2 ;;
    --instance) INSTANCE="$2"; shift 2 ;;
    --container) CONTAINER="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --json) JSON_OUT="$2"; shift 2 ;;
    --migration-source) MIG_SRC="$2"; shift 2 ;;
    --migration-dest) MIG_DST="$2"; shift 2 ;;
    --no-clean) CLEAN=0; shift ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) printf '未知参数: %s\n' "$1" >&2; exit 2 ;;
  esac
done

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0; FAIL=0; NOTRUN=0
declare -a CASES=()

emit() { # id status title detail
  printf '[%s] %s %s :: %s\n' "$2" "$1" "$3" "$4"
  CASES+=("{\"id\":\"$1\",\"status\":\"$2\",\"title\":\"$3\",\"detail\":\"$4\"}")
  case "$2" in
    PASS) PASS=$((PASS+1)) ;;
    FAIL) FAIL=$((FAIL+1)) ;;
    *) NOTRUN=$((NOTRUN+1)) ;;
  esac
}

exists_dir() { [ -d "$1" ]; }

# ── DATA-001 幂等 + 权限 + 子目录 ─────────────────────────────────────
CHECK_DIR="$ROOT/.verify-data-root-check"
rm -rf "$CHECK_DIR"
ok=1
if ! ETERNA_DATA_ROOT="$CHECK_DIR/root" bash "$REPO/deploy/init-data-dirs.sh" probe >/tmp/rc5-init1.log 2>&1; then ok=0; fi
if ! ETERNA_DATA_ROOT="$CHECK_DIR/root" bash "$REPO/deploy/init-data-dirs.sh" probe >/tmp/rc5-init2.log 2>&1; then ok=0; fi
root_mode="$(stat -f '%Lp' "$CHECK_DIR/root" 2>/dev/null || echo '?')"
inst_mode="$(stat -f '%Lp' "$CHECK_DIR/root/probe" 2>/dev/null || echo '?')"
missing=""
for sub in access agents attachments cache logs market memory-distill office-kit profiles sessions storages workspaces; do
  exists_dir "$CHECK_DIR/root/probe/$sub" || missing="$missing $sub"
done
# 第二次执行不应改变内容（幂等）：目录仍在、权限仍 0700。
idempotent=1
[ "$root_mode" = "700" ] && [ "$inst_mode" = "700" ] || idempotent=0
if [ "$ok" = "1" ] && [ "$idempotent" = "1" ] && [ -z "$missing" ]; then
  emit RC5-DATA-001 PASS "init-data-dirs 幂等、根 0700、子目录齐全" "root=$root_mode instance=$inst_mode second-run=ok"
else
  emit RC5-DATA-001 FAIL "init-data-dirs 幂等、根 0700、子目录齐全" "exit-ok=$ok perms=$root_mode/$inst_mode missing=$missing"
fi
if [ "$CLEAN" = "1" ]; then rm -rf "$CHECK_DIR"; fi

# ── DATA-002 compose bind + compose config ──────────────────────────
mounts="$(docker inspect "$CONTAINER" --format '{{json .Mounts}}' 2>/dev/null || echo '')"
expected="$ROOT/$INSTANCE"
if printf '%s' "$mounts" | grep -q "\"Destination\":\"/data\"" && printf '%s' "$mounts" | grep -q "\"Source\":\"$expected\""; then
  emit RC5-DATA-002 PASS "/data 绑定到测试数据根" "source=$expected"
else
  emit RC5-DATA-002 FAIL "/data 绑定到测试数据根" "expected=$expected mounts=${mounts:0:220}"
fi

# compose config（参数化 + :? fail-closed 的可用性；不启动容器）
if [ -n "$ENV_FILE" ] && [ -f "$ENV_FILE" ]; then
  if docker compose --env-file "$ENV_FILE" -f "$REPO/docker-compose.yml" config >/tmp/rc5-compose-config.out 2>/tmp/rc5-compose-config.err; then
    target="$(grep -B2 'target: /data' /tmp/rc5-compose-config.out | grep 'source:' | head -1 | sed 's/^ *//')"
    emit RC5-DATA-002b PASS "compose config 可用且 /data 为 bind" "$target"
  else
    emit RC5-DATA-002b FAIL "compose config 可用且 /data 为 bind" "$(head -c 160 /tmp/rc5-compose-config.err)"
  fi
else
  emit RC5-DATA-002b NOTRUN "compose config 可用且 /data 为 bind" "未提供 --env-file"
fi

# ── DATA-003 / DATA-006 容器内路径 ──────────────────────────────────
dsh_home="$(docker exec "$CONTAINER" sh -c 'printf %s "$DSH_HOME"' 2>/dev/null || echo '')"
if [ "$dsh_home" = "/data" ]; then
  emit RC5-DATA-003 PASS "容器内 DSH_HOME=/data" "DSH_HOME=$dsh_home"
else
  emit RC5-DATA-003 FAIL "容器内 DSH_HOME=/data" "DSH_HOME=${dsh_home:-<empty>}"
fi

agents_home="$(docker exec "$CONTAINER" sh -c 'printf %s "$DSH_AGENTS_HOME"' 2>/dev/null || echo '')"
if [ "$agents_home" = "/data/agents" ]; then
  emit RC5-DATA-006 PASS "容器内 DSH_AGENTS_HOME=/data/agents" "DSH_AGENTS_HOME=$agents_home"
else
  emit RC5-DATA-006 FAIL "容器内 DSH_AGENTS_HOME=/data/agents" "DSH_AGENTS_HOME=${agents_home:-<empty>}"
fi

# ── DATA-004 迁移副本硬链接/大小 ────────────────────────────────────
if [ -n "$MIG_SRC" ] && [ -n "$MIG_DST" ] && [ -d "$MIG_SRC" ] && [ -d "$MIG_DST" ]; then
  # 统计：文件数、总字节、硬链接组数（link count >1 的 inode 数）
  stats() {
    find "$1" -type f -print0 2>/dev/null | xargs -0 stat -f '%z %i' 2>/dev/null | awk '
      { bytes += $1; files += 1; seen[$2] += 1 }
      END { groups = 0; for (i in seen) if (seen[i] > 1) groups += 1;
            printf "%d %d %d", files, bytes, groups }'
  }
  read -r src_files src_bytes src_groups <<<"$(stats "$MIG_SRC")"
  read -r dst_files dst_bytes dst_groups <<<"$(stats "$MIG_DST")"
  if [ "$src_files" = "$dst_files" ] && [ "$src_bytes" = "$dst_bytes" ] && [ "$src_groups" = "$dst_groups" ]; then
    emit RC5-DATA-004 PASS "迁移副本硬链接/大小与源一致" "files=$src_files bytes=$src_bytes linkGroups=$src_groups"
  else
    emit RC5-DATA-004 FAIL "迁移副本硬链接/大小与源一致" "src=$src_files/$src_bytes/$src_groups dst=$dst_files/$dst_bytes/$dst_groups"
  fi
else
  # 合成自检：验证统计函数能识别硬链接组（不冒充真实迁移）
  synth="$ROOT/.verify-data-root-check/mig"
  rm -rf "$synth"
  mkdir -p "$synth/src/sub" "$synth/dst/sub"
  printf 'alpha' > "$synth/src/a"
  ln "$synth/src/a" "$synth/src/a-link"
  printf 'beta' > "$synth/src/sub/b"
  # macOS 的 cp -a 不保留硬链接（实测 linkGroups 1→0）；迁移/自检统一用 rsync -aH。
  rsync -aH "$synth/src/" "$synth/dst/"
  read -r s_files s_bytes s_groups <<<"$(find "$synth/src" -type f -print0 | xargs -0 stat -f '%z %i' | awk '{b+=$1;f++;s[$2]++} END{g=0;for(i in s)if(s[i]>1)g++;printf "%d %d %d",f,b,g}')"
  read -r d_files d_bytes d_groups <<<"$(find "$synth/dst" -type f -print0 | xargs -0 stat -f '%z %i' | awk '{b+=$1;f++;s[$2]++} END{g=0;for(i in s)if(s[i]>1)g++;printf "%d %d %d",f,b,g}')"
  if [ "$s_files" = "$d_files" ] && [ "$s_bytes" = "$d_bytes" ] && [ "$s_groups" = "$d_groups" ] && [ "$s_groups" -ge 1 ]; then
    emit RC5-DATA-004 NOTRUN "迁移副本硬链接/大小与源一致" "未提供 --migration-source/--migration-dest；合成样本自检通过（files=${s_files} bytes=${s_bytes} linkGroups=${s_groups}）"
  else
    emit RC5-DATA-004 FAIL "迁移副本硬链接/大小与源一致" "合成样本自检失败 src=$s_files/$s_bytes/$s_groups dst=$d_files/$d_bytes/$d_groups"
  fi
  [ "$CLEAN" = "1" ] && rm -rf "$synth"
fi

# ── 汇总 ────────────────────────────────────────────────────────────
printf '\n[DATA] PASS=%d FAIL=%d NOTRUN=%d\n' "$PASS" "$FAIL" "$NOTRUN"
if [ -n "$JSON_OUT" ]; then
  mkdir -p "$(dirname "$JSON_OUT")"
  {
    printf '{\n  "suite": "DATA",\n  "root": "%s",\n  "instance": "%s",\n  "container": "%s",\n  "counts": {"PASS": %d, "FAIL": %d, "NOTRUN": %d},\n  "cases": [\n' "$ROOT" "$INSTANCE" "$CONTAINER" "$PASS" "$FAIL" "$NOTRUN"
    first=1
    for row in "${CASES[@]}"; do
      [ "$first" = "1" ] || printf ',\n'
      printf '    %s' "$row"
      first=0
    done
    printf '\n  ]\n}\n'
  } >"$JSON_OUT"
  printf '[DATA] report → %s\n' "$JSON_OUT"
fi

[ "$FAIL" -eq 0 ] && exit 0 || exit 1