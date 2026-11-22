"""
Integration tests for ExpresaT Backend.

Validates CORS allowlist, `/health` and `/labels`, Supabase JWT verification
across development and production, 15-frame deque buffering, and WebSocket auth.
"""

import os
import asyncio
import unittest
from collections import deque

os.environ["FASTAPI_ENV"] = "development"
os.environ["EXPRESAT_DEMO_MODE"] = "true"

from backend.main import (
    app,
    verify_supabase_token,
    is_origin_allowed,
    websocket_translate,
    CORS_ORIGINS_DEFAULT,
    health_check,
    detailed_health,
    get_labels,
    ConnectionManager,
    run_inference_async
)
from backend.demo_rules import DEMO_LABELS
from fastapi import WebSocketDisconnect


class FakeWebSocket:
    def __init__(self, headers=None, incoming=None):
        self.headers = headers or {}
        self._incoming = list(incoming or [])
        self.accepted = False
        self.closed_code = None
        self.closed_reason = None
        self.sent_messages = []

    async def accept(self):
        self.accepted = True

    async def close(self, code=1000, reason=None):
        self.closed_code = code
        self.closed_reason = reason

    async def receive_json(self):
        if not self._incoming:
            raise WebSocketDisconnect(code=1000)
        return self._incoming.pop(0)

    async def send_json(self, message):
        self.sent_messages.append(message)


class TestApiIntegration(unittest.TestCase):
    def test_cors_origins(self):
        """Verify default CORS origins include expected dev and Netlify domains."""
        self.assertIn("http://localhost:5173", CORS_ORIGINS_DEFAULT)
        self.assertIn("http://127.0.0.1:5173", CORS_ORIGINS_DEFAULT)
        self.assertIn("https://expresat.netlify.app", CORS_ORIGINS_DEFAULT)

    def test_health_endpoint(self):
        """Verify health_check coroutine payload."""
        data = asyncio.run(health_check())
        self.assertEqual(data["status"], "ok")
        self.assertIn("demo_mode", data)
        self.assertIn("model_loaded", data)

    def test_labels_endpoint(self):
        """Verify get_labels returns DEMO_LABELS in demo mode."""
        data = asyncio.run(get_labels())
        self.assertIn("labels", data)
        self.assertEqual(data["labels"], DEMO_LABELS)
        self.assertEqual(data["count"], len(DEMO_LABELS))

    def test_token_verification(self):
        """Verify JWT handling in development vs. production mode."""
        self.assertTrue(verify_supabase_token("mock_token"))
        self.assertTrue(verify_supabase_token("demo_fallback_token"))

        old_env = os.environ.get("FASTAPI_ENV")
        try:
            os.environ["FASTAPI_ENV"] = "production"
            self.assertFalse(verify_supabase_token("mock_token"))
            self.assertFalse(verify_supabase_token("demo_fallback_token"))
            self.assertFalse(verify_supabase_token(None))
        finally:
            if old_env:
                os.environ["FASTAPI_ENV"] = old_env

    def test_frame_buffer_deque(self):
        """Verify deque(maxlen=15) keeps the latest 15 frames."""
        buf = deque(maxlen=15)
        for i in range(25):
            buf.append({"frame_id": i})
        self.assertEqual(len(buf), 15)
        self.assertEqual(buf[0]["frame_id"], 10)
        self.assertEqual(buf[-1]["frame_id"], 24)

    def test_run_inference_async_in_demo_mode(self):
        """Verify run_inference_async responds in demo mode."""
        empty_frames = [{"landmarks": []} for _ in range(15)]
        result = asyncio.run(run_inference_async(empty_frames))
        self.assertIsInstance(result, dict)
        self.assertTrue(result.get("is_demo", False))
        self.assertIn("all_probabilities", result)

    def test_ws_connects_in_demo_mode_without_token(self):
        """Verify /ws/translate accepts unauthenticated connection when EXPRESAT_DEMO_MODE=true."""
        os.environ["EXPRESAT_DEMO_MODE"] = "true"
        os.environ["FASTAPI_ENV"] = "production"
        ws = FakeWebSocket(
            headers={"origin": "http://localhost:5173"},
            incoming=[{"type": "ping"}]
        )
        asyncio.run(websocket_translate(ws, token=None))
        self.assertTrue(ws.accepted)
        self.assertIsNone(ws.closed_code)
        self.assertEqual(ws.sent_messages, [{"type": "pong"}])

    def test_ws_rejects_without_token_when_demo_mode_disabled(self):
        """Verify /ws/translate closes with 1008 without token when EXPRESAT_DEMO_MODE=false."""
        old_demo = os.environ.get("EXPRESAT_DEMO_MODE")
        old_env = os.environ.get("FASTAPI_ENV")
        try:
            os.environ["EXPRESAT_DEMO_MODE"] = "false"
            os.environ["FASTAPI_ENV"] = "production"
            ws = FakeWebSocket(headers={"origin": "http://localhost:5173"})
            asyncio.run(websocket_translate(ws, token=None))
            self.assertFalse(ws.accepted)
            self.assertEqual(ws.closed_code, 1008)
            self.assertIn("Token ausente", ws.closed_reason)
        finally:
            os.environ["EXPRESAT_DEMO_MODE"] = old_demo or "true"
            os.environ["FASTAPI_ENV"] = old_env or "development"

    def test_ws_rejects_unauthorized_origin(self):
        """Verify /ws/translate closes with 1008 when Origin is not in CORS_ORIGINS."""
        ws = FakeWebSocket(headers={"origin": "https://malicious.example.com"})
        asyncio.run(websocket_translate(ws, token=None))
        self.assertFalse(ws.accepted)
        self.assertEqual(ws.closed_code, 1008)
        self.assertIn("Origin no autorizado", ws.closed_reason)


if __name__ == "__main__":
    unittest.main()
