"""
ExpresaT v1.4.0 Training, Fair A/B Ablation, Calibration & Single-File INT8 ONNX Export.

Consumes exclusively Stage-2 `.npy` shards (`mmap_mode='r'`) + `manifest.json`
sealed against `FEATURE_SPEC v1.4.0` and canonical `config_hash`.

Zero silent synthetic fallback: fails explicitly if no valid dataset manifest exists
unless `--allow-synthetic-smoke-test` is explicitly supplied (in which case exported
artifacts are permanently marked `is_smoke_test=true`, `production_ready=false`).

Architectures compared in fair A/B ablation (identical splits, seed, loss & early stopping):
  - `ds_tcn`: Depthwise-Separable 1D Temporal Convolutional Network (primary edge/web target)
  - `bigru`:  Bidirectional GRU recurrent baseline
Both consume identical `(batch, 15, 178)` float32 tensors through a masked kinematic
stem `[x, Δx]` + `LayerNorm(356)` inside `forward()`.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import random
import sys
import tempfile
import time
from collections import Counter
from pathlib import Path
from typing import Any, Optional

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
import torch.optim as optim
from torch.utils.data import DataLoader, Dataset

try:
    import onnx
    import onnxruntime as ort
    from onnxruntime.quantization import QuantType, quantize_dynamic
except ImportError as exc:
    print("\n[ERROR CRÍTICO] Faltan dependencias clave ('onnx' / 'onnxruntime').", file=sys.stderr)
    print(f"Detalle del error: {exc}", file=sys.stderr)
    print("Ejecuta con el entorno ML del proyecto:", file=sys.stderr)
    print("  ./expresat/venv/bin/python expresat/models/train_and_export.py\n", file=sys.stderr)
    sys.exit(1)

try:
    from models.feature_extractor import (
        FEATURE_SPEC_VERSION,
        HAND_LANDMARKER_SHA256,
        POSE_LANDMARKER_SHA256,
        SEQUENCE_LENGTH,
        TOTAL_FEATURES,
        compute_config_hash,
    )
    from models.inference_engine import IncompatibleFeatureSpecError
except ImportError:
    try:
        from feature_extractor import (
            FEATURE_SPEC_VERSION,
            HAND_LANDMARKER_SHA256,
            POSE_LANDMARKER_SHA256,
            SEQUENCE_LENGTH,
            TOTAL_FEATURES,
            compute_config_hash,
        )
        from inference_engine import IncompatibleFeatureSpecError
    except ImportError:
        from expresat.models.feature_extractor import (
            FEATURE_SPEC_VERSION,
            HAND_LANDMARKER_SHA256,
            POSE_LANDMARKER_SHA256,
            SEQUENCE_LENGTH,
            TOTAL_FEATURES,
            compute_config_hash,
        )
        from expresat.models.inference_engine import IncompatibleFeatureSpecError


POSE_UPPER_LANDMARKS = 13
POSE_COORDS = 4
HAND_LANDMARKS = 21
HAND_COORDS = 3
NUM_FEATURES = TOTAL_FEATURES  # 178

DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parent / "exported_model"
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_CATALOG_PATH = REPO_ROOT / "catalog" / "signs_catalog.json"

PILOT_LABELS_FALLBACK = [
    "adios",
    "agua",
    "ayuda",
    "bien",
    "gracias",
    "hola",
    "no",
    "reposo",
    "si",
]

DEFAULT_REJECTION_POLICY = {
    "min_confidence": 0.65,
    "min_margin": 0.20,
    "max_normalized_entropy": 0.55,
    "fallback_label": "reposo",
}


def set_deterministic_seed(seed: int) -> None:
    """Seed Python, NumPy, and PyTorch RNGs deterministically."""
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def _major_minor(version_str: str) -> tuple[str, str]:
    parts = str(version_str).strip().split(".")
    if len(parts) < 2:
        return ("", "")
    return (parts[0], parts[1])


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _load_pilot_labels(catalog_path: Path = DEFAULT_CATALOG_PATH) -> list[str]:
    if catalog_path.exists():
        try:
            data = json.loads(catalog_path.read_text(encoding="utf-8"))
            signs = data.get("signs") or data.get("classes") or []
            ids = sorted(
                str(item["id"])
                for item in signs
                if isinstance(item, dict) and item.get("id")
            )
            if len(ids) >= 2:
                return ids
        except Exception:
            pass
    return list(PILOT_LABELS_FALLBACK)


# ---------------------------------------------------------------------------
# Shard Dataset Loading (Strict v1.4.0 Contract, mmap_mode='r')
# ---------------------------------------------------------------------------


class MmapShardDataset(Dataset):
    """Memory-mapped PyTorch Dataset backed by `.npy` shards (`mmap_mode='r'`)."""

    def __init__(self, x_mmap: np.ndarray, y_mmap: np.ndarray):
        if x_mmap.ndim != 3 or x_mmap.shape[1:] != (SEQUENCE_LENGTH, NUM_FEATURES):
            raise ValueError(
                f"Forma de shard X inválida: {x_mmap.shape}, esperado (N, {SEQUENCE_LENGTH}, {NUM_FEATURES})."
            )
        if y_mmap.ndim != 1 or len(y_mmap) != len(x_mmap):
            raise ValueError(f"Forma de shard y inválida: {y_mmap.shape} vs X={x_mmap.shape}.")
        self.X = x_mmap
        self.y = y_mmap

    def __len__(self) -> int:
        return int(self.y.shape[0])

    def __getitem__(self, idx: int) -> tuple[torch.Tensor, torch.Tensor]:
        x_sample = np.array(self.X[idx], dtype=np.float32, copy=True)
        y_sample = int(self.y[idx])
        return torch.from_numpy(x_sample), torch.tensor(y_sample, dtype=torch.long)


def load_shard_dataset(
    manifest_path: str | Path,
    *,
    expected_delegate: Optional[str] = None,
    expected_pose_cadence: Optional[int] = None,
    verify_checksums: bool = True,
) -> dict[str, Any]:
    """
    Load Stage-2 `.npy` shards via `mmap_mode='r'` and enforce FEATURE_SPEC v1.4.0,
    canonical `config_hash`, shard integrity, and zero group leakage across splits.
    """
    mpath = Path(manifest_path)
    if mpath.is_dir():
        mpath = mpath / "manifest.json"
    if not mpath.exists():
        raise FileNotFoundError(
            f"No se encontró manifest.json válido en '{mpath}'. "
            "Ejecuta expresat-dataset-generator/scripts/build_dataset_v140.py primero "
            "o usa explícitamente --allow-synthetic-smoke-test solo para smoke-tests."
        )

    manifest = json.loads(mpath.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict):
        raise IncompatibleFeatureSpecError("manifest.json inválido: se esperaba un objeto JSON.")

    spec_ver = manifest.get("feature_spec_version")
    if not isinstance(spec_ver, str) or _major_minor(spec_ver) != _major_minor(FEATURE_SPEC_VERSION):
        raise IncompatibleFeatureSpecError(
            f"manifest.json feature_spec_version incompatible: {spec_ver!r} (esperado {FEATURE_SPEC_VERSION})."
        )

    if int(manifest.get("sequence_length", -1)) != SEQUENCE_LENGTH:
        raise IncompatibleFeatureSpecError(
            f"manifest.json sequence_length incompatible: {manifest.get('sequence_length')} != {SEQUENCE_LENGTH}."
        )
    if int(manifest.get("num_features", -1)) != NUM_FEATURES:
        raise IncompatibleFeatureSpecError(
            f"manifest.json num_features incompatible: {manifest.get('num_features')} != {NUM_FEATURES}."
        )

    delegate = str(manifest.get("delegate", "GPU"))
    pose_cadence = int(manifest.get("pose_cadence", 1))
    if expected_delegate is not None and delegate != str(expected_delegate):
        raise IncompatibleFeatureSpecError(
            f"manifest.json delegate incompatible: {delegate} != {expected_delegate}."
        )
    if expected_pose_cadence is not None and pose_cadence != int(expected_pose_cadence):
        raise IncompatibleFeatureSpecError(
            f"manifest.json pose_cadence incompatible: {pose_cadence} != {expected_pose_cadence}."
        )

    manifest_hash = manifest.get("config_hash")
    expected_hash = compute_config_hash(delegate=delegate, pose_cadence=pose_cadence)
    if not isinstance(manifest_hash, str) or manifest_hash != expected_hash:
        raise IncompatibleFeatureSpecError(
            f"manifest.json config_hash incompatible: {manifest_hash!r} != {expected_hash!r}."
        )

    labels = manifest.get("labels")
    if not isinstance(labels, list) or len(labels) < 2:
        raise ValueError(f"manifest.json debe contener al menos 2 clases en 'labels', encontrado: {labels!r}")

    splits_meta = manifest.get("splits")
    if not isinstance(splits_meta, dict) or "train" not in splits_meta or "val" not in splits_meta:
        raise ValueError("manifest.json carece de splits obligatorios 'train' y 'val'.")

    # Enforce zero group leakage across splits
    split_groups: dict[str, set[str]] = {}
    for sp_name, sp_info in splits_meta.items():
        if isinstance(sp_info, dict) and isinstance(sp_info.get("groups"), list):
            split_groups[sp_name] = set(sp_info["groups"])
    for a, b in (("train", "val"), ("train", "test"), ("val", "test")):
        if a in split_groups and b in split_groups:
            overlap = split_groups[a] & split_groups[b]
            if overlap:
                raise ValueError(f"Fuga de grupos detectada entre {a} y {b}: {sorted(overlap)[:5]}")

    shards_dir = mpath.parent
    datasets: dict[str, Optional[MmapShardDataset]] = {"train": None, "val": None, "test": None}
    for sp_name in ("train", "val", "test"):
        sp_info = splits_meta.get(sp_name)
        if not sp_info:
            continue
        x_path = shards_dir / sp_info["X_file"]
        y_path = shards_dir / sp_info["y_file"]
        if not x_path.exists() or not y_path.exists():
            if sp_name in ("train", "val"):
                raise FileNotFoundError(f"Shard faltante para split '{sp_name}': {x_path} / {y_path}")
            continue
        if verify_checksums:
            if sp_info.get("x_sha256") and _sha256_file(x_path) != sp_info["x_sha256"]:
                raise ValueError(f"Checksum SHA-256 inválido en {x_path.name}.")
            if sp_info.get("y_sha256") and _sha256_file(y_path) != sp_info["y_sha256"]:
                raise ValueError(f"Checksum SHA-256 inválido en {y_path.name}.")

        x_mmap = np.load(x_path, mmap_mode="r")
        y_mmap = np.load(y_path, mmap_mode="r")
        if len(y_mmap) == 0:
            if sp_name in ("train", "val"):
                raise ValueError(f"Split obligatorio '{sp_name}' está vacío.")
            continue
        datasets[sp_name] = MmapShardDataset(x_mmap, y_mmap)

    if datasets["train"] is None or datasets["val"] is None:
        raise ValueError("Los splits 'train' y 'val' deben contener muestras válidas.")

    return {
        "manifest": manifest,
        "manifest_path": mpath,
        "labels": [str(lbl) for lbl in labels],
        "delegate": delegate,
        "pose_cadence": pose_cadence,
        "config_hash": expected_hash,
        "train_dataset": datasets["train"],
        "val_dataset": datasets["val"],
        "test_dataset": datasets["test"],
    }


def build_synthetic_smoke_shards(
    output_dir: str | Path,
    *,
    labels: Optional[list[str]] = None,
    samples_per_class: int = 60,
    seed: int = 42,
    delegate: str = "GPU",
    pose_cadence: int = 1,
) -> Path:
    """
    Generate realistic Stage-2 v1.4.0 synthetic smoke-test shards (`X_*.npy`, `y_*.npy`,
    `manifest.json`) with group-disjoint train/val/test splits.
    Strictly for CI / smoke verification — NEVER for production weights.
    """
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    resolved_labels = list(labels) if labels else _load_pilot_labels()
    num_classes = len(resolved_labels)
    rng = np.random.default_rng(seed)

    # Distinct normalized prototypes per class respecting v1.4.0 layout:
    # pose [0:52] (P15..P22 z'=0), leftHand [52:115], rightHand [115:178]
    base_pose = np.zeros((POSE_UPPER_LANDMARKS, POSE_COORDS), dtype=np.float32)
    base_pose[:, 3] = 0.95  # visibility in [0, 1]
    base_pose[0, :3] = [0.0, -0.75, -0.4]   # P00 nose
    base_pose[1, :3] = [-0.5, 0.0, 0.0]     # P11 left shoulder
    base_pose[2, :3] = [0.5, 0.0, 0.0]      # P12 right shoulder
    base_pose[3, :3] = [-0.75, 0.65, -0.2]  # P13 left elbow
    base_pose[4, :3] = [0.75, 0.65, -0.2]   # P14 right elbow
    for idx in range(5, POSE_UPPER_LANDMARKS):
        side = -1.0 if idx % 2 == 1 else 1.0
        base_pose[idx, :3] = [side * 0.6, 0.9, 0.0]  # P15..P22 z'=0.0 strictly!

    # Class-specific spatial/kinematic signatures (static & dynamic)
    hand_proto = rng.normal(0.0, 0.35, size=(num_classes, 2, HAND_LANDMARKS, HAND_COORDS)).astype(np.float32)
    hand_vel = rng.normal(0.0, 0.25, size=(num_classes, 2, HAND_LANDMARKS, HAND_COORDS)).astype(np.float32)
    t_grid = np.linspace(-0.5, 0.5, SEQUENCE_LENGTH, dtype=np.float32)[:, None, None]

    # 5 disjoint session groups per class: groups 0,1,2 -> train (60%), 3 -> val (20%), 4 -> test (20%)
    n_groups = 5
    splits_x: dict[str, list[np.ndarray]] = {"train": [], "val": [], "test": []}
    splits_y: dict[str, list[int]] = {"train": [], "val": [], "test": []}
    splits_g: dict[str, set[str]] = {"train": set(), "val": set(), "test": set()}

    for cls_idx, lbl in enumerate(resolved_labels):
        is_reposo = lbl.lower() == "reposo"
        for i in range(samples_per_class):
            grp_idx = i % n_groups
            split_name = "train" if grp_idx < 3 else ("val" if grp_idx == 3 else "test")
            group_key = f"smoke_sub_{grp_idx}|smoke_sess_{grp_idx}|take_{cls_idx}_{grp_idx}"
            splits_g[split_name].add(group_key)

            # Subject/session style bias (shared within group, varies across groups)
            subj_rng = np.random.default_rng(seed * 1000 + grp_idx * 37 + cls_idx)
            subj_bias = subj_rng.normal(0.0, 0.04, size=(1, NUM_FEATURES)).astype(np.float32)

            seq = np.zeros((SEQUENCE_LENGTH, NUM_FEATURES), dtype=np.float32)
            # Pose block
            pose_seq = np.broadcast_to(base_pose, (SEQUENCE_LENGTH, POSE_UPPER_LANDMARKS, POSE_COORDS)).copy()
            pose_seq[:, :, :2] += rng.normal(0.0, 0.02, size=(SEQUENCE_LENGTH, POSE_UPPER_LANDMARKS, 2))
            pose_seq[:, :5, 2] = np.clip(pose_seq[:, :5, 2] + rng.normal(0.0, 0.03, size=(SEQUENCE_LENGTH, 5)), -2.0, 2.0)
            pose_seq[:, 5:, 2] = 0.0  # P15..P22 z' == 0.0
            pose_seq[:, :, 3] = np.clip(pose_seq[:, :, 3] + rng.normal(0.0, 0.02, size=(SEQUENCE_LENGTH, POSE_UPPER_LANDMARKS)), 0.5, 1.0)
            seq[:, :52] = pose_seq.reshape(SEQUENCE_LENGTH, 52)

            if is_reposo:
                # Reposo mixes 0-hand and low-amplitude resting-hand hard negatives
                if i % 3 != 0:
                    rh = np.zeros((SEQUENCE_LENGTH, HAND_LANDMARKS, HAND_COORDS), dtype=np.float32)
                    rh += np.array([0.45, 0.95, 0.0], dtype=np.float32)
                    rh += rng.normal(0.0, 0.06, size=rh.shape)
                    seq[:, 115:178] = rh.reshape(SEQUENCE_LENGTH, 63)
            else:
                lh = hand_proto[cls_idx, 0][None, :, :] + t_grid * hand_vel[cls_idx, 0][None, :, :]
                rh = hand_proto[cls_idx, 1][None, :, :] + t_grid * hand_vel[cls_idx, 1][None, :, :]
                lh += rng.normal(0.0, 0.14, size=lh.shape)
                rh += rng.normal(0.0, 0.14, size=rh.shape)
                # Exercise hand-appearance masking on 20% of samples
                if i % 5 == 0:
                    lh[:2] = 0.0
                seq[:, 52:115] = lh.reshape(SEQUENCE_LENGTH, 63)
                seq[:, 115:178] = rh.reshape(SEQUENCE_LENGTH, 63)

            # Add slight subject bias only to active coordinate blocks (keep zeros & P15..22 z' intact)
            active_mask = (np.abs(seq) > 1e-6).astype(np.float32)
            seq = seq + subj_bias * active_mask
            seq[:, 5 * 4 + 2 : 52 : 4] = 0.0

            splits_x[split_name].append(seq)
            splits_y[split_name].append(cls_idx)

    splits_manifest: dict[str, Any] = {}
    for sp_name in ("train", "val", "test"):
        x_arr = np.stack(splits_x[sp_name], axis=0).astype(np.float32)
        y_arr = np.asarray(splits_y[sp_name], dtype=np.int64)
        perm = rng.permutation(len(y_arr))
        x_arr = x_arr[perm]
        y_arr = y_arr[perm]

        x_file = f"X_{sp_name}.npy"
        y_file = f"y_{sp_name}.npy"
        np.save(out_dir / x_file, x_arr)
        np.save(out_dir / y_file, y_arr)

        counts = Counter(resolved_labels[int(yi)] for yi in y_arr)
        splits_manifest[sp_name] = {
            "X_file": x_file,
            "y_file": y_file,
            "num_samples": int(x_arr.shape[0]),
            "num_augmented": 0,
            "groups": sorted(splits_g[sp_name]),
            "class_counts": dict(sorted(counts.items())),
            "x_sha256": _sha256_file(out_dir / x_file),
            "y_sha256": _sha256_file(out_dir / y_file),
        }

    manifest = {
        "pipeline_version": "2.0.0-smoke",
        "is_smoke_test": True,
        "feature_spec_version": FEATURE_SPEC_VERSION,
        "delegate": delegate,
        "pose_cadence": int(pose_cadence),
        "config_hash": compute_config_hash(delegate=delegate, pose_cadence=pose_cadence),
        "model_artifacts": {
            "hand_landmarker_sha256": HAND_LANDMARKER_SHA256,
            "pose_landmarker_sha256": POSE_LANDMARKER_SHA256,
        },
        "sequence_length": SEQUENCE_LENGTH,
        "num_features": NUM_FEATURES,
        "labels": resolved_labels,
        "group_key_fields": ["subject_id", "session_id", "take_id"],
        "n_splits": n_groups,
        "seed": seed,
        "splits": splits_manifest,
    }

    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    return manifest_path


# ---------------------------------------------------------------------------
# Neural Architectures: Masked Kinematic Layer + DS-TCN 1D + BiGRU Baseline
# ---------------------------------------------------------------------------


class KinematicInputLayer(nn.Module):
    """
    Computes anatomically masked first-order velocity `[x, Δx]` inside `forward()`
    followed by `LayerNorm(2 * num_features)`.

    If an anatomical block (pose `[0:52]`, leftHand `[52:115]`, or rightHand `[115:178]`)
    is absent (all zeros) at frame `t` OR frame `t-1`, its temporal difference `Δx[t]`
    is masked to exact `0.0` so hand appearance/disappearance never injects false
    velocity spikes.
    """

    def __init__(self, num_features: int = NUM_FEATURES):
        super().__init__()
        self.num_features = num_features
        self.norm = nn.LayerNorm(num_features * 2)

    def compute_kinematic_features(self, x: torch.Tensor) -> torch.Tensor:
        """Return unnormalized `[x, masked_dx]` of shape `(B, T, 2 * num_features)`."""
        pose_active = (x[..., :52].abs().sum(dim=-1, keepdim=True) > 1e-6).to(x.dtype)
        lh_active = (x[..., 52:115].abs().sum(dim=-1, keepdim=True) > 1e-6).to(x.dtype)
        rh_active = (x[..., 115:178].abs().sum(dim=-1, keepdim=True) > 1e-6).to(x.dtype)

        zero_step = torch.zeros_like(x[:, :1, :])
        dx_raw = torch.cat([zero_step, x[:, 1:, :] - x[:, :-1, :]], dim=1)

        def _consecutive_mask(act: torch.Tensor) -> torch.Tensor:
            prev = torch.cat([torch.zeros_like(act[:, :1, :]), act[:, :-1, :]], dim=1)
            return act * prev

        dx_pose = dx_raw[..., :52] * _consecutive_mask(pose_active)
        dx_lh = dx_raw[..., 52:115] * _consecutive_mask(lh_active)
        dx_rh = dx_raw[..., 115:178] * _consecutive_mask(rh_active)
        dx = torch.cat([dx_pose, dx_lh, dx_rh], dim=-1)
        return torch.cat([x, dx], dim=-1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.norm(self.compute_kinematic_features(x))


class DSTCNBlock(nn.Module):
    """Residual Depthwise-Separable 1D Temporal Convolution block (Linear pointwise for INT8)."""

    def __init__(self, channels: int, kernel_size: int = 3, dilation: int = 1, dropout: float = 0.25):
        super().__init__()
        pad = dilation * (kernel_size - 1) // 2
        self.dw = nn.Conv1d(
            channels,
            channels,
            kernel_size=kernel_size,
            padding=pad,
            dilation=dilation,
            groups=channels,
        )
        # Mathematically equivalent to Conv1d(C, C, kernel_size=1), exports as MatMul/Gemm
        # so ONNX Runtime dynamic quantization genuinely quantizes >= 95% of DS-TCN weights.
        self.pw = nn.Linear(channels, channels)
        self.act = nn.GELU()
        self.drop = nn.Dropout(dropout)
        self.ln = nn.LayerNorm(channels)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        y = self.dw(x.transpose(1, 2)).transpose(1, 2)
        y = self.drop(self.act(self.pw(y)))
        return self.ln(x + y)


class SignLanguageDSTCN(nn.Module):
    """
    Primary Edge/Web Candidate: Depthwise-Separable 1D TCN (~45K params, ~86 KB INT8).
    Dilations [1, 2, 4] with k=3 cover a full 15-frame temporal receptive field symmetrically.
    Input: `(batch, 15, 178)` float32 -> Output: `(batch, num_classes)` float32 logits.
    """

    architecture_name = "DS-TCN-1D"
    arch_key = "ds_tcn"

    def __init__(
        self,
        input_size: int = NUM_FEATURES,
        hidden_size: int = 64,
        num_classes: int = len(PILOT_LABELS_FALLBACK),
        dropout: float = 0.25,
    ):
        super().__init__()
        self.kinematic = KinematicInputLayer(input_size)
        self.stem = nn.Linear(input_size * 2, hidden_size)
        self.stem_act = nn.GELU()
        self.blocks = nn.ModuleList(
            [
                DSTCNBlock(hidden_size, kernel_size=3, dilation=1, dropout=dropout),
                DSTCNBlock(hidden_size, kernel_size=3, dilation=2, dropout=dropout),
                DSTCNBlock(hidden_size, kernel_size=3, dilation=4, dropout=dropout),
            ]
        )
        self.head_proj = nn.Linear(hidden_size * 2, hidden_size)
        self.head_act = nn.GELU()
        self.head_drop = nn.Dropout(dropout)
        self.classifier_out = nn.Linear(hidden_size, num_classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        h = self.stem_act(self.stem(self.kinematic(x)))
        for block in self.blocks:
            h = block(h)
        h_mean = h.mean(dim=1)
        h_max = h.max(dim=1).values
        pooled = torch.cat([h_mean, h_max], dim=-1)
        feat = self.head_drop(self.head_act(self.head_proj(pooled)))
        return self.classifier_out(feat)


class SignLanguageBiGRU(nn.Module):
    """
    Recurrent Baseline: Bidirectional GRU with identical masked kinematic stem + LayerNorm.
    Input: `(batch, 15, 178)` float32 -> Output: `(batch, num_classes)` float32 logits.
    """

    architecture_name = "BiGRU"
    arch_key = "bigru"

    def __init__(
        self,
        input_size: int = NUM_FEATURES,
        hidden_size: int = 64,
        num_classes: int = len(PILOT_LABELS_FALLBACK),
        dropout: float = 0.25,
    ):
        super().__init__()
        self.kinematic = KinematicInputLayer(input_size)
        self.stem = nn.Linear(input_size * 2, hidden_size)
        self.stem_act = nn.GELU()
        self.gru = nn.GRU(
            input_size=hidden_size,
            hidden_size=hidden_size,
            num_layers=1,
            batch_first=True,
            bidirectional=True,
        )
        self.ln = nn.LayerNorm(hidden_size * 2)
        self.head_drop = nn.Dropout(dropout)
        self.classifier_out = nn.Linear(hidden_size * 2, num_classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        h = self.stem_act(self.stem(self.kinematic(x)))
        out, _ = self.gru(h)
        pooled = self.ln(out.mean(dim=1))
        return self.classifier_out(self.head_drop(pooled))


def build_model(
    arch: str,
    num_classes: int,
    *,
    hidden_size: int = 64,
    dropout: float = 0.25,
) -> nn.Module:
    key = arch.strip().lower()
    if key in ("ds_tcn", "dstcn", "ds-tcn", "tcn"):
        return SignLanguageDSTCN(
            input_size=NUM_FEATURES,
            hidden_size=hidden_size,
            num_classes=num_classes,
            dropout=dropout,
        )
    if key in ("bigru", "bi_gru", "bi-gru"):
        return SignLanguageBiGRU(
            input_size=NUM_FEATURES,
            hidden_size=hidden_size,
            num_classes=num_classes,
            dropout=dropout,
        )
    raise ValueError(f"Arquitectura desconocida: {arch!r}. Usa 'ds_tcn' o 'bigru'.")


# ---------------------------------------------------------------------------
# Pure-NumPy Metrics & Post-Hoc Temperature Scaling Calibration
# ---------------------------------------------------------------------------


def numpy_softmax(logits: np.ndarray, temperature: float = 1.0) -> np.ndarray:
    scaled = np.asarray(logits, dtype=np.float64) / float(temperature)
    shifted = scaled - np.max(scaled, axis=-1, keepdims=True)
    exp_v = np.exp(shifted)
    return exp_v / np.sum(exp_v, axis=-1, keepdims=True)


def compute_macro_f1(y_true: np.ndarray, y_pred: np.ndarray, num_classes: int) -> float:
    """Compute exact Macro-F1 without external sklearn dependency."""
    y_t = np.asarray(y_true, dtype=np.int64)
    y_p = np.asarray(y_pred, dtype=np.int64)
    f1s: list[float] = []
    for c in range(num_classes):
        tp = int(np.sum((y_t == c) & (y_p == c)))
        fp = int(np.sum((y_t != c) & (y_p == c)))
        fn = int(np.sum((y_t == c) & (y_p != c)))
        denom = (2 * tp) + fp + fn
        if (tp + fn) == 0 and (tp + fp) == 0:
            continue
        f1s.append((2.0 * tp / denom) if denom > 0 else 0.0)
    return float(np.mean(f1s)) if f1s else 0.0


def compute_class_weights(y_train: np.ndarray, num_classes: int) -> torch.Tensor:
    """Inverse-frequency balanced class weights for CrossEntropyLoss."""
    counts = np.bincount(np.asarray(y_train, dtype=np.int64), minlength=num_classes).astype(np.float64)
    total = float(np.sum(counts))
    weights = np.ones(num_classes, dtype=np.float32)
    for c in range(num_classes):
        if counts[c] > 0:
            weights[c] = float(total / (num_classes * counts[c]))
    return torch.from_numpy(weights)


def compute_ece(probs: np.ndarray, labels: np.ndarray, n_bins: int = 15) -> float:
    """Compute Expected Calibration Error (ECE) over `n_bins` confidence bins."""
    p = np.asarray(probs, dtype=np.float64)
    y = np.asarray(labels, dtype=np.int64)
    if len(y) == 0:
        return 0.0
    confidences = np.max(p, axis=1)
    predictions = np.argmax(p, axis=1)
    accuracies = (predictions == y).astype(np.float64)

    bin_edges = np.linspace(0.0, 1.0, n_bins + 1)
    ece = 0.0
    n = float(len(y))
    for i in range(n_bins):
        lo, hi = bin_edges[i], bin_edges[i + 1]
        if i == 0:
            in_bin = (confidences >= lo) & (confidences <= hi)
        else:
            in_bin = (confidences > lo) & (confidences <= hi)
        count = int(np.sum(in_bin))
        if count > 0:
            avg_conf = float(np.mean(confidences[in_bin]))
            avg_acc = float(np.mean(accuracies[in_bin]))
            ece += (count / n) * abs(avg_acc - avg_conf)
    return float(ece)


def fit_temperature_scaling(
    val_logits: np.ndarray,
    val_labels: np.ndarray,
    *,
    n_bins: int = 15,
    min_temp: float = 0.35,
    max_temp: float = 5.0,
    log_temp_reg: float = 1e-3,
) -> dict[str, float]:
    """
    Post-hoc Temperature Scaling minimizing weakly regularized validation NLL
    (`NLL(logits / T) + reg * (log T)^2`) via deterministic grid init + L-BFGS.
    Bounded `T in [0.35, 5.0]` + weak log-prior prevents degenerate `T -> 0` collapse
    on tiny/100%-accurate validation folds while cleanly calibrating both over- and
    under-confident logits.
    """
    logits_t = torch.tensor(val_logits, dtype=torch.float64)
    labels_t = torch.tensor(val_labels, dtype=torch.long)

    probs_before = numpy_softmax(val_logits, temperature=1.0)
    nll_before = float(F.cross_entropy(logits_t, labels_t).item())
    ece_before = compute_ece(probs_before, val_labels, n_bins=n_bins)

    def _objective(temp_val: float) -> float:
        nll = float(F.cross_entropy(logits_t / temp_val, labels_t).item())
        return nll + log_temp_reg * (float(np.log(temp_val)) ** 2)

    # Coarse log-space search guarantees global basin before L-BFGS refinement
    grid = np.geomspace(min_temp, max_temp, num=80)
    best_t = 1.0
    best_obj = _objective(1.0)
    for cand_t in grid:
        cand_obj = _objective(float(cand_t))
        if cand_obj < best_obj:
            best_obj = cand_obj
            best_t = float(cand_t)

    log_temp = nn.Parameter(torch.tensor([np.log(best_t)], dtype=torch.float64))
    optimizer = optim.LBFGS([log_temp], lr=0.25, max_iter=50, line_search_fn="strong_wolfe")

    def _closure() -> torch.Tensor:
        optimizer.zero_grad()
        temp = torch.exp(log_temp).clamp(min=min_temp, max=max_temp)
        loss = F.cross_entropy(logits_t / temp, labels_t) + log_temp_reg * (torch.log(temp) ** 2).sum()
        loss.backward()
        return loss

    optimizer.step(_closure)

    cand_lbfgs_t = float(torch.exp(log_temp).clamp(min=min_temp, max=max_temp).item())
    cand_lbfgs_obj = _objective(cand_lbfgs_t)
    final_t = cand_lbfgs_t if cand_lbfgs_obj <= best_obj else best_t
    nll_after = float(F.cross_entropy(logits_t / final_t, labels_t).item())

    probs_after = numpy_softmax(val_logits, temperature=final_t)
    ece_after = compute_ece(probs_after, val_labels, n_bins=n_bins)

    return {
        "method": "temperature_scaling",
        "temperature": round(float(final_t), 6),
        "nll_before": round(nll_before, 6),
        "nll_after": round(nll_after, 6),
        "ece_before": round(ece_before, 6),
        "ece_after": round(ece_after, 6),
    }


# ---------------------------------------------------------------------------
# Fair Training Loop (Class-Weighted CrossEntropy + Label Smoothing + Macro-F1 Early Stopping)
# ---------------------------------------------------------------------------


def _collect_logits_and_labels(
    model: nn.Module,
    loader: DataLoader,
    device: str = "cpu",
) -> tuple[np.ndarray, np.ndarray]:
    model.eval()
    logits_list: list[np.ndarray] = []
    labels_list: list[np.ndarray] = []
    with torch.no_grad():
        for bx, by in loader:
            out = model(bx.to(device))
            logits_list.append(out.cpu().numpy())
            labels_list.append(by.numpy())
    return np.concatenate(logits_list, axis=0), np.concatenate(labels_list, axis=0)


def train_single_model(
    model: nn.Module,
    train_dataset: MmapShardDataset,
    val_dataset: MmapShardDataset,
    num_classes: int,
    *,
    epochs: int = 40,
    lr: float = 2e-3,
    batch_size: int = 64,
    weight_decay: float = 1e-3,
    label_smoothing: float = 0.05,
    patience: int = 8,
    seed: int = 42,
    device: str = "cpu",
    verbose: bool = True,
) -> dict[str, Any]:
    """
    Train a model with class-weighted CrossEntropyLoss + label smoothing and
    Early Stopping on validation Macro-F1.
    """
    set_deterministic_seed(seed)
    model = model.to(device)

    g = torch.Generator()
    g.manual_seed(seed)
    train_loader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True, num_workers=0, generator=g)
    val_loader = DataLoader(val_dataset, batch_size=batch_size, shuffle=False, num_workers=0)

    class_weights = compute_class_weights(np.asarray(train_dataset.y), num_classes).to(device)
    criterion = nn.CrossEntropyLoss(weight=class_weights, label_smoothing=label_smoothing)
    optimizer = optim.AdamW(model.parameters(), lr=lr, weight_decay=weight_decay)
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=max(1, epochs), eta_min=lr * 0.05)

    best_f1 = -1.0
    best_val_loss = float("inf")
    best_val_acc = 0.0
    best_epoch = 0
    best_weights = copy.deepcopy(model.state_dict())
    stale_epochs = 0

    for epoch in range(1, epochs + 1):
        model.train()
        train_loss_sum = 0.0
        train_total = 0

        for bx, by in train_loader:
            bx = bx.to(device)
            by = by.to(device)
            optimizer.zero_grad()
            logits = model(bx)
            loss = criterion(logits, by)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()

            train_loss_sum += float(loss.item()) * bx.size(0)
            train_total += bx.size(0)

        scheduler.step()

        val_logits, val_labels = _collect_logits_and_labels(model, val_loader, device=device)
        val_loss = float(
            criterion(
                torch.from_numpy(val_logits).to(device),
                torch.from_numpy(val_labels).to(device),
            ).item()
        )
        val_preds = np.argmax(val_logits, axis=1)
        val_macro_f1 = compute_macro_f1(val_labels, val_preds, num_classes)
        val_acc = float(np.mean(val_preds == val_labels))

        improved = (val_macro_f1 > best_f1 + 1e-4) or (
            abs(val_macro_f1 - best_f1) <= 1e-4 and val_loss < best_val_loss - 1e-4
        )
        if improved:
            best_f1 = val_macro_f1
            best_val_loss = val_loss
            best_val_acc = val_acc
            best_epoch = epoch
            best_weights = copy.deepcopy(model.state_dict())
            stale_epochs = 0
        else:
            stale_epochs += 1

        if verbose and (epoch == 1 or epoch % 5 == 0 or epoch == epochs or stale_epochs >= patience):
            avg_train_loss = train_loss_sum / max(1, train_total)
            print(
                f"  [{getattr(model, 'architecture_name', 'Model')}] Ep {epoch:3d}/{epochs} "
                f"| TrLoss={avg_train_loss:.4f} | ValLoss={val_loss:.4f} "
                f"| ValAcc={val_acc*100:.1f}% | ValMacroF1={val_macro_f1:.4f}"
            )

        if stale_epochs >= patience:
            break

    model.load_state_dict(best_weights)
    final_val_logits, final_val_labels = _collect_logits_and_labels(model, val_loader, device=device)

    return {
        "model": model,
        "best_val_macro_f1": round(float(best_f1), 6),
        "best_val_loss": round(float(best_val_loss), 6),
        "best_val_acc": round(float(best_val_acc), 6),
        "best_epoch": int(best_epoch),
        "epochs_ran": int(epoch),
        "val_logits": final_val_logits,
        "val_labels": final_val_labels,
    }


# ---------------------------------------------------------------------------
# Self-Contained Single-File ONNX Export, Genuine INT8 Quantization, Parity & Latency
# ---------------------------------------------------------------------------


def _ensure_single_file_onnx(onnx_path: Path) -> None:
    """Guarantee self-contained `.onnx` artifact with zero `.onnx.data` sidecar."""
    sidecar = Path(f"{onnx_path}.data")
    if sidecar.exists():
        proto = onnx.load(str(onnx_path), load_external_data=True)
        onnx.save_model(proto, str(onnx_path), save_as_external_data=False)
        sidecar.unlink(missing_ok=True)
    if sidecar.exists():
        raise RuntimeError(f"Persiste archivo externo prohibido: {sidecar}")


def export_to_onnx(model: nn.Module, output_path: str | Path) -> Path:
    """Export PyTorch model to a single self-contained FP32 ONNX file (opset 17)."""
    out_path = Path(output_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    model.eval()
    dummy_input = torch.randn(1, SEQUENCE_LENGTH, NUM_FEATURES, dtype=torch.float32)

    torch.onnx.export(
        model,
        dummy_input,
        str(out_path),
        export_params=True,
        opset_version=17,
        do_constant_folding=True,
        input_names=["landmark_sequence"],
        output_names=["logits"],
        dynamic_axes={"landmark_sequence": {0: "batch_size"}, "logits": {0: "batch_size"}},
        dynamo=False,
    )
    _ensure_single_file_onnx(out_path)
    return out_path


def inspect_onnx_quantization_stats(onnx_path: str | Path) -> dict[str, Any]:
    """Count genuine INT8/UINT8 vs FP32/FP16 initializer elements in an ONNX graph."""
    proto = onnx.load(str(onnx_path))
    quantized_params = 0
    float_params = 0
    for init in proto.graph.initializer:
        n = int(np.prod(init.dims)) if init.dims else 1
        if init.data_type in (onnx.TensorProto.INT8, onnx.TensorProto.UINT8):
            quantized_params += n
        elif init.data_type in (onnx.TensorProto.FLOAT, onnx.TensorProto.FLOAT16):
            float_params += n
    total = quantized_params + float_params
    ratio = (quantized_params / total) if total > 0 else 0.0
    return {
        "quantized_params": int(quantized_params),
        "float_params": int(float_params),
        "total_params": int(total),
        "quantized_ratio": round(float(ratio), 6),
        "quantized_pct": round(float(ratio * 100.0), 2),
    }


def optimize_onnx_int8(onnx_path: str | Path, optimized_path: str | Path) -> tuple[Path, dict[str, Any]]:
    """Apply ONNX Runtime dynamic UINT8/INT8 quantization and measure real weight coverage."""
    fp32_p = Path(onnx_path)
    int8_p = Path(optimized_path)
    int8_p.parent.mkdir(parents=True, exist_ok=True)

    quantize_dynamic(
        model_input=str(fp32_p),
        model_output=str(int8_p),
        weight_type=QuantType.QUInt8,
        per_channel=False,
        reduce_range=False,
    )
    _ensure_single_file_onnx(int8_p)

    stats = inspect_onnx_quantization_stats(int8_p)
    fp32_bytes = int(fp32_p.stat().st_size)
    int8_bytes = int(int8_p.stat().st_size)
    reduction_pct = (1.0 - (int8_bytes / max(1, fp32_bytes))) * 100.0
    stats.update(
        {
            "fp32_bytes": fp32_bytes,
            "fp32_kb": round(fp32_bytes / 1024.0, 2),
            "int8_bytes": int8_bytes,
            "int8_kb": round(int8_bytes / 1024.0, 2),
            "size_reduction_pct": round(float(reduction_pct), 2),
        }
    )
    return int8_p, stats


def _create_cpu_session(onnx_path: str | Path) -> ort.InferenceSession:
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 1
    opts.inter_op_num_threads = 1
    opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    opts.enable_cpu_mem_arena = False
    opts.enable_mem_pattern = True
    opts.log_severity_level = 3
    return ort.InferenceSession(str(onnx_path), sess_options=opts, providers=["CPUExecutionProvider"])


def verify_onnx_parity(
    model: nn.Module,
    fp32_path: str | Path,
    int8_path: str | Path,
    sample_x: np.ndarray,
    *,
    temperature: float = 1.0,
) -> dict[str, float]:
    """Verify numerical parity between PyTorch FP32, ONNX FP32, and ONNX INT8."""
    x_np = np.asarray(sample_x, dtype=np.float32)
    model.eval()
    with torch.no_grad():
        pt_logits = model(torch.from_numpy(x_np)).cpu().numpy()

    sess_fp32 = _create_cpu_session(fp32_path)
    inp_fp32 = sess_fp32.get_inputs()[0].name
    ort_fp32_logits = sess_fp32.run(None, {inp_fp32: x_np})[0]

    sess_int8 = _create_cpu_session(int8_path)
    inp_int8 = sess_int8.get_inputs()[0].name
    ort_int8_logits = sess_int8.run(None, {inp_int8: x_np})[0]

    pt_probs = numpy_softmax(pt_logits, temperature=1.0)
    fp32_probs = numpy_softmax(ort_fp32_logits, temperature=1.0)
    int8_probs = numpy_softmax(ort_int8_logits, temperature=1.0)

    pt_cal_probs = numpy_softmax(pt_logits, temperature=temperature)
    int8_cal_probs = numpy_softmax(ort_int8_logits, temperature=temperature)

    top1_agree = float(np.mean(np.argmax(pt_logits, axis=1) == np.argmax(ort_int8_logits, axis=1)) * 100.0)

    return {
        "fp32_logit_linf": float(np.max(np.abs(pt_logits - ort_fp32_logits))),
        "fp32_prob_linf": float(np.max(np.abs(pt_probs - fp32_probs))),
        "int8_logit_linf": float(np.max(np.abs(pt_logits - ort_int8_logits))),
        "int8_prob_linf": float(np.max(np.abs(pt_probs - int8_probs))),
        "int8_calibrated_prob_linf": float(np.max(np.abs(pt_cal_probs - int8_cal_probs))),
        "top1_agreement_pct": round(top1_agree, 2),
        "num_samples_checked": int(x_np.shape[0]),
    }


def benchmark_onnx(onnx_path: str | Path, *, num_runs: int = 100, warmup: int = 20) -> dict[str, float]:
    """Measure single-threaded CPU ONNX Runtime latency (target p99 < 3.0 ms)."""
    session = _create_cpu_session(onnx_path)
    input_name = session.get_inputs()[0].name
    dummy = np.random.default_rng(0).standard_normal((1, SEQUENCE_LENGTH, NUM_FEATURES)).astype(np.float32)

    for _ in range(warmup):
        session.run(None, {input_name: dummy})

    latencies_ms: list[float] = []
    for _ in range(num_runs):
        t0 = time.perf_counter()
        session.run(None, {input_name: dummy})
        latencies_ms.append((time.perf_counter() - t0) * 1000.0)

    arr = np.asarray(latencies_ms, dtype=np.float64)
    return {
        "mean_ms": round(float(np.mean(arr)), 4),
        "p50_ms": round(float(np.median(arr)), 4),
        "p95_ms": round(float(np.percentile(arr, 95)), 4),
        "p99_ms": round(float(np.percentile(arr, 99)), 4),
        "min_ms": round(float(np.min(arr)), 4),
        "max_ms": round(float(np.max(arr)), 4),
        "num_runs": int(num_runs),
    }


# ---------------------------------------------------------------------------
# Fair A/B Ablation Orchestrator & Metadata Sealing
# ---------------------------------------------------------------------------


def _evaluate_candidate(
    arch_key: str,
    loaded: dict[str, Any],
    work_dir: Path,
    *,
    epochs: int,
    batch_size: int,
    lr: float,
    weight_decay: float,
    label_smoothing: float,
    patience: int,
    hidden_size: int,
    dropout: float,
    seed: int,
    benchmark_runs: int,
    verbose: bool,
) -> dict[str, Any]:
    labels = loaded["labels"]
    num_classes = len(labels)
    train_ds = loaded["train_dataset"]
    val_ds = loaded["val_dataset"]
    test_ds = loaded["test_dataset"]

    set_deterministic_seed(seed)
    model = build_model(arch_key, num_classes=num_classes, hidden_size=hidden_size, dropout=dropout)
    total_torch_params = int(sum(p.numel() for p in model.parameters()))

    train_res = train_single_model(
        model,
        train_ds,
        val_ds,
        num_classes,
        epochs=epochs,
        lr=lr,
        batch_size=batch_size,
        weight_decay=weight_decay,
        label_smoothing=label_smoothing,
        patience=patience,
        seed=seed,
        verbose=verbose,
    )
    trained_model = train_res["model"]

    calibration = fit_temperature_scaling(train_res["val_logits"], train_res["val_labels"])

    test_metrics: Optional[dict[str, float]] = None
    if test_ds is not None and len(test_ds) > 0:
        test_loader = DataLoader(test_ds, batch_size=batch_size, shuffle=False, num_workers=0)
        test_logits, test_labels = _collect_logits_and_labels(trained_model, test_loader)
        test_preds = np.argmax(test_logits, axis=1)
        test_probs_cal = numpy_softmax(test_logits, temperature=calibration["temperature"])
        test_metrics = {
            "macro_f1": round(compute_macro_f1(test_labels, test_preds, num_classes), 6),
            "accuracy": round(float(np.mean(test_preds == test_labels)), 6),
            "ece_calibrated": round(compute_ece(test_probs_cal, test_labels), 6),
        }

    pt_path = work_dir / f"expresat_{arch_key}.pt"
    fp32_path = work_dir / f"expresat_{arch_key}_float32.onnx"
    int8_path = work_dir / f"expresat_{arch_key}_int8.onnx"

    torch.save(trained_model.state_dict(), pt_path)
    export_to_onnx(trained_model, fp32_path)
    int8_path, quant_stats = optimize_onnx_int8(fp32_path, int8_path)

    # Check parity on up to 64 real validation windows
    n_check = min(64, len(val_ds))
    sample_x = np.array(val_ds.X[:n_check], dtype=np.float32, copy=True)
    parity = verify_onnx_parity(
        trained_model,
        fp32_path,
        int8_path,
        sample_x,
        temperature=calibration["temperature"],
    )
    latency = benchmark_onnx(int8_path, num_runs=benchmark_runs)

    return {
        "arch_key": arch_key,
        "architecture": getattr(trained_model, "architecture_name", arch_key),
        "total_torch_params": total_torch_params,
        "val_macro_f1": train_res["best_val_macro_f1"],
        "val_acc": train_res["best_val_acc"],
        "val_loss": train_res["best_val_loss"],
        "best_epoch": train_res["best_epoch"],
        "epochs_ran": train_res["epochs_ran"],
        "test_metrics": test_metrics,
        "calibration": calibration,
        "quantization": quant_stats,
        "parity": parity,
        "latency_cpu": latency,
        "files": {
            "pytorch": pt_path.name,
            "float32": fp32_path.name,
            "int8": int8_path.name,
        },
    }


def save_model_metadata(
    output_dir: Path,
    *,
    selected_result: dict[str, Any],
    ablation_models: dict[str, dict[str, Any]],
    loaded: dict[str, Any],
    is_smoke_test: bool,
    seed: int,
    rejection_policy: Optional[dict[str, Any]] = None,
) -> Path:
    """Seal canonical `model_metadata.json` for `InferenceEngine` v1.4.0."""
    policy = dict(DEFAULT_REJECTION_POLICY)
    if rejection_policy:
        policy.update(rejection_policy)

    labels = loaded["labels"]
    metadata = {
        "model_version": "2.0.0",
        "architecture": selected_result["architecture"],
        "arch_key": selected_result["arch_key"],
        "feature_spec_version": FEATURE_SPEC_VERSION,
        "delegate": loaded["delegate"],
        "pose_cadence": int(loaded["pose_cadence"]),
        "config_hash": loaded["config_hash"],
        "model_artifacts": {
            "hand_landmarker_sha256": HAND_LANDMARKER_SHA256,
            "pose_landmarker_sha256": POSE_LANDMARKER_SHA256,
        },
        "sequence_length": SEQUENCE_LENGTH,
        "num_features": NUM_FEATURES,
        "labels": labels,
        "num_classes": len(labels),
        "model_files": selected_result["files"],
        "temperature": selected_result["calibration"]["temperature"],
        "calibration": selected_result["calibration"],
        "rejection_policy": policy,
        "metrics": {
            "val_macro_f1": selected_result["val_macro_f1"],
            "val_acc": selected_result["val_acc"],
            "val_loss": selected_result["val_loss"],
            "best_epoch": selected_result["best_epoch"],
            "test_metrics": selected_result["test_metrics"],
        },
        "quantization": selected_result["quantization"],
        "parity": selected_result["parity"],
        "latency_cpu": selected_result["latency_cpu"],
        "ablation_summary": {
            k: {
                "architecture": v["architecture"],
                "val_macro_f1": v["val_macro_f1"],
                "val_acc": v["val_acc"],
                "int8_kb": v["quantization"]["int8_kb"],
                "fp32_kb": v["quantization"]["fp32_kb"],
                "quantized_pct": v["quantization"]["quantized_pct"],
                "p50_ms": v["latency_cpu"]["p50_ms"],
                "p99_ms": v["latency_cpu"]["p99_ms"],
                "ece_before": v["calibration"]["ece_before"],
                "ece_after": v["calibration"]["ece_after"],
                "temperature": v["calibration"]["temperature"],
                "fp32_logit_linf": v["parity"]["fp32_logit_linf"],
                "int8_prob_linf": v["parity"]["int8_prob_linf"],
            }
            for k, v in ablation_models.items()
        },
        "is_smoke_test": bool(is_smoke_test),
        "production_ready": not bool(is_smoke_test),
        "training_seed": int(seed),
        "feature_layout": {
            "pose_upper": {
                "landmarks": POSE_UPPER_LANDMARKS,
                "coords_per_landmark": POSE_COORDS,
                "total": POSE_UPPER_LANDMARKS * POSE_COORDS,
                "indices": "0:52",
            },
            "left_hand": {
                "landmarks": HAND_LANDMARKS,
                "coords_per_landmark": HAND_COORDS,
                "total": HAND_LANDMARKS * HAND_COORDS,
                "indices": "52:115",
            },
            "right_hand": {
                "landmarks": HAND_LANDMARKS,
                "coords_per_landmark": HAND_COORDS,
                "total": HAND_LANDMARKS * HAND_COORDS,
                "indices": "115:178",
            },
        },
    }

    meta_path = output_dir / "model_metadata.json"
    meta_path.write_text(json.dumps(metadata, indent=2, ensure_ascii=False), encoding="utf-8")
    return meta_path


def run_ablation_ab(
    manifest_path: str | Path,
    output_dir: str | Path,
    *,
    architectures: tuple[str, ...] = ("ds_tcn", "bigru"),
    preferred_arch: str = "ds_tcn",
    epochs: int = 40,
    batch_size: int = 64,
    lr: float = 2e-3,
    weight_decay: float = 1e-3,
    label_smoothing: float = 0.05,
    patience: int = 8,
    hidden_size: int = 64,
    dropout: float = 0.25,
    seed: int = 42,
    is_smoke_test: bool = False,
    benchmark_runs: int = 100,
    expected_delegate: Optional[str] = None,
    expected_pose_cadence: Optional[int] = None,
    verbose: bool = True,
) -> dict[str, Any]:
    """
    Execute a fair A/B ablation comparing `ds_tcn` vs `bigru` on identical session-grouped
    shards, seed, loss, label smoothing, and Macro-F1 Early Stopping, then seal the winner
    into `output_dir`.
    """
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    loaded = load_shard_dataset(
        manifest_path,
        expected_delegate=expected_delegate,
        expected_pose_cadence=expected_pose_cadence,
    )
    effective_smoke = bool(is_smoke_test or loaded["manifest"].get("is_smoke_test", False))

    results: dict[str, dict[str, Any]] = {}
    for arch in architectures:
        results[arch] = _evaluate_candidate(
            arch,
            loaded,
            out_dir,
            epochs=epochs,
            batch_size=batch_size,
            lr=lr,
            weight_decay=weight_decay,
            label_smoothing=label_smoothing,
            patience=patience,
            hidden_size=hidden_size,
            dropout=dropout,
            seed=seed,
            benchmark_runs=benchmark_runs,
            verbose=verbose,
        )

    # Select winner: prioritize DS-TCN for genuine INT8 edge deployment unless another
    # architecture beats it by > 0.02 Macro-F1 AND also satisfies p99 < 3.0 ms.
    if preferred_arch in results:
        selected_key = preferred_arch
        pref_f1 = results[preferred_arch]["val_macro_f1"]
        for k, res in results.items():
            if k == preferred_arch:
                continue
            if (
                res["val_macro_f1"] > pref_f1 + 0.02
                and res["quantization"]["quantized_pct"] >= 85.0
                and res["latency_cpu"]["p99_ms"] < 3.0
            ):
                selected_key = k
    else:
        selected_key = max(results.keys(), key=lambda k: results[k]["val_macro_f1"])

    selected_result = results[selected_key]
    meta_path = save_model_metadata(
        out_dir,
        selected_result=selected_result,
        ablation_models=results,
        loaded=loaded,
        is_smoke_test=effective_smoke,
        seed=seed,
    )

    report = {
        "selected_arch": selected_key,
        "feature_spec_version": FEATURE_SPEC_VERSION,
        "config_hash": loaded["config_hash"],
        "is_smoke_test": effective_smoke,
        "production_ready": not effective_smoke,
        "metadata_path": str(meta_path),
        "models": results,
    }
    (out_dir / "ablation_report.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    return report


def _print_ablation_summary(report: dict[str, Any]) -> None:
    print("\n" + "=" * 92)
    print(f"  EXPRESAT v{FEATURE_SPEC_VERSION} — RESUMEN ABLACIÓN A/B (selected={report['selected_arch']})")
    print(f"  is_smoke_test={report['is_smoke_test']} | production_ready={report['production_ready']}")
    print("=" * 92)
    header = (
        f"  {'Arch':<10} | {'ValF1':>6} | {'FP32 KB':>7} | {'INT8 KB':>7} | {'INT8 %':>6} "
        f"| {'p50 ms':>6} | {'p99 ms':>6} | {'ECE b->a':>13} | {'FP32 Linf':>9} | {'INT8 pLinf':>10}"
    )
    print(header)
    print("  " + "-" * (len(header) - 2))
    for k, res in report["models"].items():
        q = res["quantization"]
        lat = res["latency_cpu"]
        cal = res["calibration"]
        par = res["parity"]
        ece_str = f"{cal['ece_before']:.4f}->{cal['ece_after']:.4f}"
        print(
            f"  {res['architecture']:<10} | {res['val_macro_f1']:>6.4f} | {q['fp32_kb']:>7.1f} "
            f"| {q['int8_kb']:>7.1f} | {q['quantized_pct']:>5.1f}% | {lat['p50_ms']:>6.3f} "
            f"| {lat['p99_ms']:>6.3f} | {ece_str:>13} | {par['fp32_logit_linf']:>9.2e} "
            f"| {par['int8_prob_linf']:>10.4f}"
        )
    print("=" * 92 + "\n")


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="ExpresaT v1.4.0 — Entrenamiento, Ablación A/B (DS-TCN 1D vs BiGRU), Calibración y Export ONNX INT8"
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=None,
        help="Ruta al manifest.json generado por build_dataset_v140.py (obligatorio sin --allow-synthetic-smoke-test)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=f"Directorio de salida del modelo (default: {DEFAULT_OUTPUT_DIR})",
    )
    parser.add_argument(
        "--arch",
        type=str,
        choices=["ds_tcn", "bigru", "ablation"],
        default="ablation",
        help="Arquitectura a entrenar o 'ablation' para A/B justo DS-TCN vs BiGRU (default: ablation)",
    )
    parser.add_argument(
        "--ablation",
        action="store_true",
        help="Alias explícito de --arch ablation (ablación A/B justa DS-TCN 1D vs BiGRU)",
    )
    parser.add_argument("--epochs", type=int, default=40, help="Épocas máximas (default: 40)")
    parser.add_argument("--batch-size", type=int, default=64, help="Tamaño de lote (default: 64)")
    parser.add_argument("--lr", type=float, default=2e-3, help="Learning rate AdamW (default: 2e-3)")
    parser.add_argument("--weight-decay", type=float, default=1e-3, help="Weight decay (default: 1e-3)")
    parser.add_argument("--label-smoothing", type=float, default=0.05, help="Label smoothing (default: 0.05)")
    parser.add_argument("--patience", type=int, default=8, help="Early stopping patience en Macro-F1 (default: 8)")
    parser.add_argument("--hidden-size", type=int, default=64, help="Dimensión oculta (default: 64)")
    parser.add_argument("--dropout", type=float, default=0.25, help="Dropout (default: 0.25)")
    parser.add_argument("--seed", type=int, default=42, help="Semilla determinista (default: 42)")
    parser.add_argument("--benchmark-runs", type=int, default=100, help="Corridas CPU ORT para benchmark (default: 100)")
    parser.add_argument("--delegate", type=str, default=None, choices=["GPU", "CPU"], help="Delegado esperado")
    parser.add_argument("--pose-cadence", type=int, default=None, help="pose_cadence esperado")
    parser.add_argument(
        "--allow-synthetic-smoke-test",
        action="store_true",
        help="Permite generar shards sintéticos temporales SOLO para smoke-test (marca production_ready=false)",
    )
    parser.add_argument(
        "--smoke-samples-per-class",
        type=int,
        default=60,
        help="Muestras por clase en modo --allow-synthetic-smoke-test (default: 60)",
    )
    parser.add_argument(
        "--force-smoke-in-prod-dir",
        action="store_true",
        help="Override explícito para pruebas (prohibido en CI/producción)",
    )
    args = parser.parse_args(argv)

    effective_arch = "ablation" if args.ablation else args.arch
    architectures = ("ds_tcn", "bigru") if effective_arch == "ablation" else (effective_arch,)
    preferred_arch = "ds_tcn" if "ds_tcn" in architectures else architectures[0]

    if args.allow_synthetic_smoke_test:
        if (
            args.output.resolve() == DEFAULT_OUTPUT_DIR.resolve()
            and not args.force_smoke_in_prod_dir
        ):
            print(
                "[ERROR] --allow-synthetic-smoke-test NO puede escribir en el directorio de producción "
                f"({DEFAULT_OUTPUT_DIR}). Especifica un directorio temporal con --output /tmp/...",
                file=sys.stderr,
            )
            return 2

        with tempfile.TemporaryDirectory(prefix="expresat_smoke_shards_") as tmp_shards:
            manifest_path = build_synthetic_smoke_shards(
                Path(tmp_shards),
                samples_per_class=args.smoke_samples_per_class,
                seed=args.seed,
                delegate=args.delegate or "GPU",
                pose_cadence=args.pose_cadence or 1,
            )
            report = run_ablation_ab(
                manifest_path=manifest_path,
                output_dir=args.output,
                architectures=architectures,
                preferred_arch=preferred_arch,
                epochs=args.epochs,
                batch_size=args.batch_size,
                lr=args.lr,
                weight_decay=args.weight_decay,
                label_smoothing=args.label_smoothing,
                patience=args.patience,
                hidden_size=args.hidden_size,
                dropout=args.dropout,
                seed=args.seed,
                is_smoke_test=True,
                benchmark_runs=args.benchmark_runs,
                expected_delegate=args.delegate,
                expected_pose_cadence=args.pose_cadence,
            )
            _print_ablation_summary(report)
            return 0

    if args.manifest is None:
        print(
            "[ERROR] Falta --manifest <ruta/a/manifest.json>. "
            "No existe fallback sintético silencioso en producción; pasa un manifest.json "
            "generado por build_dataset_v140.py o usa --allow-synthetic-smoke-test explícitamente.",
            file=sys.stderr,
        )
        return 1

    try:
        report = run_ablation_ab(
            manifest_path=args.manifest,
            output_dir=args.output,
            architectures=architectures,
            preferred_arch=preferred_arch,
            epochs=args.epochs,
            batch_size=args.batch_size,
            lr=args.lr,
            weight_decay=args.weight_decay,
            label_smoothing=args.label_smoothing,
            patience=args.patience,
            hidden_size=args.hidden_size,
            dropout=args.dropout,
            seed=args.seed,
            is_smoke_test=False,
            benchmark_runs=args.benchmark_runs,
            expected_delegate=args.delegate,
            expected_pose_cadence=args.pose_cadence,
        )
    except Exception as exc:
        print(f"[ERROR] Falló entrenamiento/exportación: {exc}", file=sys.stderr)
        return 1

    _print_ablation_summary(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
