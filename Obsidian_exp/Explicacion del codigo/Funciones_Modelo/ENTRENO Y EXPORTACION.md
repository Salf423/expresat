---
title: "Explicación del Código: Pipeline de Entrenamiento y Exportación ONNX"
description: "Desglose técnico paso a paso de train_and_export.py: arquitectura PyTorch SignLanguageGRU, DataLoader sintético, exportación con opset 17 y cuantización dinámica INT8."
version: "2.0.0"
category: "Código / IA & Entrenamiento"
status: "Producción"
target_agents: ["ml-engineer", "mlops-engineer"]
recommended_skills:
  - "[[../../Skills/MachineLearning_y_Vision|MachineLearning_y_Vision]] (`ml-engineer`, `mlops-engineer`)"
related_docs:
  - "[[../../00_INDICE_MAESTRO]]"
  - "[[Training_and_Inference]]"
  - "[[INFERENCIA]]"
  - "[[../../Caracteristicas]]"
---

# 🏋️ Explicación del Código: Entrenamiento y Exportación ONNX

> **Navegación:** [[../../00_INDICE_MAESTRO|🏠 Índice Maestro]] > **Explicación del Código** > **Modelos** > **Entrenamiento y Exportación**

El script `expresat/models/train_and_export.py` es el pipeline automatizado de entrenamiento supervisado y serialización de modelos de **ExpresaT**.

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
        # Extraemos el último estado oculto temporal
        last_hidden = h_n[-1]
        logits = self.classifier(last_hidden)
        return logits
```

---

## 2. Exportación a ONNX y Cuantización INT8

Para desacoplar el modelo del entorno de desarrollo PyTorch y permitir su ejecución en servidores de bajo coste o dispositivos nativos:

```python
import torch.onnx
from onnxruntime.quantization import quantize_dynamic, QuantType

def export_and_quantize(model: nn.Module, float_path: str, int8_path: str):
    model.eval()
    dummy_input = torch.randn(1, 15, 178)

    # 1. Exportación ONNX Float32
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
```

---

## 🤖 Asignación de Agentes y Skills Recomendadas

- **Para Ajustes de Hiperparámetros y Entrenamiento:** Invocar **`ml-engineer`** (ver [[../../Skills/MachineLearning_y_Vision]]).
- **Para Integración con CI/CD de GitHub Actions:** Invocar **`mlops-engineer`** y **`github-actions-templates`** (ver [[../../Skills/DevOps_CI_CD_y_Despliegue]]).
