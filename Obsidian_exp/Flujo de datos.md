[Cámara] → [MediaPipe Holistic] → [15 frames de landmarks] 
    ↓ (WebSocket)
[Backend] → [Preprocesamiento NumPy] → [ONNX Runtime]
    ↓
[Softmax + Umbral confianza] → [Traducción al cliente]