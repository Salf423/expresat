
| Región             | Landmarks MediaPipe                        | Coords                   | Total           |
| ------------------ | ------------------------------------------ | ------------------------ | --------------- |
| **Pose Superior**  | 0, 11-22 (cabeza, hombros, codos, muñecas) | x, y, z, visibility (4D) | 13 × 4 = **52** |
| **Mano Izquierda** | 0-20 (21 puntos)                           | x, y, z (3D)             | 21 × 3 = **63** |
| **Mano Derecha**   | 0-20 (21 puntos)                           | x, y, z (3D)             | 21 × 3 = **63** |
| **TOTAL**          |                                            |                          |                 |
### **Arquitectura del Modelo**

**Nombre**: `SignLanguageGRU` (PyTorch)

- **Input**: `(batch, 15 frames, 178 features)`
- **GRU Layer**: 64 hidden units, unidireccional (1 capa)
- **Classifier Head**: Linear(64→32) + ReLU + Dropout(0.3) + Linear(32→num_clases)
- **Total de parámetros**: ~12,000 (ultra-ligero)
- **¿Por qué GRU?**: 25% menos parámetros que LSTM con mismo rendimiento en secuencias cortas (15 frames).

**Optimización a ONNX**:

1. Exportar desde PyTorch con opset 17
2. Aplicar cuantización dinámica INT8
3. Resultado: **4 KB modelo + 193 KB datos** (95% más pequeño que float32)

### **Preprocesamiento (Función `preprocess_batch` en inference_engine.py)**

# Input: raw_frames = [frame1, frame2, ..., frame15]
# Cada frame: {"pose": [...], "leftHand": [...], "rightHand": [...]}

def preprocess_batch(raw_frames):
    # 1. Extrae pose superior (13 landmarks × 4 coords) → 52D
    # 2. Extrae mano izquierda (21 landmarks × 3 coords) → 63D
    # 3. Extrae mano derecha (21 landmarks × 3 coords) → 63D
    # 4. Normaliza respecto a hombros
    # 5. Retorna tensor (1, 15, 178) dtype=float32

### **Inferencia (Función `predict` en inference_engine.py)**

def predict(raw_frames: list[dict]) -> dict:
    # 1. Preprocesa: raw_frames → tensor (1, 15, 178)
    # 2. Ejecuta ONNX Runtime (thread-safe con lock)
    # 3. Calcula softmax sobre logits
    # 4. Aplica confidence_threshold (default 0.5)
    # 5. Retorna:
    return {
        "label": "hola",              # Clase predicha
        "confidence": 0.95,           # Probabilidad
        "latency_ms": 2.02,           # Tiempo total
        "all_probabilities": {...}    # Top-5 predicciones
    }
## BACKEND (FastAPI + WebSocket)

### **Archivo Principal: `expresat/backend/main.py`**

**Funciones Clave**:

|Función|Propósito|
|---|---|
|`lifespan(app)`|Inicializa/limpia servidor; carga modelo ONNX al startup|
|`ConnectionManager`|Gestiona conexiones WebSocket activas (list de clientes)|
|`get_inference_engine()`|Getter para acceder al motor singleton globalmente|
|`run_inference_async(frames)`|Offload inferencia a thread separado (no bloquea event loop)|
|`verify_supabase_token(token)`|Verifica JWT del cliente (dev: acepta cualquier token)|
|`@app.websocket("/ws/translate")`|Endpoint principal; soporta batch mode + stream mode|
|`@app.websocket("/ws")`|Legacy; redirige a `/ws/translate`|
|`@app.get("/health")`|Health check con info del modelo|
|`@app.get("/labels")`|Retorna lista de señas reconocidas|

### **Protocolo WebSocket**

**Cliente → Servidor**:
json
// BATCH MODE (recomendado)
{"type": "inference", "payload": [frame1, frame2, ..., frame15]}

// STREAM MODE (retrocompatible)
{"type": "inference", "payload": frame_dict}

// PING
{"type": "ping"}

**Servidor → Cliente**:
json:
{"type": "translation", "payload": {"label": "hola", "confidence": 0.95, ...}}
{"type": "pong"}
{"type": "error", "payload": "mensaje"}

### **Variables de Entorno**

SUPABASE_URL        # URL de proyecto Supabase
SUPABASE_KEY        # Service role key o anon key
MODEL_DIR           # Path a exported_model/ (default: ../models/exported_model)
CONFIDENCE_THRESHOLD # Mínimo de confianza (default: 0.5)
CORS_ORIGINS        # Dominios permitidos (default: "*")
PORT                # Puerto (default: 8000)
HOST                # Host (default: 0.0.0.0)

### **Ejecución**
# Instalación
cd expresat/backend
pip install -r requirements.txt

# Ejecución
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1
# NOTA: --workers 1 porque el modelo ONNX se carga una sola vez en memoria

# Health check
curl http://localhost:8000/health

## MODELOS (Entrenamiento & Exportación)

### **Archivo Principal: `expresat/models/train_and_export.py`**

**Pipeline Completo**:

python train_and_export.py \
    --epochs 50 \
    --output ./exported_model \
    --labels "hola" "gracias" "adios" ... \
    --benchmark

**Pasos Internos**:

1. **Construir modelo** → `SignLanguageGRU()`
2. **Entrenar** → 3000 muestras sintéticas, 50 épocas, loss = CrossEntropyLoss
3. **Exportar a ONNX** → `expresat_gru_float32.onnx` (opset 17)
4. **Cuantizar INT8** → `expresat_gru_int8.onnx` (4x más pequeño)
5. **Guardar metadatos** → `model_metadata.json` (labels, arquitectura, etc.)
6. **Benchmark** → Mide latencia en 100 corridas

**Salida de Archivos**:

exported_model/
├── expresat_gru.pt              # Checkpoint PyTorch
├── expresat_gru_float32.onnx    # Modelo sin cuantizar
├── expresat_gru_int8.onnx       # Modelo cuantizado (usado en prod)
└── model_metadata.json          # Metadatos JSON

### **InferenceEngine (`expresat/models/inference_engine.py`)**

**Métodos Principales**:

|Método|Input|Output|
|---|---|---|
|`__init__(model_dir, threshold)`|Path al modelo|Sesión ONNX cargada|
|`preprocess_batch(raw_frames)`|15 frames de MediaPipe|Tensor (1, 15, 178)|
|`_extract_pose_upper(pose)`|33 landmarks pose|Array (52,)|
|`_extract_hand(hand)`|21 landmarks mano|Array (63,)|
|`_normalize_to_shoulders(features, pose)`|Features + pose|Features normalizados|
|`predict(raw_frames)`|15 frames|{"label", "confidence", "latency_ms", ...}|
|`get_info()`|-|Info del motor (para health checks)|


## FRONTEND (React + Vite + MediaPipe.js)

### **Páginas Principales**

|Página|Archivo|Descripción|
|---|---|---|
|**Home**|`pages/Home.jsx`|Landing page, bienvenida|
|**Translator**|`pages/Translator.jsx`|**PRINCIPAL**: captura cámara en tiempo real|
|**Auth**|`pages/Auth.jsx`|Login/signup con Supabase|
|**Learn**|`pages/Learn.jsx`|Tutoriales de señas|
|**About**|`pages/About.jsx`|Info del proyecto|

### **Componentes Reutilizables**

|Componente|Propósito|
|---|---|
|`Navbar.jsx`|Navegación, links a páginas|
|`Footer.jsx`|Pie de página, info legal|
|`ThemeToggle.jsx`|Switch tema oscuro/claro|
|`EnvironmentSelector.jsx`|Selector dev/prod API|

### **Servicios (APIs/Integraciones)**

|Servicio|Función|
|---|---|
|`apiService.js`|**CRÍTICO**: WebSocket al backend, envía landmarks|
|`authService.js`|Login Supabase, obtiene JWT token|
|`mediapipeEngine.js`|Inicializa MediaPipe Holistic, extrae landmarks del video|

### **Flujo Principal en Translator.jsx**

1. Inicializar MediaPipe Holistic
2. Abrir cámara, capturar frames en tiempo real
3. Para cada frame:
   - Extraer landmarks con MediaPipe
   - Acumular en buffer de 15 frames
   - Cuando buffer lleno: enviar vía WebSocket al backend
4. Recibir traducción del servidor
5. Mostrar label en UI

### **Stack Frontend**

- **Framework**: React 19.2.7
- **Build Tool**: Vite 8.1.0
- **Routing**: React Router 7.18.0
- **UI Kit**: Lucide React 1.21.0 (iconos)
- **Backend**: Supabase JS 2.109.0 (auth + real-time)
- **Linter**: Oxlint 1.69.0

### **Ejecución**

cd expresat/frontend
npm install
npm run dev        # Dev server con hot-reload
npm run build      # Build para producción
npm run lint       # Lint código

## CARACTERÍSTICAS TÉCNICAS

### **Performance**

|Métrica|Valor|
|---|---|
|Tiempo Inferencia ONNX|2.02 ms|
|Latencia WebSocket (end-to-end)|~85 ms|
|Tamaño Modelo (INT8)|4 KB|
|Consumo RAM Backend|< 100 MB|
|FPS Captura|15 FPS|
|Buffer de Secuencia|15 frames = 1 segundo|

### **Dependencias Críticas**

**Backend** (`requirements.txt`):

fastapi==0.115.12          # Framework web asíncrono
uvicorn==0.34.3            # ASGI server
onnxruntime==1.22.0        # Motor inferencia (CPU-only)
numpy==2.2.6               # Procesamiento numérico
websockets==15.0.1         # WebSocket support
pydantic==2.11.3           # Validación datos

**Frontend** (`package.json`):

react                      # UI library
vite                       # Build tool
react-router-dom           # Routing
@supabase/supabase-js      # Auth + DB
lucide-react               # Iconos

## AUTENTICACIÓN (Supabase)

- **Sistema**: JWT tokens vía Supabase
- **Flujo**:
    1. Usuario login en `Auth.jsx`
    2. Recibe token JWT
    3. Envía token en query param WebSocket: `ws://backend/ws/translate?token=xxx`
    4. Backend valida token (dev: acepta cualquiera)
- **Archivo**: `expresat/frontend/src/services/authService.js`

---

## DOCUMENTACIÓN TÉCNICA

**Archivo Clave**: `expresat/docs/BACKEND_TECHNICAL_SPEC.md`

Contiene:

- Arquitectura de alto nivel
- Feature engineering detallado
- Normalización shoulder-relative
- Protocolo WebSocket
- Métricas de rendimiento
- Instrucciones para entrenar con datos reales

---

## QUICK START

 1. Backend cd expresat/backend pip install -r requirements.txt uvicorn main:app --reload

2. Frontend (en otra terminal) cd expresat/frontend npm install npm run dev

3. Abrir http://localhost:5173

4. Ir a página "Translator"

5. Permitir acceso a cámara

6. Hacer señas frente a cámara

## CONCEPTOS CLAVE PARA RECORDAR

- **MediaPipe Holistic**: Detecta pose + manos en video en tiempo real
- **GRU**: Red recurrente ligera (menos parámetros que LSTM)
- **ONNX Runtime**: Motor optimizado para ejecutar modelos en CPU sin PyTorch
- **Cuantización INT8**: Reduce modelo 4x sin perder precisión significativa
- **Shoulder-relative normalization**: Hace modelo invariante a posición/escala del usuario
- **Batch mode**: 15 frames juntos → más eficiente que frame por frame
- **Singleton pattern**: Modelo ONNX cargado UNA SOLA VEZ en startup