| Region | MediaPipe Landmarks | Coords | Total |
| --- | --- | --- | --- |
| **Upper Pose** | 0, 11-22 (head, shoulders, elbows, wrists) | x, y, z, visibility (4D) | 13 × 4 = **52** |
| **Left Hand** | 0-20 (21 points) | x, y, z (3D) | 21 × 3 = **63** |
| **Right Hand** | 0-20 (21 points) | x, y, z (3D) | 21 × 3 = **63** |
| **TOTAL** | | | **178 features** |

### **Model Architecture**

**Name**: `SignLanguageGRU` (PyTorch)

- **Input**: `(batch, 15 frames, 178 features)`
- **GRU Layer**: 64 hidden units, unidirectional (1 layer)
- **Classifier Head**: Linear(64→32) + ReLU + Dropout(0.3) + Linear(32→num_classes)
- **Total Parameters**: ~12,000 (ultra-lightweight)
- **Why GRU?**: 25% fewer parameters than LSTM with equal performance on short sequences (15 frames).

**ONNX Optimization**:

1. Export from PyTorch using opset 17
2. Apply INT8 dynamic quantization
3. Result: **4 KB model + 193 KB data** (95% smaller than float32)

### **Preprocessing (`preprocess_batch` function in `inference_engine.py`)**

```python
# Input: raw_frames = [frame1, frame2, ..., frame15]
# Each frame: {"pose": [...], "leftHand": [...], "rightHand": [...]}

def preprocess_batch(raw_frames):
    # 1. Extract upper pose (13 landmarks × 4 coords) → 52D
    # 2. Extract left hand (21 landmarks × 3 coords) → 63D
    # 3. Extract right hand (21 landmarks × 3 coords) → 63D
    # 4. Normalize relative to shoulders
    # 5. Return tensor (1, 15, 178) dtype=float32
```

### **Inference (`predict` function in `inference_engine.py`)**

```python
def predict(raw_frames: list[dict]) -> dict:
    # 1. Preprocess: raw_frames → tensor (1, 15, 178)
    # 2. Run ONNX Runtime (thread-safe with lock)
    # 3. Compute softmax over logits
    # 4. Apply confidence_threshold (default 0.5)
    # 5. Return:
    return {
        "label": "hola",              # Predicted class
        "confidence": 0.95,           # Probability
        "latency_ms": 2.02,           # Total execution time
        "all_probabilities": {...}    # Top-5 predictions
    }
```

## BACKEND (FastAPI + WebSocket)

### **Main File: `expresat/backend/main.py`**

**Key Functions**:

| Function | Purpose |
| --- | --- |
| `lifespan(app)` | Initializes/cleans up server; loads ONNX model at startup |
| `ConnectionManager` | Manages active WebSocket connections (client list) |
| `get_inference_engine()` | Getter to access global engine singleton |
| `run_inference_async(frames)` | Offloads inference to a separate thread (non-blocking for event loop) |
| `verify_supabase_token(token)` | Verifies client JWT (dev mode: accepts any token) |
| `@app.websocket("/ws/translate")` | Main endpoint; supports batch mode + stream mode |
| `@app.websocket("/ws")` | Legacy endpoint; redirects to `/ws/translate` |
| `@app.get("/health")` | Health check returning model metadata |
| `@app.get("/labels")` | Returns list of recognized sign labels |

### **WebSocket Protocol**

**Client → Server**:
```json
// BATCH MODE (recommended)
{"type": "inference", "payload": [frame1, frame2, ..., frame15]}

// STREAM MODE (backwards-compatible)
{"type": "inference", "payload": frame_dict}

// PING
{"type": "ping"}
```

**Server → Client**:
```json
{"type": "translation", "payload": {"label": "hola", "confidence": 0.95, ...}}
{"type": "pong"}
{"type": "error", "payload": "message"}
```

### **Environment Variables**

```env
SUPABASE_URL         # Supabase project URL
SUPABASE_KEY         # Service role key or anon key
MODEL_DIR            # Path to exported_model/ (default: ../models/exported_model)
CONFIDENCE_THRESHOLD # Minimum confidence threshold (default: 0.5)
CORS_ORIGINS         # Allowed origins (default: "*")
PORT                 # Port number (default: 8000)
HOST                 # Host address (default: 0.0.0.0)
```

### **Execution**

```bash
# Installation
cd expresat/backend
pip install -r requirements.txt

# Execution
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1
# NOTE: --workers 1 because the ONNX model is loaded once in memory

# Health check
curl http://localhost:8000/health
```

## MODELS (Training & Export)

### **Main File: `expresat/models/train_and_export.py`**

**Full Pipeline**:

```bash
python train_and_export.py \
    --epochs 50 \
    --output ./exported_model \
    --labels "hola" "gracias" "adios" ... \
    --benchmark
```

**Internal Steps**:

1. **Build model** → `SignLanguageGRU()`
2. **Train** → 3000 synthetic samples, 50 epochs, loss = CrossEntropyLoss
3. **Export to ONNX** → `expresat_gru_float32.onnx` (opset 17)
4. **Quantize INT8** → `expresat_gru_int8.onnx` (4x smaller)
5. **Save metadata** → `model_metadata.json` (labels, architecture, etc.)
6. **Benchmark** → Measure latency over 100 runs

**File Output**:

```
exported_model/
├── expresat_gru.pt              # PyTorch checkpoint
├── expresat_gru_float32.onnx    # Unquantized model
├── expresat_gru_int8.onnx       # Quantized model (used in production)
└── model_metadata.json          # JSON Metadata
```

### **InferenceEngine (`expresat/models/inference_engine.py`)**

**Main Methods**:

| Method | Input | Output |
| --- | --- | --- |
| `__init__(model_dir, threshold)` | Path to model directory | Loaded ONNX session |
| `preprocess_batch(raw_frames)` | 15 MediaPipe frames | Tensor (1, 15, 178) |
| `_extract_pose_upper(pose)` | 33 pose landmarks | Array (52,) |
| `_extract_hand(hand)` | 21 hand landmarks | Array (63,) |
| `_normalize_to_shoulders(features, pose)` | Features + pose | Normalized features |
| `predict(raw_frames)` | 15 frames | {"label", "confidence", "latency_ms", ...} |
| `get_info()` | - | Engine info (for health checks) |

## FRONTEND (React + Vite + MediaPipe.js)

### **Main Pages**

| Page | File | Description |
| --- | --- | --- |
| **Home** | `pages/Home.jsx` | Landing page, welcome screen |
| **Translator** | `pages/Translator.jsx` | **MAIN**: Real-time camera stream capture |
| **Auth** | `pages/Auth.jsx` | Login/signup with Supabase |
| **Learn** | `pages/Learn.jsx` | Sign language tutorials |
| **About** | `pages/About.jsx` | Project information |

### **Reusable Components**

| Component | Purpose |
| --- | --- |
| `Navbar.jsx` | Navigation, page links |
| `Footer.jsx` | Footer, legal info |
| `ThemeToggle.jsx` | Dark/light theme toggle |
| `EnvironmentSelector.jsx` | Dev/prod API selector |

### **Services (APIs/Integrations)**

| Service | Function |
| --- | --- |
| `apiService.js` | **CRITICAL**: Backend WebSocket connection, sends landmarks |
| `authService.js` | Supabase login, retrieves JWT token |
| `mediapipeEngine.js` | Initializes MediaPipe Holistic, extracts video landmarks |

### **Main Flow in `Translator.jsx`**

1. Initialize MediaPipe Holistic
2. Open camera, capture real-time frames
3. For each frame:
   - Extract landmarks with MediaPipe
   - Accumulate in 15-frame buffer
   - When buffer is full: send via WebSocket to backend
4. Receive translation from server
5. Display label in UI

### **Frontend Stack**

- **Framework**: React 19.2.7
- **Build Tool**: Vite 8.1.0
- **Routing**: React Router 7.18.0
- **UI Kit**: Lucide React 1.21.0 (icons)
- **Backend**: Supabase JS 2.109.0 (auth + real-time)
- **Linter**: Oxlint 1.69.0

### **Execution**

```bash
cd expresat/frontend
npm install
npm run dev        # Dev server with hot-reload
npm run build      # Build for production
npm run lint       # Lint code
```

## TECHNICAL FEATURES

### **Performance**

| Metric | Value |
| --- | --- |
| ONNX Inference Time | 2.02 ms |
| WebSocket Latency (end-to-end) | ~85 ms |
| Model Size (INT8) | 4 KB |
| Backend RAM Usage | < 100 MB |
| Capture FPS | 15 FPS |
| Sequence Buffer | 15 frames = 1 second |

### **Critical Dependencies**

**Backend** (`requirements.txt`):
```text
fastapi==0.115.12          # Asynchronous web framework
uvicorn==0.34.3            # ASGI server
onnxruntime==1.22.0        # Inference engine (CPU-only)
numpy==2.2.6               # Numerical processing
websockets==15.0.1         # WebSocket support
pydantic==2.11.3           # Data validation
```

**Frontend** (`package.json`):
```text
react                      # UI library
vite                       # Build tool
react-router-dom           # Routing
@supabase/supabase-js      # Auth + DB
lucide-react               # Icons
```

## AUTHENTICATION (Supabase)

- **System**: JWT tokens via Supabase
- **Flow**:
    1. User logs in on `Auth.jsx`
    2. Receives JWT token
    3. Sends token as WebSocket query parameter: `ws://backend/ws/translate?token=xxx`
    4. Backend validates token (dev mode: accepts any)
- **File**: `expresat/frontend/src/services/authService.js`

---

## TECHNICAL DOCUMENTATION

**Key File**: `expresat/docs/BACKEND_TECHNICAL_SPEC.md`

Contains:

- High-level architecture
- Detailed feature engineering
- Shoulder-relative normalization
- WebSocket protocol
- Performance metrics
- Instructions for training with real data

---

## QUICK START

1. Backend:
```bash
cd expresat/backend
pip install -r requirements.txt
uvicorn main:app --reload
```

2. Frontend (in another terminal):
```bash
cd expresat/frontend
npm install
npm run dev
```

3. Open `http://localhost:5173`
4. Navigate to "Translator" page
5. Allow camera access
6. Perform signs in front of the camera

## KEY CONCEPTS TO REMEMBER

- **MediaPipe Holistic**: Detects pose + hands in real-time video
- **GRU**: Lightweight recurrent network (fewer parameters than LSTM)
- **ONNX Runtime**: Optimized engine for executing models on CPU without PyTorch
- **INT8 Quantization**: Reduces model size by 4x without significant loss of accuracy
- **Shoulder-relative normalization**: Makes model invariant to user position and scale
- **Batch mode**: 15 frames sent together → more efficient than frame-by-frame
- **Singleton pattern**: ONNX model loaded ONCE at startup