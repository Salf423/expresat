[Camera] → [MediaPipe Holistic] → [15 landmark frames] 
    ↓ (WebSocket)
[Backend] → [NumPy Preprocessing] → [ONNX Runtime]
    ↓
[Softmax + Confidence Threshold] → [Client Translation]