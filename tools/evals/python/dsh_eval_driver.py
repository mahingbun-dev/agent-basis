#!/usr/bin/env python3
"""DSH eval driver —— @basis/evals acp 适配器的子进程驱动。

经 DSH 官方 Python SDK(`deepseek-harness-sdk`,../dsh-repo/python/sdk/README.md)
驱动一次真实 DSH session 跑 golden case,按 NDJSON 协议向 stdout 输出:

    {"kind": "session", "session_id": "..."}
    {"kind": "event",  "event": {"type": "...", "seq": N, "time": ms, "data": {...}}}
    {"kind": "done",   "finish_reason": "...", "final_response": "..."}
    {"kind": "error",  "message": "..."}

协议消费方:tools/evals/src/adapters/acp.ts(AcpAdapter)。

运行前提(2026-11-04 真跑打通,docs/acp-real-6/):pip 安装 deepseek-harness-sdk
(pip -e dsh-repo/python/sdk)+ DSH_HOME 隔离目录(~/.dsh-evals,sdk profile 经
litellm 路由)+ LITELLM_API_KEY 环境变量;dsh_bin 指向 npm 全局 dsh
(/opt/homebrew/bin/dsh,避开同名 pip 包装脚本)。
真实通知样本的采集与回放:scripts/sample-notifications.mjs +
tools/evals/python/test_event_mapper.py(样本 fixture 断言)。

事件映射口径(T17 真实样本实证,docs/acp-real-6/notifications-sample.jsonl):
SDK 的 on_notification 回调逐条投递 Session 树通知(wire order),收到的是
deepseek_harness Notification **dataclass**(method/payload,
python/sdk/src/deepseek_harness/client.py:473),不是 dict —— 旧版按 dict 解析
导致全部通知被丢弃(turns=0 根因②)。实际形态:
  ⓪ session.event → payload = {sessionId, event: {type, seq, time, data, ignorable?}}
    (事件本体自带 seq/time,原样透传;ignorable 保留)
  ① 其余 method(session.status / subagent.* / session.query.completed /
    user-question.cancelled)无事件载荷 → ignorable driver/notification 保留可观测性;
  ② 兼容 dict 形态(测试桩/历史样本):直接事件包 {type,...}、JSON-RPC {method, params}
    (params.event 单包 / params.sessionEvents 批)。
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


class EventMapper:
    """把 SDK 通知规整为 DSH SessionEvent 包形态(输入见模块 docstring 的形态清单)。"""

    def __init__(self) -> None:
        self._seq = 0

    def map(self, notification: object) -> list[dict]:
        """一条通知 → 0..n 个事件包(批形态 sessionEvents 可一包多事件)。"""
        record = _as_dict(notification)
        if record is not None and isinstance(record.get("type"), str):
            # 形态 ②a:已是事件包 {type, seq, time, data}
            normalized = self._normalize(record)
            return [normalized] if normalized is not None else []
        parts = _notification_parts(notification)
        if parts is None:
            return []
        method, params = parts
        inner = params if isinstance(params, dict) else {}
        events: list[dict] = []
        for candidate in _event_candidates(inner):
            normalized = self._normalize(candidate)
            if normalized is not None:
                events.append(normalized)
        if events:
            return events
        if isinstance(method, str) and method:
            # 形态 ①:无事件载荷的 method → ignorable 记录(保留可观测性,不参与断言)
            return [self._ignorable(method, inner)]
        return []

    def _normalize(self, event: dict) -> dict | None:
        if not isinstance(event.get("type"), str):
            return None
        record = {
            "type": event["type"],
            "seq": _int_or(event.get("seq"), self._next_seq()),
            "time": _int_or(event.get("time"), _now_ms()),
            "data": event.get("data") if isinstance(event.get("data"), dict) else {},
        }
        if event.get("ignorable") is True:
            record["ignorable"] = True
        return record

    def _ignorable(self, method: str, params: dict) -> dict:
        now = _now_ms()
        return {
            "type": "driver/notification",
            "seq": now,
            "time": now,
            "data": {"method": method, "params": params},
            "ignorable": True,
        }

    def _next_seq(self) -> int:
        self._seq += 1
        return self._seq


def _notification_parts(notification: object) -> tuple[object, object] | None:
    """从 Notification dataclass(形态 ⓪)或 dict JSON-RPC 包(形态 ②)取 (method, params)。"""
    if not isinstance(notification, dict):
        method = getattr(notification, "method", None)
        if isinstance(method, str):
            return (method, getattr(notification, "payload", None))
        return None
    method = notification.get("method")
    if not isinstance(method, str):
        return None
    params = notification.get("params")
    if not isinstance(params, dict):
        params = notification.get("payload")
    return (method, params)


def _event_candidates(inner: dict) -> list[dict]:
    """事件载荷候选:params/params.event 单包(实证主形态)与 params.sessionEvents 批。"""
    candidates: list[object] = []
    single = inner.get("event")
    if single is not None:
        candidates.append(single)
    batch = inner.get("sessionEvents")
    if isinstance(batch, list):
        candidates.extend(batch)
    return [item for item in candidates if isinstance(item, dict)]


def _as_dict(value: object) -> dict | None:
    if isinstance(value, dict):
        return value
    return None


def _int_or(value: object, fallback: int) -> int:
    return value if isinstance(value, int) else fallback


def _now_ms() -> int:
    return int(time.time() * 1000)


def _pick_default_dsh() -> str | None:
    """选 npm 安装的 dsh CLI:跳过 pip 包的 python 包装脚本(同名的 runtime 启动器)。"""
    import shutil

    candidates = [shutil.which("dsh"), "/opt/homebrew/bin/dsh", "/usr/local/bin/dsh"]
    for cand in candidates:
        if not cand:
            continue
        try:
            with open(cand, "rb") as fh:
                head = fh.read(64)
        except OSError:
            continue
        # python 包装脚本(#!... python)是 deepseek-harness-sdk 的 runtime 启动器,不是 node CLI
        if head.startswith(b"#!") and b"python" in head:
            continue
        return cand
    return None


def main() -> int:
    line = sys.stdin.readline()
    if not line.strip():
        emit({"kind": "error", "message": "stdin 未提供配置 JSON"})
        return 1
    try:
        config = json.loads(line)
    except json.JSONDecodeError as cause:
        emit({"kind": "error", "message": f"配置不是合法 JSON: {cause}"})
        return 1

    try:
        from deepseek_harness import DeepSeekHarness
    except ImportError as cause:
        emit({
            "kind": "error",
            "message": (
                "deepseek-harness-sdk 未安装(pip install deepseek-harness-sdk);"
                f"acp 适配器真实运行列入 blockers —— {cause}"
            ),
        })
        return 2

    mapper = EventMapper()
    lock = threading.Lock()

    def on_notification(notification: object) -> None:
        try:
            events = mapper.map(notification)
        except Exception:  # noqa: BLE001 —— 单条通知失败不拖垮整轮
            events = []
        with lock:
            for event in events:
                emit({"kind": "event", "event": event})

    kwargs: dict = {
        "cwd": config.get("cwd") or None,
    }
    for key in ("dsh_home", "provider", "model", "reasoning_effort", "max_tokens"):
        value = config.get(key)
        if value is not None:
            kwargs[key] = value
    # SDK 默认模型(deepseek-v4-flash)与网关目录(deepseek-flash)不一致时回落到目录内模型
    if "model" not in kwargs:
        kwargs["model"] = "deepseek-flash"
    # 2026-11-04 联调补充:dsh_bin(本地无打包 runtime 闭包时指向全局 dsh CLI)与 env 注入。
    # 子进程默认继承父环境——dsh-evals 启动时带上 LITELLM_API_KEY 即可;env 字段用于显式覆盖。
    dsh_bin = config.get("dsh_bin") or os.environ.get("DSH_EVALS_DSH_BIN") or _pick_default_dsh()
    if dsh_bin:
        kwargs["dsh_bin"] = dsh_bin
    if isinstance(config.get("env"), dict):
        kwargs["env"] = config["env"]

    approval_response = config.get("approval_response")
    responder: threading.Thread | None = None
    if approval_response is not None:
        # 审批红线 case:SDK 侧接管审批(approval_requests=True)+ 编程应答器。
        # 应答面在 HarnessClient(facade 不代理):harness.client.next_request()/respond()
        # (python/sdk/README.md「Client approvals」)。
        kwargs["approval_requests"] = True
    try:
        harness = DeepSeekHarness(**kwargs)
    except TypeError:
        # 老版本 SDK 可能不接受部分关键字——逐个降级重试一次
        for key in ("reasoning_effort", "max_tokens", "approval_requests"):
            kwargs.pop(key, None)
        harness = DeepSeekHarness(**kwargs)

    try:
        if approval_response is not None and kwargs.get("approval_requests") is True:
            responder = threading.Thread(
                target=_answer_approvals,
                args=(harness, approval_response),
                daemon=True,
            )
            responder.start()

        result = harness.start_session(config.get("session_id") or None).run(
            config["user_input"], on_notification=on_notification
        )
        emit({"kind": "session", "session_id": getattr(result, "session_id", "") or ""})
        emit({
            "kind": "done",
            "finish_reason": getattr(result, "finish_reason", "") or "",
            "final_response": getattr(result, "final_response", "") or "",
        })
        return 0
    except Exception as cause:  # noqa: BLE001 —— 任何失败都走 error 协议,不伪造结果
        emit({"kind": "error", "message": f"运行失败: {type(cause).__name__}: {cause}"})
        return 3


def _answer_approvals(harness: object, outcome: str) -> None:
    """应答 approval 请求:next_request/respond 在 HarnessClient(facade 不代理)。失败即退出线程。"""
    client = getattr(harness, "client", None)
    next_request = getattr(client, "next_request", None)
    respond = getattr(client, "respond", None)
    if not callable(next_request) or not callable(respond):
        now = _now_ms()
        emit({
            "kind": "event",
            "event": {
                "type": "driver/notification",
                "seq": now,
                "time": now,
                "data": {"note": "SDK 未暴露 approval 应答面,approval_response 配置未生效"},
                "ignorable": True,
            },
        })
        return
    while True:
        try:
            request = next_request()
        except Exception:  # noqa: BLE001 —— 通道关闭即退出
            return
        if request is None:
            return
        if getattr(request, "method", "") != "approval/request":
            try:
                respond_error = getattr(client, "respond_error", None)
                if callable(respond_error):
                    respond_error(request.id, code=-32601, message="driver: unsupported client request")
            except Exception:  # noqa: BLE001
                return
            continue
        decision = {"outcome": outcome}
        try:
            respond(request.id, decision)
        except Exception:  # noqa: BLE001
            return


if __name__ == "__main__":
    sys.exit(main())
