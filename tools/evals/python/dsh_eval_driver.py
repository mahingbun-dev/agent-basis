#!/usr/bin/env python3
"""DSH eval driver —— @basis/evals acp 适配器的子进程驱动。

经 DSH 官方 Python SDK(`deepseek-harness-sdk`,../dsh-repo/python/sdk/README.md)
驱动一次真实 DSH session 跑 golden case,按 NDJSON 协议向 stdout 输出:

    {"kind": "session", "session_id": "..."}
    {"kind": "event",  "event": {"type": "...", "seq": N, "time": ms, "data": {...}}}
    {"kind": "done",   "finish_reason": "...", "final_response": "..."}
    {"kind": "error",  "message": "..."}

协议消费方:tools/evals/src/adapters/acp.ts(AcpAdapter)。

阻塞说明(列入 blockers):真实运行需要
  1) pip install deepseek-harness-sdk(带平台 runtime wheel);
  2) DSH_HOME 隔离目录 + provider/model 凭据(DEEPSEEK_API_KEY 等)。
本脚本按 python/sdk/README.md 的公开 API 编写,未做运行时联调
(TS 侧管线由 tests/acp.adapter.spec.ts 用同协议 stub 真跑覆盖)。

事件映射口径:SDK 的 on_notification 回调逐条投递 Session 树通知(wire order)。
通知体若已是 DSH SessionEvent 形态({type, seq, time, data})则原样透传;
否则尽力从 params 中提取,提取不出时补 seq/time 后透传,由 TS 侧 coerceEvent
再校验(不伪造、不吞错——TS 侧把无法解析的行记为 notes)。
"""

from __future__ import annotations

import json
import sys
import threading
import time


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


class EventMapper:
    """把 SDK 通知规整为 DSH SessionEvent 包形态。"""

    def __init__(self) -> None:
        self._seq = 0

    def map(self, notification: object) -> dict | None:
        record = _as_dict(notification)
        if record is None:
            return None
        # 形态 ①:已是事件包 {type, seq, time, data}
        if isinstance(record.get("type"), str):
            return {
                "type": record["type"],
                "seq": _int_or(record.get("seq"), self._next_seq()),
                "time": _int_or(record.get("time"), _now_ms()),
                "data": record.get("data", {}),
            }
        # 形态 ②:JSON-RPC 通知 {method, params}——事件可能在 params 里
        params = record.get("params")
        inner = _as_dict(params)
        if inner is not None and isinstance(inner.get("type"), str):
            return {
                "type": inner["type"],
                "seq": _int_or(inner.get("seq"), self._next_seq()),
                "time": _int_or(inner.get("time"), _now_ms()),
                "data": inner.get("data", {}),
            }
        method = record.get("method")
        if isinstance(method, str):
            # 形态 ③:只有 method 的通知,保守透传为 ignorable 记录
            self._seq += 1
            return {
                "type": "driver/notification",
                "seq": self._seq,
                "time": _now_ms(),
                "data": {"method": method, "params": params},
                "ignorable": True,
            }
        return None

    def _next_seq(self) -> int:
        self._seq += 1
        return self._seq


def _as_dict(value: object) -> dict | None:
    if isinstance(value, dict):
        return value
    return None


def _int_or(value: object, fallback: int) -> int:
    return value if isinstance(value, int) else fallback


def _now_ms() -> int:
    return int(time.time() * 1000)


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
            event = mapper.map(notification)
        except Exception:  # noqa: BLE001 —— 单条通知失败不拖垮整轮
            event = None
        if event is None:
            return
        with lock:
            emit({"kind": "event", "event": event})

    kwargs: dict = {
        "cwd": config.get("cwd") or None,
        "on_notification": on_notification,
    }
    for key in ("dsh_home", "provider", "model", "reasoning_effort", "max_tokens"):
        value = config.get(key)
        if value is not None:
            kwargs[key] = value

    approval_response = config.get("approval_response")
    responder: threading.Thread | None = None
    try:
        harness = DeepSeekHarness(**kwargs)
    except TypeError:
        # 老版本 SDK 可能不接受部分关键字——逐个降级重试一次
        for key in ("reasoning_effort", "max_tokens"):
            kwargs.pop(key, None)
        harness = DeepSeekHarness(**kwargs)

    try:
        if approval_response is not None:
            # 审批红线 case:以编程应答器回答 permission prompt
            # (python/sdk/README.md「Client approvals」:approval_requests=True
            #  且 handler 就绪;真实联调时验证 API 形态 —— blockers)
            responder = threading.Thread(
                target=_answer_approvals,
                args=(harness, approval_response),
                daemon=True,
            )
            responder.start()

        result = harness.run(config["user_input"], session_id=config.get("session_id") or None)
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
    """尽力应答 approval 请求(需要 SDK 暴露 next_request/respond;失败即退出线程)。"""
    next_request = getattr(harness, "next_request", None)
    respond = getattr(harness, "respond", None)
    if not callable(next_request) or not callable(respond):
        emit({
            "kind": "event",
            "event": {
                "type": "driver/notification",
                "seq": int(time.time() * 1000),
                "time": _now_ms(),
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
        decision = {"outcome": outcome} if outcome != "allowed-once" else {"outcome": "allowed-once"}
        try:
            respond(getattr(request, "id", None), decision)
        except Exception:  # noqa: BLE001
            return


if __name__ == "__main__":
    sys.exit(main())
