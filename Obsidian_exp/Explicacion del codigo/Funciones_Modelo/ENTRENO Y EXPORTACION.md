---
title: "Explicación del Código: Pipeline de Entrenamiento y Exportación ONNX"
description: "Desglose técnico de expresat/models/train_and_export.py: arquitectura PyTorch SignLanguageGRU, filtrado de datasets en cuarentena, exportación con opset 17, cuantización INT8 y sellado con config_hash."
version: "2.3.0"
category: "Código / IA & Entrenamiento"
status: "Producción"
target_agents: ["ml-engineer", "mlops-engineer"]
recommended_skills:
  - "[[../../Skills/MachineLearning_y_Vision|MachineLearning_y_Vision]] (`ml-engineer`, `mlops-engineer`)"
related_docs:
  - "[[../../00_INDICE_MAESTRO]]"
  - "[[../../Especificacion_Feature_Spec_v1_3_0]]"
  - "[[Training_and_Inference]]"
  - "[[INFERENCIA]]"
  - "[[../../Caracteristicas]]"
---

# 🏋️ Explicación del Código: Entrenamiento y Exportación ONNX

> **Navegación:** [[../../00_INDICE_MAESTRO|🏠 Índice Maestro]] > **Explicación del Código** > **Modelos** > **Entrenamiento y Exportación**

El script `expresat/models/train_and_export.py` es el pipeline automatizado de entrenamiento supervisado y serialización de modelos de **ExpresaT**, regido estrictamente por el contrato de [[../../Especificacion_Feature_Spec_v1_3_0|FEATURE_SPEC v1.3.0]].

---

## 1. Definición de la Red Neuronal (`SignLanguageGRU`)

La arquitectura implementa una celda recurrente GRU acoplada a un cabezal clasificador lineal:

```python
import torch
import torch.nn as nn

class SignLanguageGRU(nn.Module):
    def __init__(self, input_size: int = 178,
                 hidden_size: int = 64,
                 num_layers: int = 1,
                 num_classes: int = 5,
                 dropout: float = 0.3):
        super().__init__()
        self.gru = nn.GRU(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True
        )
        self.classifier = nn.Sequential(
            nn.Linear(hidden_size, 32),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(32, num_classes)
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # Tensor x de entrada: (batch_size, 15 frames, 178 features)
        output, h_n = self.gru(x)
        last_hidden = h_n[-1]
        logits = self.classifier(last_hidden)
        return logits
```

### Justificación de Hiperparámetros:
- **`input_size = 178`:** Invariante dimensional (52 Upper Pose + 63 Mano Izquierda + 63 Mano Derecha).
- **`hidden_size = 64`:** Suficiente capacidad representacional para distinguir configuraciones de dedos y trayectorias espaciales en secuencias cortas sin sobreajuste (*overfitting*).
- **`num_layers = 1`:** Mantiene la latencia de inferencia en CPU en ~2 ms y evita cuellos de botella en dispositivos móviles.
- **`dropout = 0.3`:** Regularización estocástica que previene la memorización de trayectorias exactas.

---

## 2. Ingesta de Datos y Filtrado de Cuarentena

El cargador de datos (`SignDataset`):
1. **Exclusión de Cuarentena:** Ignora cualquier archivo ubicado en `dataset/quarantine/` (específicamente `letra_a_derecha_2.json`) para prevenir distorsiones geométricas por falta de división inter-humeral ($D$).
2. **Validación de Versión:** Exige que los metadatos declaren compatibilidad con `FEATURE_SPEC_VERSION` (`1.3.0`).
3. **Control Dimensional:** Comprueba que cada secuencia contenga exactamente 15 frames y 178 números flotantes.

---

## 3. Exportación a ONNX, Cuantización y Sellado Criptográfico

```python
import hashlib
import json
import torch.onnx
from onnxruntime.quantization import quantize_dynamic, QuantType

def export_and_quantize(model: nn.Module, float_path: str, int8_path: str, metadata: dict):
    model.eval()
    dummy_input = torch.randn(1, 15, 178, dtype=torch.float32)

    # 1. Exportación ONNX Float32 (opset 17 estándar)
    torch.onnx.export(
        model,
        dummy_input,
        float_path,
        export_params=True,
        opset_version=17,
        input_names=["input"],
        output_names=["output"],
        dynamic_axes={"input": {0: "batch_size"}, "output": {0: "batch_size"}}
    )

    # 2. Cuantización dinámica a enteros de 8 bits (INT8)
    quantize_dynamic(
        model_input=float_path,
        model_output=int8_path,
        weight_type=QuantType.QInt8
    )

    # 3. Sellado con config_hash (incorporando digest de fixtures canónicos)
    metadata["feature_spec_version"] = "1.3.0"
    
    # Lectura del digest SHA-256 de fixtures
    fixtures_path = "tests/fixtures/feature_spec_cases.json"
    with open(fixtures_path, "rb") as f:
        fixtures_hash = hashlib.sha256(f.read()).hexdigest()
    metadata["fixtures_sha256"] = fixtures_hash

    config_bytes = json.dumps(metadata, sort_keys=True).encode("utf-8")
    metadata["config_hash"] = hashlib.sha256(config_bytes).hexdigest()

    with open("exported_model/model_metadata.json", "w") as f:
        json.dump(metadata, f, indent=2)
```

---

## 🤖 Guía de Operación para Agentes ML

- Ejecutar entrenamiento completo:
  ```bash
  python expresat/models/train_and_export.py --epochs 50 --output ./exported_model
  ```
- Comprobar que `exported_model/model_metadata.json` contenga los campos `feature_spec_version: "1.3.0"` y `config_hash`.
