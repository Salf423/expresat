---
title: "Explicación del Código: Pipeline de Entrenamiento y Exportación ONNX"
description: "Desglose técnico de train_and_export.py: arquitectura PyTorch SignLanguageGRU, validación de datasets (cuarentena de datos legacy), exportación con opset 17, cuantización INT8 y sellado con config_hash."
version: "2.2.1"
category: "Código / IA & Entrenamiento"
status: "Producción"
target_agents: ["ml-engineer", "mlops-engineer"]
recommended_skills:
  - "[[../../Skills/MachineLearning_y_Vision|MachineLearning_y_Vision]] (`ml-engineer`, `mlops-engineer`)"
related_docs:
  - "[[../../00_INDICE_MAESTRO]]"
  - "[[../../Especificacion_Feature_Spec_v1_2_1]]"
  - "[[Training_and_Inference]]"
  - "[[INFERENCIA]]"
  - "[[../../Caracteristicas]]"
---

# 🏋️ Explicación del Código: Entrenamiento y Exportación ONNX

> **Navegación:** [[../../00_INDICE_MAESTRO|🏠 Índice Maestro]] > **Explicación del Código** > **Modelos** > **Entrenamiento y Exportación**

El script `expresat/models/train_and_export.py` es el pipeline automatizado de entrenamiento supervisado y serialización de modelos de **ExpresaT**, regido por el contrato técnico de [[../../Especificacion_Feature_Spec_v1_2_1|FEATURE_SPEC v1.2.1]].

---

## 1. Definición de la Red Neuronal (`SignLanguageGRU`)

La arquitectura implementa una celda recurrente GRU acoplada a un clasificador lineal:

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
        # x shape: (batch_size, 15, 178)
        output, h_n = self.gru(x)
        last_hidden = h_n[-1]
        logits = self.classifier(last_hidden)
        return logits
```

---

## 2. Ingesta de Datos y Filtrado de Cuarentena

El pipeline de carga de datos:
1. **Exclusión de Cuarentena:** Ignora cualquier archivo ubicado dentro de `dataset/quarantine/` (como `letra_a_derecha_2.json`) para prevenir distorsiones por falta de normalización humeral.
2. **Validación de Versión:** Exige que los datasets contengan la cabecera `feature_spec_version: "1.2.1"`.
3. **Control de Dimensionalidad:** Verifica que cada secuencia tenga exactamente 15 frames y 178 floats por frame.

---

## 3. Exportación a ONNX, Cuantización y Sellado Criptográfico

```python
import hashlib
import json
import torch.onnx
from onnxruntime.quantization import quantize_dynamic, QuantType

def export_and_quantize(model: nn.Module, float_path: str, int8_path: str, metadata: dict):
    model.eval()
    dummy_input = torch.randn(1, 15, 178)

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

    # 3. Cálculo de config_hash y serialización de metadatos
    metadata["feature_spec_version"] = "1.2.1"
    config_bytes = json.dumps(metadata, sort_keys=True).encode("utf-8")
    metadata["config_hash"] = hashlib.sha256(config_bytes).hexdigest()

    with open("exported_model/model_metadata.json", "w") as f:
        json.dump(metadata, f, indent=2)
```

---

## 🤖 Asignación de Agentes y Skills Recomendadas

- **Para Ajustes de Hiperparámetros y Entrenamiento:** Invocar **`ml-engineer`** (ver [[../../Skills/MachineLearning_y_Vision]]).
- **Para Compatibilidad de Exportación ONNX:** Invocar **`mlops-engineer`**.
- **Para Especificación Canónica:** Consultar [[../../Especificacion_Feature_Spec_v1_2_1]].
