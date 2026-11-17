"""
ExpresaT backend global configuration.

Supported environment variables:
  - EXPRESAT_DEMO_MODE:
      When "true" (default), uses deterministic geometric rules (`demo_rules.py`)
      and allows `/ws/translate` connections without a Supabase JWT token.
      When "false", requires a valid Supabase JWT in production and uses `InferenceEngine`.
  - FASTAPI_ENV:
      "development" | "production" (default: "production").
  - CORS_ORIGINS:
      Comma-separated origin allowlist for HTTP CORS and WebSocket Origin checks.
"""

import os


def is_demo_mode_enabled() -> bool:
    """Evaluate EXPRESAT_DEMO_MODE dynamically to support runtime/test overrides."""
    return os.getenv("EXPRESAT_DEMO_MODE", "true").strip().lower() in ("true", "1", "yes", "on")


DEMO_MODE: bool = is_demo_mode_enabled()
