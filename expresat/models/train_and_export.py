"""
train_and_export.py — ExpresaT: Entrenamiento y Exportación del Modelo GRU Ultra-Ligero
========================================================================================
Construye, entrena y exporta un modelo GRU cuantizado a INT8
para la traducción de Lengua de Señas en tiempo real sobre CPU.

Arquitectura del Modelo:
    - Input:  (batch, 15 frames, 178 features)
    - GRU:    1 capa, 64 unidades hidden
    - Head:   Linear(64 → 32) → ReLU → Dropout → Linear(32 → num_clases)
    - Params: ~12,000

Pipeline de exportación:
    1. Entrenar modelo en PyTorch 
    2. Aplicar Dynamic Quantization INT8 (ONNX Runtime)
    3. Exportar a ONNX con opset 17
    4. Optimizar ONNX con onnxruntime quantization

Uso:
    python train_and_export.py --epochs 50 --output ./exported_model
"""

import argparse
import os
import json
import sys
import time
import copy
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader

# =============================================================================
# IMPORTACIONES CRÍTICAS 
# =============================================================================
try:
    import onnxruntime as ort
    from onnxruntime.quantization import quantize_dynamic, QuantType
except ImportError as e:
    print("\n[ERROR CRÍTICO] Faltan dependencias clave como 'onnxruntime'.", file=sys.stderr)
    print(f"Detalle del error: {e}", file=sys.stderr)
    print("\n SOLUCIÓN:", file=sys.stderr)
    print("Alerta de uso, solo funciona en el entorno virtual correcto del proyecto:", file=sys.stderr)
    print("  ./expresat/.venv/bin/python expresat/models/train_and_export.py\n", file=sys.stderr)
    sys.exit(1)


# =============================================================================
# 1. CONSTANTES DE ARQUITECTURA
# =============================================================================

# Landmarks por región (MediaPipe Holistic)
#   - Pose superior (hombros, codos, muñecas, cuello): 13 puntos × 4 (x, y, z, visibility)
#   - Mano izquierda: 21 puntos × 3 (x, y, z)
#   - Mano derecha:   21 puntos × 3 (x, y, z)
# Total features por frame:
POSE_UPPER_LANDMARKS = 13   # Landmarks 0, 11-23 de pose (cabeza + torso superior)
POSE_COORDS = 4             # x, y, z, visibility
HAND_LANDMARKS = 21
HAND_COORDS = 3             # x, y, z

NUM_FEATURES = (POSE_UPPER_LANDMARKS * POSE_COORDS) + (HAND_LANDMARKS * HAND_COORDS * 2)
# = 52 + 63 + 63 = 178

SEQUENCE_LENGTH = 15  # 15 frames = 1 segundo a 15 FPS

# Vocabulario de señas de ejemplo para demostración
DEFAULT_LABELS = [
    "hola", "gracias", "por_favor", "adios", "si", "no",
    "ayuda", "bien", "mal", "nombre", "como_estas", "mucho_gusto",
    "perdon", "agua", "comida"
]


# =============================================================================
# 2. MODELO GRU ULTRA-LIGERO
# =============================================================================

class SignLanguageGRU(nn.Module):
    """
    Red GRU de una sola capa, diseñada para ser extremadamente ligera.

    Decisiones de diseño:
      - GRU sobre LSTM: GRU tiene ~25% menos parámetros que LSTM con rendimiento
        comparable en secuencias cortas (15 frames).
      - hidden_size=64: Punto óptimo entre expresividad y velocidad en CPU.
      - Unidireccional: Reduce parámetros a la mitad vs bidireccional y permite
        inferencia causal (no necesita frames futuros).
      - Classifier head compacto: 64→32→num_classes evita overfitting y mantiene
        la cuenta de parámetros baja (~12K total).
    """

    def __init__(self, input_size: int = NUM_FEATURES,
                 hidden_size: int = 64,
                 num_layers: int = 1,
                 num_classes: int = len(DEFAULT_LABELS),
                 dropout: float = 0.3):
        super().__init__()

        self.hidden_size = hidden_size
        self.num_layers = num_layers

        # --- GRU Recurrente ---
        # batch_first=True → Input shape: (batch, seq_len, features)
        self.gru = nn.GRU(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
            dropout=0.0  # No dropout entre capas GRU (solo tenemos 1 capa)
        )

        # --- Classifier Head ---
        self.classifier = nn.Sequential(
            nn.Linear(hidden_size, 32),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(32, num_classes)
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Forward pass.

        Args:
            x: Tensor de forma (batch, 15, NUM_FEATURES)

        Returns:
            logits: Tensor de forma (batch, num_classes)
        """
        # GRU procesa toda la secuencia, tomamos solo el último hidden state
        # output shape: (batch, seq_len, hidden_size)
        # h_n shape:    (num_layers, batch, hidden_size)
        output, h_n = self.gru(x)

        # Usar el último hidden state como representación de la secuencia completa
        last_hidden = h_n[-1]  # (batch, hidden_size)

        # Clasificar
        logits = self.classifier(last_hidden)
        return logits


# =============================================================================
# 3. DATASETS (REALES Y SINTÉTICOS)
# =============================================================================

class RealSignDataset(Dataset):
    """
    Dataset de PyTorch para secuencias de landmarks capturadas en formato JSON de ExpresaT.
    Tensors: (batch, 15, 178) en float32 y targets en int64.
    """

    def __init__(self, data: np.ndarray, targets: np.ndarray):
        self.data = torch.from_numpy(data).float()
        self.targets = torch.from_numpy(targets).long()

    def __len__(self):
        return len(self.targets)

    def __getitem__(self, idx):
        return self.data[idx], self.targets[idx]


class SyntheticSignDataset(Dataset):
    """
    Dataset sintético para demostración del pipeline de entrenamiento en caso
    de que aún no se disponga de archivos de captura de datos reales.
    """

    def __init__(self, num_samples: int = 3000, num_classes: int = len(DEFAULT_LABELS)):
        self.num_samples = num_samples
        self.num_classes = num_classes

        np.random.seed(42)
        self.class_centers = np.random.randn(num_classes, NUM_FEATURES).astype(np.float32) * 0.5

        self.data = []
        self.labels = []

        for i in range(num_samples):
            label = i % num_classes
            center = self.class_centers[label]

            sequence = np.tile(center, (SEQUENCE_LENGTH, 1))
            temporal_drift = np.cumsum(np.random.randn(SEQUENCE_LENGTH, NUM_FEATURES) * 0.02, axis=0)
            noise = np.random.randn(SEQUENCE_LENGTH, NUM_FEATURES) * 0.1
            sequence = (sequence + temporal_drift + noise).astype(np.float32)

            self.data.append(sequence)
            self.labels.append(label)

    def __len__(self):
        return self.num_samples

    def __getitem__(self, idx):
        return (
            torch.tensor(self.data[idx], dtype=torch.float32),
            torch.tensor(self.labels[idx], dtype=torch.long)
        )


def load_datasets(data_dir: str | Path | None = None,
                  expected_labels: list[str] | None = None,
                  val_split: float = 0.2,
                  seed: int = 42):
    """
    Carga datasets reales desde archivos .json de ExpresaT.
    Si data_dir no existe o no tiene muestras válidas, recurre a SyntheticSignDataset.
    """
    resolved_dir = None
    candidates = []
    if data_dir:
        candidates.append(Path(data_dir))
    candidates.extend([
        Path("expresat-dataset-generator/dataset"),
        Path("../expresat-dataset-generator/dataset"),
        Path("/home/adrian/Proyectos/expresat/expresat-dataset-generator/dataset")
    ])

    for c in candidates:
        if c.exists() and c.is_dir():
            resolved_dir = c
            break

    sequences = []
    sample_labels = []

    if resolved_dir:
        # Ignorar dataset.json si existen archivos individuales para evitar duplicidad de muestras
        json_files = [
            f for f in sorted(resolved_dir.glob("*.json"))
            if f.name not in ("dataset.json", "compile_commands.json", "model_metadata.json")
        ]
        if not json_files and (resolved_dir / "dataset.json").exists():
            json_files = [resolved_dir / "dataset.json"]

        print(f"\n📂 Buscando datasets reales en: {resolved_dir}")
        for jf in json_files:
            try:
                with open(jf, "r", encoding="utf-8") as f:
                    content = json.load(f)
                entries = content if isinstance(content, list) else [content]
                file_samples = 0
                for e in entries:
                    lbl = e.get("label")
                    data = e.get("data", [])
                    if not lbl or not data:
                        continue
                    for sample in data:
                        if len(sample) == SEQUENCE_LENGTH and len(sample[0]) == NUM_FEATURES:
                            sequences.append(sample)
                            sample_labels.append(lbl)
                            file_samples += 1
                if file_samples > 0:
                    print(f"  ✓ {jf.name}: {file_samples} muestras cargadas (clase: '{lbl}')")
            except Exception as e:
                print(f"  ✗ Error leyendo {jf.name}: {e}")

    # Fallback si no hay muestras reales
    if not sequences:
        print(f"\n⚠️  No se encontraron muestras reales en '{data_dir or resolved_dir}'.")
        rutas_examinadas = [
            str(c) for c in [
                Path("expresat-dataset-generator/dataset"),
                Path("../expresat-dataset-generator/dataset"),
                Path("/home/adrian/Proyectos/expresat/expresat-dataset-generator/dataset"),
                *([] if not data_dir else [Path(data_dir)])
            ]
        ]
        print("    Rutas examinadas: " + ", ".join(rutas_examinadas) + ".")
        print("    Utilizando dataset sintético simulado como fallback.\n")
        labels = expected_labels if expected_labels else DEFAULT_LABELS
        train_ds = SyntheticSignDataset(num_samples=2400, num_classes=len(labels))
        val_ds = SyntheticSignDataset(num_samples=600, num_classes=len(labels))
        return train_ds, val_ds, labels

    # Procesar clases únicas encontradas
    unique_found = sorted(list(set(sample_labels)))
    if expected_labels:
        classes = [lbl for lbl in expected_labels if lbl in unique_found]
        for u in unique_found:
            if u not in classes:
                classes.append(u)
    else:
        classes = unique_found

    # Manejar caso de 1 sola clase: PyTorch CrossEntropyLoss requiere al menos 2 clases
    if len(classes) == 1:
        print(f"\n⚠️  Solo se detectó 1 clase real ('{classes[0]}').")
        print("    Generando clase de referencia sintética 'reposo' para posibilitar clasificación multiclase.")
        classes.append("reposo")
        rng = np.random.default_rng(seed)
        n_reposo = min(len(sample_labels), 500)
        reposo_data = rng.normal(0.0, 0.015, (n_reposo, SEQUENCE_LENGTH, NUM_FEATURES)).astype(np.float32)
        for s in reposo_data:
            sequences.append(s.tolist())
            sample_labels.append("reposo")

    class_to_idx = {c: i for i, c in enumerate(classes)}
    X = np.array(sequences, dtype=np.float32)
    y = np.array([class_to_idx[lbl] for lbl in sample_labels], dtype=np.int64)

    # Partición train / validation estratificada
    rng = np.random.default_rng(seed)
    train_indices = []
    val_indices = []

    for c_idx in range(len(classes)):
        idx_c = np.where(y == c_idx)[0]
        rng.shuffle(idx_c)
        n_val = max(1, int(len(idx_c) * val_split))
        val_indices.extend(idx_c[:n_val])
        train_indices.extend(idx_c[n_val:])

    train_indices = np.array(train_indices)
    val_indices = np.array(val_indices)
    rng.shuffle(train_indices)
    rng.shuffle(val_indices)

    print(f"\n Resumen del Dataset Real:")
    print(f"    Total muestras : {len(y)}")
    print(f"    Train ({(1-val_split)*100:.0f}%) : {len(train_indices)} muestras")
    print(f"    Val   ({val_split*100:.0f}%) : {len(val_indices)} muestras")
    print(f"    Clases ({len(classes)})   : {classes}")
    for c_name, c_idx in class_to_idx.items():
        count = int(np.sum(y == c_idx))
        print(f"      - {c_name:<18}: {count:4d} muestras")

    train_dataset = RealSignDataset(X[train_indices], y[train_indices])
    val_dataset = RealSignDataset(X[val_indices], y[val_indices])

    return train_dataset, val_dataset, classes


# =============================================================================
# 4. ENTRENAMIENTO
# =============================================================================

def train_model(model: nn.Module,
                train_dataset: Dataset,
                val_dataset: Dataset | None = None,
                epochs: int = 50,
                lr: float = 1e-3,
                batch_size: int = 64,
                device: str = "cpu") -> nn.Module:
    """
    Entrena el modelo GRU con soporte para datasets reales y validación por época.
    """
    model = model.to(device)
    train_loader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True, num_workers=0)
    val_loader = DataLoader(val_dataset, batch_size=batch_size, shuffle=False, num_workers=0) if val_dataset else None

    criterion = nn.CrossEntropyLoss()
    optimizer = optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    scheduler = optim.lr_scheduler.ReduceLROnPlateau(optimizer, patience=5, factor=0.5)

    print(f"\n{'='*60}")
    print(f"  ENTRENAMIENTO - ExpresaT GRU Ultra-Ligero")
    print(f"{'='*60}")
    print(f"  Parámetros totales: {sum(p.numel() for p in model.parameters()):,}")
    print(f"  Input shape:        (batch, {SEQUENCE_LENGTH}, {NUM_FEATURES})")
    print(f"  Épocas:             {epochs}")
    print(f"  Dispositivo:        {device}")
    print(f"{'='*60}\n")

    best_loss = float("inf")
    best_weights = copy.deepcopy(model.state_dict())

    for epoch in range(epochs):
        # ── Modo entrenamiento ──
        model.train()
        train_loss = 0.0
        train_correct = 0
        train_total = 0

        for batch_x, batch_y in train_loader:
            batch_x = batch_x.to(device)
            batch_y = batch_y.to(device)

            optimizer.zero_grad()
            logits = model(batch_x)
            loss = criterion(logits, batch_y)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()

            train_loss += loss.item() * batch_x.size(0)
            _, predicted = torch.max(logits, 1)
            train_correct += (predicted == batch_y).sum().item()
            train_total += batch_y.size(0)

        avg_train_loss = train_loss / max(1, train_total)
        train_acc = (train_correct / max(1, train_total)) * 100

        # ── Modo validación ──
        val_str = ""
        eval_loss = avg_train_loss
        if val_loader:
            model.eval()
            val_loss = 0.0
            val_correct = 0
            val_total = 0
            with torch.no_grad():
                for batch_x, batch_y in val_loader:
                    batch_x = batch_x.to(device)
                    batch_y = batch_y.to(device)
                    logits = model(batch_x)
                    loss = criterion(logits, batch_y)
                    val_loss += loss.item() * batch_x.size(0)
                    _, predicted = torch.max(logits, 1)
                    val_correct += (predicted == batch_y).sum().item()
                    val_total += batch_y.size(0)

            avg_val_loss = val_loss / max(1, val_total)
            val_acc = (val_correct / max(1, val_total)) * 100
            val_str = f" │ Val Loss: {avg_val_loss:.4f} │ Val Acc: {val_acc:.1f}%"
            eval_loss = avg_val_loss

            if avg_val_loss < best_loss:
                best_loss = avg_val_loss
                best_weights = copy.deepcopy(model.state_dict())

        scheduler.step(eval_loss)

        # Imprimir progreso de cada época para seguimiento en tiempo real
        print(f"  Época {epoch+1:3d}/{epochs} │ Loss: {avg_train_loss:.4f} │ Acc: {train_acc:.1f}%{val_str}")

    if val_loader and best_weights:
        model.load_state_dict(best_weights)

    print(f"\n  ✓ Entrenamiento completado.\n")
    return model


# =============================================================================
# 5. CUANTIZACIÓN DINÁMICA INT8
# =============================================================================

def quantize_model(model: nn.Module) -> nn.Module:
    """
    Aplica Dynamic Quantization INT8 al modelo.

    La cuantización dinámica convierte los pesos de float32 a int8 y cuantiza
    las activaciones dinámicamente durante la inferencia. Esto reduce:
      - Tamaño del modelo: ~4x más pequeño
      - Latencia en CPU:   ~2-3x más rápido (aprovecha instrucciones VNNI/AVX)
      - Uso de memoria:    ~4x menos RAM

    Solo se cuantizan las capas GRU y Linear (las más costosas computacionalmente).
    """
    print("  Aplicando Dynamic Quantization INT8...")

    model.eval()
    quantized_model = torch.quantization.quantize_dynamic(
        model,
        qconfig_spec={nn.GRU, nn.Linear},  # Capas a cuantizar
        dtype=torch.qint8                  # Tipo de dato objetivo
    )

    # Comparar tamaños
    original_size = sum(p.numel() * p.element_size() for p in model.parameters())
    # Los parámetros cuantizados no se cuentan igual, estimamos
    print(f"  ✓ Modelo cuantizado. Tamaño original (params): {original_size:,} bytes")

    return quantized_model


# =============================================================================
# 6. EXPORTACIÓN A ONNX
# =============================================================================

def export_to_onnx(model: nn.Module, output_path: str, quantized: bool = False):
    model.eval()
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    # Tensor dummy para trazar el grafo computacional
    dummy_input = torch.randn(1, SEQUENCE_LENGTH, NUM_FEATURES)

    print(f"  Exportando modelo a ONNX: {output_path}")

    torch.onnx.export(
        model,
        dummy_input,
        output_path,
        export_params=True,
        opset_version=17,
        do_constant_folding=True,         # Optimización: pre-computa constantes
        input_names=["landmark_sequence"],
        output_names=["logits"],
        dynamic_axes={
            "landmark_sequence": {0: "batch_size"},  # Batch dinámico
            "logits": {0: "batch_size"}
        },
        dynamo=False
    )

    file_size = os.path.getsize(output_path)
    print(f"  ✓ Modelo ONNX exportado: {file_size:,} bytes ({file_size/1024:.1f} KB)")

    return output_path


def optimize_onnx_int8(onnx_path: str, optimized_path: str):
    """
    Aplica cuantización INT8 al modelo ONNX usando onnxruntime.quantization.

    Esta es la cuantización que realmente se usa en producción:
      - Cuantización dinámica directamente sobre el grafo ONNX
      - Compatible con todas las optimizaciones de ONNX Runtime
      - Reduce el tamaño del archivo .onnx en ~4x
    """
    try:
        print(f"  Aplicando cuantización INT8 al ONNX...")

        quantize_dynamic(
            model_input=onnx_path,
            model_output=optimized_path,
            weight_type=QuantType.QInt8
        )

        original_size = os.path.getsize(onnx_path)
        quantized_size = os.path.getsize(optimized_path)
        reduction = (1 - quantized_size / original_size) * 100

        print(f"  ONNX cuantizado: {quantized_size:,} bytes ({quantized_size/1024:.1f} KB)")
        print(f"    Reducción: {reduction:.1f}% respecto al original")

        return optimized_path

    except Exception as e:
        print(f"  Error en cuantización ONNX: {e}. Usando modelo float32.")
        return onnx_path


# =============================================================================
# 7. GUARDAR METADATOS DEL MODELO
# =============================================================================

def save_model_metadata(output_dir: str, labels: list):
    """
    Guarda los metadatos del modelo (etiquetas, dimensiones, config)
    como JSON para que el motor de inferencia los cargue.
    """
    metadata = {
        "model_version": "1.0.0",
        "architecture": "GRU-Lite",
        "sequence_length": SEQUENCE_LENGTH,
        "num_features": NUM_FEATURES,
        "labels": labels,
        "num_classes": len(labels),
        "feature_layout": {
            "pose_upper": {
                "landmarks": POSE_UPPER_LANDMARKS,
                "coords_per_landmark": POSE_COORDS,
                "total": POSE_UPPER_LANDMARKS * POSE_COORDS,
                "indices": "0:52"
            },
            "left_hand": {
                "landmarks": HAND_LANDMARKS,
                "coords_per_landmark": HAND_COORDS,
                "total": HAND_LANDMARKS * HAND_COORDS,
                "indices": "52:115"
            },
            "right_hand": {
                "landmarks": HAND_LANDMARKS,
                "coords_per_landmark": HAND_COORDS,
                "total": HAND_LANDMARKS * HAND_COORDS,
                "indices": "115:178"
            }
        },
        "preprocessing": {
            "normalization": "shoulder_relative",
            "reference_landmark_left": 11,
            "reference_landmark_right": 12,
        }
    }

    meta_path = os.path.join(output_dir, "model_metadata.json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2, ensure_ascii=False)

    print(f"  ✓ Metadatos guardados: {meta_path}")
    return meta_path


# =============================================================================
# 8. BENCHMARK DE LATENCIA
# =============================================================================

def benchmark_onnx(onnx_path: str, num_runs: int = 100):
    """
    Mide la latencia real del modelo ONNX en CPU.
    Objetivo: < 100ms por inferencia.
    """
    try:
        session = ort.InferenceSession(
            onnx_path,
            providers=["CPUExecutionProvider"]
        )

        # Obtener dinámicamente el nombre del input para evitar hardcodes (ej: "landmark_sequence")
        input_name = session.get_inputs()[0].name

        # Warm-up
        dummy = np.random.randn(1, SEQUENCE_LENGTH, NUM_FEATURES).astype(np.float32)
        for _ in range(10):
            session.run(None, {input_name: dummy})

        # Benchmark
        latencies = []
        for _ in range(num_runs):
            start = time.perf_counter()
            session.run(None, {input_name: dummy})
            latencies.append((time.perf_counter() - start) * 1000)  # ms

        latencies = np.array(latencies)
        print(f"\n  {'='*50}")
        print(f"  BENCHMARK ONNX Runtime (CPU) — {num_runs} runs")
        print(f"  {'='*50}")
        print(f"    Media:    {latencies.mean():.2f} ms")
        print(f"    Mediana:  {np.median(latencies):.2f} ms")
        print(f"    P95:      {np.percentile(latencies, 95):.2f} ms")
        print(f"    P99:      {np.percentile(latencies, 99):.2f} ms")
        print(f"    Min:      {latencies.min():.2f} ms")
        print(f"    Max:      {latencies.max():.2f} ms")

        if latencies.mean() < 100:
            print(f"   CUMPLE objetivo < 100ms")
        else:
            print(f"   NO cumple objetivo < 100ms")

        print(f"  {'='*50}\n")

    except Exception as e:
        print(f" Error al ejecutar benchmark: {e}")


# =============================================================================
# 9. MAIN — PIPELINE COMPLETO
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="ExpresaT — Entrenar y exportar modelo GRU ultra-ligero"
    )
    parser.add_argument("--epochs", type=int, default=50,
                        help="Número de épocas de entrenamiento (default: 50)")
    parser.add_argument("--output", type=str, default="./exported_model",
                        help="Directorio de salida para el modelo exportado")
    parser.add_argument("--data-dir", type=str, default=None,
                        help="Directorio con archivos JSON del dataset (ej: expresat-dataset-generator/dataset)")
    parser.add_argument("--labels", type=str, nargs="+", default=None,
                        help="Lista de etiquetas/señas a clasificar (auto-detectado si no se indica)")
    parser.add_argument("--benchmark", action="store_true", default=True,
                        help="Ejecutar benchmark de latencia después de exportar")
    parser.add_argument("--skip-train", action="store_true",
                        help="Saltar entrenamiento (requiere modelo pre-existente)")

    args = parser.parse_args()

    output_dir = args.output
    os.makedirs(output_dir, exist_ok=True)

    # --- Cargar dataset (real con fallback sintético) ---
    train_dataset, val_dataset, resolved_labels = load_datasets(
        data_dir=args.data_dir,
        expected_labels=args.labels
    )
    num_classes = len(resolved_labels)

    # --- Paso 1: Construir modelo ---
    print("\n Construyendo modelo GRU...")
    model = SignLanguageGRU(
        input_size=NUM_FEATURES,
        hidden_size=64,
        num_layers=1,
        num_classes=num_classes,
        dropout=0.3
    )
    total_params = sum(p.numel() for p in model.parameters())
    print(f"   Parámetros totales: {total_params:,}")

    # --- Paso 2: Entrenar ---
    if not args.skip_train:
        print("\n Entrenando modelo...")
        model = train_model(model, train_dataset, val_dataset, epochs=args.epochs)
    else:
        print("\n  Saltando entrenamiento (--skip-train)")

    # --- Paso 3: Guardar modelo PyTorch (checkpoint) ---
    pytorch_path = os.path.join(output_dir, "expresat_gru.pt")
    torch.save(model.state_dict(), pytorch_path)
    print(f"  Checkpoint PyTorch guardado: {pytorch_path}")

    # --- Paso 4: Exportar a ONNX (float32) ---
    print("\n Exportando a ONNX...")
    onnx_float_path = os.path.join(output_dir, "expresat_gru_float32.onnx")
    export_to_onnx(model, onnx_float_path)

    # --- Paso 5: Cuantización INT8 sobre ONNX ---
    print("\n Cuantización INT8...")
    onnx_int8_path = os.path.join(output_dir, "expresat_gru_int8.onnx")
    final_model_path = optimize_onnx_int8(onnx_float_path, onnx_int8_path)

    # --- Paso 6: Guardar metadatos ---
    print("\n Guardando metadatos...")
    save_model_metadata(output_dir, resolved_labels)

    # --- Paso 7: Benchmark ---
    if args.benchmark:
        print("\n Ejecutando benchmark de latencia...")
        benchmark_onnx(final_model_path)

    print(f"\n{'='*60}")
    print(f"  PIPELINE COMPLETO")
    print(f"  Modelo final: {final_model_path}")
    print(f"  Metadatos:    {os.path.join(output_dir, 'model_metadata.json')}")
    print(f"{'='*60}\n")
if __name__ == "__main__":
    main()
