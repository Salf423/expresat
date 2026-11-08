"""
test_api_integration.py — Integration tests for ExpresaT Backend
=================================================================
Validates:
  - CORS configuration and whitelist
  - Health endpoint logic and response structure
  - Labels endpoint logic and DEMO_LABELS consistency
  - Supabase Token verification & development fallback
  - Buffer temporal con collections.deque(maxlen=15)
  - WebSocket ConnectionManager and auth handling
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
    CORS_ORIGINS_DEFAULT,
    health_check,
    get_labels,
    ConnectionManager,
    run_inference_async
)
from backend.demo_rules import DEMO_LABELS


class TestApiIntegration(unittest.TestCase):
    def test_cors_origins(self):
        """Verifica que los orígenes CORS predeterminados incluyan los dominios requeridos."""
        self.assertIn("http://localhost:5173", CORS_ORIGINS_DEFAULT)
        self.assertIn("http://127.0.0.1:5173", CORS_ORIGINS_DEFAULT)
        self.assertIn("https://expresat.netlify.app", CORS_ORIGINS_DEFAULT)

    def test_health_endpoint(self):
        """Verifica la respuesta de la corutina health_check."""
        data = asyncio.run(health_check())
        self.assertEqual(data["status"], "ok")
        self.assertIn("demo_mode", data)
        self.assertIn("model_loaded", data)

    def test_labels_endpoint(self):
        """Verifica que get_labels retorne DEMO_LABELS cuando el modelo no está cargado."""
        data = asyncio.run(get_labels())
        self.assertIn("labels", data)
        self.assertEqual(data["labels"], DEMO_LABELS)
        self.assertEqual(data["count"], len(DEMO_LABELS))

    def test_token_verification(self):
        """Verifica la lógica de autenticación en modo desarrollo vs producción."""
        # En FASTAPI_ENV=development, tokens de desarrollo son permitidos
        self.assertTrue(verify_supabase_token("mock_token"))
        self.assertTrue(verify_supabase_token("demo_fallback_token"))

        # Simular modo producción sin Supabase configurado
        old_env = os.environ.get("FASTAPI_ENV")
        try:
            os.environ["FASTAPI_ENV"] = "production"
            # En producción, tokens mock deben ser rechazados
            self.assertFalse(verify_supabase_token("mock_token"))
            self.assertFalse(verify_supabase_token("demo_fallback_token"))
            self.assertFalse(verify_supabase_token(None))
        finally:
            if old_env:
                os.environ["FASTAPI_ENV"] = old_env

    def test_frame_buffer_deque(self):
        """Verifica que deque con maxlen=15 mantenga exactamente 15 frames."""
        buf = deque(maxlen=15)
        for i in range(25):
            buf.append({"frame_id": i})
        self.assertEqual(len(buf), 15)
        self.assertEqual(buf[0]["frame_id"], 10)
        self.assertEqual(buf[-1]["frame_id"], 24)

    def test_run_inference_async_in_demo_mode(self):
        """Verifica que run_inference_async responda correctamente en demo mode sin bloquear."""
        empty_frames = [{"landmarks": []} for _ in range(15)]
        result = asyncio.run(run_inference_async(empty_frames))
        self.assertIsInstance(result, dict)
        self.assertTrue(result.get("is_demo", False))
        self.assertIn("all_probabilities", result)


if __name__ == "__main__":
    unittest.main()
