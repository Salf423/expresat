# 📑 ExpresaT — Especificación Técnica del Backend (IA & Inferencia)

Esta documentación describe en detalle la arquitectura, el diseño de modelos y la lógica de inferencia del backend de **ExpresaT**, un traductor de Lengua de Señas en tiempo real optimizado para CPU.

---

## 1. Arquitectura de Alto Nivel

El sistema utiliza una arquitectura de **procesamiento asíncrono basado en flujos (stream-batch)**. El frontend captura landmarks mediante MediaPipe Holistic y los envía a través de WebSockets. El backend procesa estos landmarks en ventanas temporales para predecir la seña correspondiente.

### Flujo de Datos (Pipeline de Inferencia)
1. **Ingesta**: Recepción de 15 frames (1 segundo de video a 15 FPS) vía WebSocket.
2. **Preprocesamiento**: Extracción de 178 features y normalización relativa al cuerpo.
3. **Inferencia**: Ejecución del modelo GRU cuantizado mediante **ONNX Runtime**.
4. **Post-procesamiento**: Aplicación de Softmax y filtrado por umbral de confianza (Confidence Threshold).
5. **Entrega**: Envío de la traducción resultante al cliente.

---

## 2. Ingeniería de Características (Feature Engineering)

Para que el modelo sea ligero y eficiente, no procesamos la imagen completa, sino las coordenadas (landmarks) extraídas.

### Vector de Características (178 dimensiones por frame)
Cada frame se convierte en un vector plano de 178 elementos:

| Región | Landmarks (MediaPipe) | Dimensiones | Total Features |
| :--- | :--- | :--- | :--- |
| **Pose Superior** | 0 (nariz), 11-22 (hombros, codos, muñecas, dedos) | (x, y, z, visibility) | 13 * 4 = **52** |
| **Mano Izquierda**| 0-20 (todos los puntos) | (x, y, z) | 21 * 3 = **63** |
| **Mano Derecha** | 0-20 (todos los puntos) | (x, y, z) | 21 * 3 = **63** |
| **TOTAL** | | | **178** |

### Normalización Relativa al Cuerpo (Shoulder-Relative)
Para garantizar que la traducción sea independiente de la posición del usuario en la cámara (distancia o lateralidad), aplicamos la siguiente transformación:
- **Origen (0,0,0)**: Se establece en el punto medio entre los hombros (Landmarks 11 y 12).
- **Escalado**: Se divide cada coordenada por la distancia euclidiana entre los hombros.
- **Fórmula**: `Coord_norm = (Coord_raw - Shoulder_Mid) / Shoulder_Dist`

---

## 3. Arquitectura del Modelo de IA

El modelo es una Red Neuronal Recurrente (RNN) diseñada para ser **ultra-ligera** (~49,000 parámetros).

### Capas del Modelo
- **GRU (Gated Recurrent Unit)**: 
    - Input: `(Batch, 15, 178)`
    - Hidden Units: 64
    - Layers: 1 (Unidireccional para mínima latencia)
    - *Por qué GRU?*: Menos parámetros que LSTM (3 puertas vs 4) con rendimiento idéntico en secuencias cortas.
- **Classifier Head**:
    - `Linear(64, 32)` + ReLU + Dropout(0.3)
    - `Linear(32, Num_Classes)`

### Optimización de Inferencia (ONNX Runtime)
El modelo no se ejecuta en PyTorch en producción. Se exporta a **ONNX (Open Neural Network Exchange)**:
- **Motor**: `onnxruntime` (CPU-only).
- **Beneficio**: Ejecución 3-5 veces más rápida en CPU que PyTorch nativo.
- **Latencia**: Media de **2.02 ms** por inferencia.

---

## 4. Implementación del Servidor (FastAPI)

El servidor está diseñado para manejar múltiples conexiones concurrentes sin bloquear el procesamiento.

### Gestión de Conexiones
- **Lifespan Management**: El motor ONNX se carga como un **Singleton** al iniciar el servidor, evitando recargas costosas.
- **Pipeline Asíncrono**: La inferencia (que es una tarea intensiva en CPU) se delega a un hilo separado usando `asyncio.to_thread()`. Esto evita que el Event Loop de FastAPI se bloquee, permitiendo recibir nuevos frames mientras se procesan los anteriores.

### Modos de WebSocket (`/ws/translate`)
1. **Batch Mode (Recomendado)**: El frontend envía un array de 15 frames. Minimiza el overhead de red.
2. **Stream Mode (Retrocompatible)**: El frontend envía 1 frame a la vez. El backend mantiene un buffer circular de 15 frames y dispara la inferencia automáticamente cuando se llena.

---

## 5. Estructura de Archivos y Responsabilidades

- `backend/main.py`: Punto de entrada del servidor, gestión de WebSockets y autenticación.
- `models/inference_engine.py`: Clase encargada del preprocesamiento NumPy y ejecución de ONNX.
- `models/train_and_export.py`: Pipeline de entrenamiento y exportación (PyTorch → ONNX).
- `backend/requirements.txt`: Dependencias críticas de producción (mantenidas al mínimo).

---

## 6. Rendimiento y Métricas Reales

| Métrica | Resultado |
| :--- | :--- |
| **Tiempo de Inferencia** | 2.02 ms |
| **Roundtrip Latency (WS)** | ~85 ms (incluye red y preprocesamiento) |
| **Tamaño del Modelo** | 4 KB (.onnx) + 193 KB (.data) |
| **Consumo de RAM** | < 100 MB |

---

## 7. Instrucciones para Desarrolladores

### Cómo entrenar con nuevos datos:
1. Preparar un dataset de landmarks en formato `.npy`.
2. Modificar `SyntheticSignDataset` en `train_and_export.py` por un cargador de datos real.
3. Ejecutar: `python train_and_export.py --epochs 100`.

### Cómo desplegar:
1. Instalar dependencias: `pip install -r backend/requirements.txt`.
2. Iniciar servidor: `uvicorn main:app --host 0.0.0.0 --port 8000`.
3. Verificar salud: `GET /health`.
