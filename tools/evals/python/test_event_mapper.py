#!/usr/bin/env python3
"""EventMapper 真实样本回放单测(T17,设计文档 18 §6-2)。

fixture:docs/acp-real-6/notifications-sample.jsonl —— scripts/sample-notifications.mjs
用 python SDK 起真会话(budget_calc 工具路径 + pay_deposit 审批被拒不重试路径)采到的
原始 on_notification 通知,一行一条 {method, payload}。

回放断言:真实形态(Notification dataclass 序列化形 + session.event 包裹层级)能映射出
turns / tool_calls / approval 事件,seq/time 原样保留不伪造;无事件载荷的 method
(session.status 等)落 ignorable driver/notification。

运行:python3 -m unittest discover -s tools/evals/python -p 'test_*.py' -v
"""
from __future__ import annotations

import json
import unittest
from pathlib import Path

from dsh_eval_driver import EventMapper

REPO_ROOT = Path(__file__).resolve().parents[3]
SAMPLE_FILE = REPO_ROOT / "docs" / "acp-real-6" / "notifications-sample.jsonl"


class _FakeNotification:
    """duck 形 deepseek_harness.Notification(dataclass:method/payload,
    python/sdk/src/deepseek_harness/client.py:473)—— 单测不依赖 SDK 安装。"""

    def __init__(self, method: str, payload: dict) -> None:
        self.method = method
        self.payload = payload


def _load_sample() -> list[dict]:
    lines = SAMPLE_FILE.read_text(encoding="utf-8").splitlines()
    return [json.loads(line) for line in lines if line.strip()]


def _metrics(events: list[dict]) -> dict:
    turns: set[int] = set()
    tool_calls: list[str] = []
    asked: list[str] = []
    decided: list[str] = []
    for event in events:
        kind = event["type"]
        data = event.get("data") or {}
        if kind == "turn/start" and isinstance(data.get("turn"), int):
            turns.add(data["turn"])
        elif kind == "tool/call" and isinstance(data.get("name"), str):
            tool_calls.append(data["name"])
        elif kind == "approval/asked" and isinstance(data.get("toolName"), str):
            asked.append(data["toolName"])
        elif kind == "approval/decided" and isinstance(data.get("outcome"), str):
            decided.append(data["outcome"])
    return {"turns": len(turns), "tool_calls": tool_calls, "asked": asked, "decided": decided}


class RealSampleReplayTest(unittest.TestCase):
    """真实通知样本 → EventMapper → turns/tool_calls/approval 事件齐全。"""

    @classmethod
    def setUpClass(cls) -> None:
        cls.assertTrue(SAMPLE_FILE.exists(), f"样本文件缺失:{SAMPLE_FILE}")
        cls.sample = _load_sample()
        mapper = EventMapper()
        cls.events: list[dict] = []
        for record in cls.sample:
            cls.events.extend(mapper.map(record))

    def test_sample_size(self) -> None:
        self.assertGreaterEqual(len(self.sample), 10, "样本不足 10 条")

    def test_turns_mapped(self) -> None:
        # 两条会话各自 turn 从 1 编号(合并回放去重后仍 ≥1;TS summarize 为单会话视角)
        metrics = _metrics(self.events)
        self.assertGreaterEqual(metrics["turns"], 1, "至少映射出 1 个 turn")
        self.assertGreaterEqual(len([e for e in self.events if e["type"] == "turn/start"]), 2,
                                "两条会话各 1 次 turn/start")

    def test_tool_calls_mapped(self) -> None:
        names = _metrics(self.events)["tool_calls"]
        self.assertIn("budget_calc", names, "sample-tools 会话的 budget_calc 调用未被映射")
        self.assertIn("pay_deposit", names, "sample-approval 会话的 pay_deposit 调用未被映射")

    def test_approval_events_mapped(self) -> None:
        metrics = _metrics(self.events)
        self.assertIn("pay_deposit", metrics["asked"], "approval/asked 未映射出 pay_deposit")
        self.assertIn("rejected", metrics["decided"], "approval/decided 未映射出 rejected")
        # asked/decided 按 id 配对
        asked = [e for e in self.events if e["type"] == "approval/asked"]
        decided = [e for e in self.events if e["type"] == "approval/decided"]
        self.assertEqual(asked[0]["data"]["id"], decided[0]["data"]["id"])

    def test_user_and_assistant_message_mapped(self) -> None:
        types = [event["type"] for event in self.events]
        self.assertIn("user/message", types)
        self.assertIn("assistant/message", types)

    def test_seq_time_preserved_not_fabricated(self) -> None:
        """session.event 载荷的 seq/time 原样透传(三元组逐一可在样本中找到)。"""
        wire = {
            (event["type"], event["seq"], event["time"])
            for record in self.sample
            if record.get("method") == "session.event"
            for event in [record["payload"].get("event", {})]
            if isinstance(event, dict) and "type" in event
        }
        for event in self.events:
            if event["type"] == "driver/notification":
                continue
            self.assertIn(
                (event["type"], event["seq"], event["time"]),
                wire,
                f"映射产物在真实样本中无对应 wire 事件:{event['type']} seq={event['seq']}",
            )
            self.assertIsInstance(event["seq"], int)
            self.assertIsInstance(event["time"], int)

    def test_non_event_methods_kept_as_ignorable(self) -> None:
        """session.status 等无事件载荷通知 → ignorable driver/notification,不参与断言。"""
        ignorable = [
            event
            for event in self.events
            if event["type"] == "driver/notification" and event.get("ignorable") is True
        ]
        self.assertGreaterEqual(len(ignorable), 1, "session.status 未保留为 ignorable 记录")
        methods = {event["data"]["method"] for event in ignorable}
        self.assertIn("session.status", methods)


class ShapeCompatibilityTest(unittest.TestCase):
    """形态兼容:Notification dataclass / JSON-RPC {method,params} / 批 sessionEvents / 直接事件包。"""

    def test_sdk_notification_dataclass(self) -> None:
        notification = _FakeNotification("session.event", {
            "sessionId": "s1",
            "event": {"type": "turn/start", "seq": 4, "time": 1793764891656, "data": {"turn": 1}},
        })
        self.assertEqual(EventMapper().map(notification), [
            {"type": "turn/start", "seq": 4, "time": 1793764891656, "data": {"turn": 1}},
        ])

    def test_jsonrpc_params_event(self) -> None:
        notification = {"jsonrpc": "2.0", "method": "session.event", "params": {
            "sessionId": "s1",
            "event": {"type": "tool/call", "seq": 16, "time": 42, "data": {"name": "budget_calc"}},
        }}
        events = EventMapper().map(notification)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["type"], "tool/call")
        self.assertEqual(events[0]["seq"], 16)

    def test_params_session_events_batch(self) -> None:
        notification = {"method": "session/tree", "params": {"sessionEvents": [
            {"type": "turn/start", "seq": 1, "time": 1, "data": {"turn": 1}},
            {"type": "user/message", "seq": 2, "time": 2, "data": {}},
        ]}}
        events = EventMapper().map(notification)
        self.assertEqual([event["type"] for event in events], ["turn/start", "user/message"])

    def test_direct_event_package(self) -> None:
        events = EventMapper().map({"type": "assistant/message", "seq": 7, "time": 9, "data": {}})
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["type"], "assistant/message")

    def test_ignorable_flag_preserved(self) -> None:
        notification = _FakeNotification("session.event", {
            "sessionId": "s1",
            "event": {"type": "session/title", "seq": 3, "time": 5, "data": {"title": "t"}, "ignorable": True},
        })
        events = EventMapper().map(notification)
        self.assertIs(events[0].get("ignorable"), True)

    def test_non_event_method_becomes_ignorable(self) -> None:
        events = EventMapper().map({"method": "subagent.started", "params": {"parentSessionId": "a", "childSessionId": "b"}})
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["type"], "driver/notification")
        self.assertIs(events[0]["ignorable"], True)
        self.assertEqual(events[0]["data"]["method"], "subagent.started")

    def test_garbage_returns_empty(self) -> None:
        mapper = EventMapper()
        for garbage in ("note a dict", 42, None, [], {}, {"no-method": 1}):
            self.assertEqual(mapper.map(garbage), [], f"垃圾输入应映射为空:{garbage!r}")

    def test_missing_seq_time_filled(self) -> None:
        """事件包缺 seq/time 时补齐(透传纪律),type 保留。"""
        events = EventMapper().map(_FakeNotification("session.event", {
            "sessionId": "s", "event": {"type": "turn/start", "data": {"turn": 1}},
        }))
        self.assertEqual(events[0]["type"], "turn/start")
        self.assertIsInstance(events[0]["seq"], int)
        self.assertIsInstance(events[0]["time"], int)


if __name__ == "__main__":
    unittest.main()
