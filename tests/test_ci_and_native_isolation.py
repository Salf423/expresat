"""
TDD verification for Fase D (Commit 9):
  - `.github/workflows/train_model.yml` targets `expresat/models/exported_model/`,
    executes smoke tests exclusively in a temporary directory, never commits smoke
    artifacts, and enforces Macro-F1, INT8 quantization, ONNX parity, latency,
    calibration, and `IncompatibleFeatureSpecError` gates.
  - Branch governance and explicit isolation/block of `expresat-native/` + retirement
    of the legacy C++ dataset generator are documented canonically.
"""

from __future__ import annotations

import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


class TestCIWorkflowAndNativeIsolation(unittest.TestCase):
    def test_train_model_workflow_v140_gates_and_canonical_paths(self):
        wf_path = REPO_ROOT / ".github" / "workflows" / "train_model.yml"
        self.assertTrue(wf_path.exists(), "Missing .github/workflows/train_model.yml")
        content = wf_path.read_text(encoding="utf-8")

        # Must NEVER target legacy root ./exported_model or legacy GRU-only filename
        self.assertNotIn("./exported_model", content)
        self.assertNotIn("exported_model/expresat_gru_int8.onnx", content)

        # Must target canonical expresat/models/exported_model
        self.assertIn("expresat/models/exported_model", content)

        # Smoke test must run in a temporary directory and never commit smoke weights
        self.assertIn("--allow-synthetic-smoke-test", content)
        self.assertTrue(
            "/tmp/" in content or "runner.temp" in content,
            "Smoke test output must be directed to a temporary directory",
        )
        self.assertIn("production_ready", content)

        # Must enforce v1.4.0 training, quantization, parity, latency, calibration, and spec guards
        self.assertIn("val_macro_f1", content)
        self.assertIn("quantized_pct", content)
        self.assertIn("fp32_logit_linf", content)
        self.assertIn("int8_prob_linf", content)
        self.assertIn("p99_ms", content)
        self.assertIn("ece_after", content)
        self.assertIn("IncompatibleFeatureSpecError", content)
        self.assertIn("unittest discover -s tests", content)

        # Optional YAML parse check if PyYAML is installed
        try:
            import yaml  # type: ignore

            parsed = yaml.safe_load(content)
            self.assertIsInstance(parsed, dict)
            self.assertIn("jobs", parsed)
        except ImportError:
            pass

    def test_native_isolation_and_cpp_generator_retirement_documented(self):
        # 1. Dedicated isolation policy document
        policy_doc = REPO_ROOT / "docs" / "NATIVE_ISOLATION_POLICY.md"
        self.assertTrue(policy_doc.exists(), "Missing docs/NATIVE_ISOLATION_POLICY.md")
        policy_txt = policy_doc.read_text(encoding="utf-8")
        self.assertIn("dataset-v2", policy_txt)
        self.assertIn("expresat-native/", policy_txt)
        self.assertIn("ERR_CPP_NOT_CONFORMANT", policy_txt)
        self.assertIn("ExtractWindow", policy_txt)
        self.assertIn("1.4.0", policy_txt)

        # 2. expresat-dataset-generator/README.md updated to v1.4.0 JS<->Python pipeline (no legacy C++ generator)
        gen_readme = (REPO_ROOT / "expresat-dataset-generator" / "README.md").read_text(encoding="utf-8")
        self.assertIn("build_dataset_v140.py", gen_readme)
        self.assertIn("validate_recording.py", gen_readme)
        self.assertIn("1.4.0", gen_readme)
        self.assertIn("ERR_CPP_NOT_CONFORMANT", gen_readme)
        self.assertNotIn("build_release/expresat_dataset_generator", gen_readme)

        # 3. DECISIONES.md records v1.4.0 consolidation and expresat-native block
        dec_txt = (REPO_ROOT / "docs" / "dataset-generator" / "DECISIONES.md").read_text(encoding="utf-8")
        self.assertIn("ERR_CPP_NOT_CONFORMANT", dec_txt)
        self.assertIn("expresat-native/", dec_txt)
        self.assertIn("DS-TCN", dec_txt)

        # 4. No legacy C++ generator files or active expresat-native/ tree inside dataset-v2
        self.assertFalse((REPO_ROOT / "expresat-native").exists())
        gen_dir = REPO_ROOT / "expresat-dataset-generator"
        self.assertEqual(list(gen_dir.rglob("*.cpp")), [])
        self.assertEqual(list(gen_dir.rglob("CMakeLists.txt")), [])


if __name__ == "__main__":
    unittest.main()
