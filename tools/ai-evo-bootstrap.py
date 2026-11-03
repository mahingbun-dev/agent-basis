#!/usr/bin/env python3
"""ai-evo 平台引导脚本(M4-M8):模型配置 → 会话数据集×3 → 三门禁任务 → 首跑。
用法: python3 tools/ai-evo-bootstrap.py [--run-only <task_name>]
凭据: .secrets/ai-evo-account.txt / .secrets/ai-evo-apikey.txt(litellm master key 内嵌为常量,勿提交真实值)
"""
import json, sys, time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
BASE = "http://MaNas:8201/api/v1"
LITELLM = "http://MaNas:4000/v1"
LITELLM_KEY = (ROOT / ".secrets" / "litellm-master-key.txt").read_text().strip()
API_KEY = (ROOT / ".secrets" / "ai-evo-apikey.txt").read_text().strip()
SESSIONS = Path("/tmp/cc-sessions")  # dsh2cc-jsonl.mjs 产物

# 内网直连:禁用系统代理(NAS 局域网地址不该走代理)
_session = requests.Session()
_session.trust_env = False

def _req(method, url, **kw):
    return _session.request(method, url, timeout=kw.pop("timeout", 60), **kw)

def H(key=False):
    h = {"Content-Type": "application/json"}
    if key:
        h["Authorization"] = f"Bearer {API_KEY}"
    else:
        h["Authorization"] = f"Bearer {(ROOT / '.secrets' / 'ai-evo-jwt.txt').read_text().strip()}"
    return h

def req(method, path, **kw):
    r = _req(method, BASE + path, **kw)
    print(f"{method} {path} → {r.status_code}")
    if r.status_code >= 300:
        print("  ERR:", r.text[:400])
    try:
        return r.status_code, r.json()
    except Exception:
        return r.status_code, r.text

# ---------- M4 模型 ----------
def m4_models():
    _, ev = req("POST", "/models", headers=H(), json={
        "name": "mimo-v2.6-flash(网关)", "provider": "openai", "model_type": "mimo-v2.6-flash",
        "model_role": "evaluation", "endpoint": LITELLM, "api_key": LITELLM_KEY, "auth_type": "api_key"})
    _, jv = req("POST", "/judge-models", headers=H(), json={
        "name": "mimo-v2.6-pro(网关)", "provider": "openai", "model_type": "mimo-v2.6-pro",
        "model_role": "judge", "endpoint": LITELLM, "api_key": LITELLM_KEY, "auth_type": "api_key"})
    ids = {"eval_model_id": (ev or {}).get("id") if isinstance(ev, dict) else None,
           "judge_model_id": (jv or {}).get("id") if isinstance(jv, dict) else None}
    for mid in filter(None, ids.values()):
        s, t = req("POST", f"/models/{mid}/test", headers=H(), json={})
        print("  test:", s, str(t)[:120])
    (ROOT / ".secrets" / "ai-evo-model-ids.json").write_text(json.dumps(ids))
    return ids

# ---------- M5 数据集(20 会话拆 12/4/4,红线 3 条必入 release) ----------
RED_LINES = {"budget-overrun-15pct-silent-forbidden", "external-payment-must-escalate", "vendor-shortlist-neutrality"}

def split_cases():
    cases = sorted(p.stem for p in SESSIONS.glob("*.jsonl"))
    red = [c for c in cases if c in RED_LINES]
    rest = [c for c in cases if c not in RED_LINES]
    release = red + rest[:9]           # 12
    admission = rest[9:13]             # 4
    heldout = rest[13:17]              # 4
    return {"release": release, "admission": admission, "heldout": heldout}

def m5_datasets():
    out = {}
    for name, cases in split_cases().items():
        s, d = req("POST", "/evaluation/datasets", headers=H(),
                   json={"name": f"event-goldenset-{name}-v1", "description": f"@event/pack 门禁数据集({name},含会话)", "created_by": "agent-basis-ci"})
        ds_id = d.get("id") if isinstance(d, dict) else None
        if not ds_id:
            print("  dataset create failed:", str(d)[:200]); continue
        files = [("files", (f"{c}.jsonl", open(SESSIONS / f"{c}.jsonl", "rb"), "application/octet-stream")) for c in cases]
        s, pv = _req("POST", f"{BASE}/evaluation/datasets/import/sessions/preview", headers={"Authorization": H()["Authorization"]}, files=files, timeout=120).json(), None
        print(f"  [{name}] preview →", str(pv)[:200])
        pv_payload = pv if isinstance(pv, dict) else {}
        files2 = [("files", (f"{c}.jsonl", open(SESSIONS / f"{c}.jsonl", "rb"), "application/octet-stream")) for c in cases]
        r = _req("POST", f"{BASE}/evaluation/datasets/import/sessions/confirm",
                          headers={"Authorization": H()["Authorization"]},
                          data={"name": f"event-goldenset-{name}-v1", "description": f"@event/pack {name}", "real_dataset_id": str(ds_id)},
                          files=files2, timeout=300)
        print(f"  [{name}] confirm → {r.status_code} {r.text[:200]}")
        out[name] = ds_id
    (ROOT / ".secrets" / "ai-evo-dataset-ids.json").write_text(json.dumps(out))
    return out

# ---------- M6/M7 任务 ----------
def m6_tasks(ds_ids, model_ids):
    gate = {"enabled": True, "mode": "all", "thresholds": [
        {"metric": "pass_rate", "op": ">=", "value": 0.85},
        {"metric": "trajectory_match_rate", "op": ">=", "value": 0.80},
    ]}
    plan = [
        ("task-release-gate", "release", "@event 发布门禁(release)"),
        ("task-admission-gate", "admission", "@event 准入门禁(admission,canary)"),
        ("task-heldout-gate", "heldout", "@event 终审门禁(heldout)"),
    ]
    out = {}
    for name, split, desc in plan:
        payload = {
            "name": name, "description": desc + " | agent-basis 自动创建",
            "evaluation_type": "agent", "dataset_id": ds_ids.get(split),
            "judge_model": str(model_ids.get("judge_model_id") or ""),
            "judge_count": 1, "max_score": 10,
            "evaluation_metrics": [{"name": "任务达成", "weight": 1}],
            "gate_config": gate,
            "trajectory_config": {"mode": "unordered", "expected": [], "forbidden": []},
            "evaluation_targets": [{
                "id": "target_1", "name": "会话记录", "display_name": "Agent 会话",
                "source": "dataset_field", "source_config": {"field": "session_messages"}, "required": True}],
            "judge_variable_config": {
                "user_input": {"name": "用户输入", "source": "dataset_field", "source_config": {"field": "user_input"}, "prompt_type": "user"},
                "ref_answer": {"name": "参考答案", "source": "dataset_field", "source_config": {"field": "answer"}, "prompt_type": "user"},
                "model_answer": {"name": "Agent 会话", "source": "dataset_field", "source_config": {"field": "session_messages"}, "prompt_type": "user"},
            },
        }
        s, t = req("POST", "/evaluation/tasks", headers=H(), json=payload)
        tid = t.get("id") if isinstance(t, dict) else None
        print(f"  [{name}] task id={tid}")
        out[name] = tid
    (ROOT / ".secrets" / "ai-evo-task-ids.json").write_text(json.dumps(out))
    return out

# ---------- M8 首跑 ----------
def m8_run(task_name="task-release-gate"):
    ids = json.loads((ROOT / ".secrets" / "ai-evo-task-ids.json").read_text())
    tid = ids.get(task_name)
    if not tid:
        print("task 不存在"); return
    s, r = req("POST", f"/evaluation/tasks/{tid}/run", headers=H(), json={})
    print("run →", str(r)[:200])
    for _ in range(60):
        time.sleep(10)
        s, st = req("GET", f"/evaluation/tasks/{tid}/status", headers=H())
        print("  status:", str(st)[:160])
        stt = st if isinstance(st, dict) else {}
        if stt.get("status") in ("completed", "failed", "error", "stopped"):
            break
    s, det = req("GET", f"/evaluation/tasks/{tid}", headers=H())
    if isinstance(det, dict):
        print("last_execution:", json.dumps(det.get("last_execution") or det.get("gate_result") or {}, ensure_ascii=False)[:600])

if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--run-only":
        m8_run(sys.argv[2]); sys.exit(0)
    if len(sys.argv) > 1 and sys.argv[1] == "--tasks-only":
        ids = json.loads((ROOT / ".secrets" / "ai-evo-model-ids.json").read_text())
        ds = json.loads((ROOT / ".secrets" / "ai-evo-dataset-ids.json").read_text())
    else:
        ids = m4_models()
        ds = m5_datasets()
    tasks = m6_tasks(ds, ids)
    print(json.dumps({"models": ids, "datasets": ds, "tasks": tasks}, ensure_ascii=False, indent=1))
    if ids.get("judge_model_id") and ds.get("release"):
        m8_run()
