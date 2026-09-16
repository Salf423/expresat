## Key Concepts

- **Native C++ Engine**: A high-performance inference engine built in C++17, replacing the legacy Python/FastAPI/WebSocket backend.
- **ONNX Runtime (C++ API)**: Used for executing the exported GRU model natively, providing massive latency reductions compared to Python PyTorch.
- **Lock-Free Concurrency**: The system uses atomic ring buffers and buses to communicate between the UI/Camera thread and the Inference thread without blocking.
- **MediaPipe Tasks**: (Planned) Replaces the Python MediaPipe Holistic pipeline with the C++ MediaPipe Tasks API for landmark extraction.

## Code Structure

The native backend (`expresat-native/core`) is organized into several key components:

1. **`inference_thread.h` / `.cpp`**: The core class managing the ONNX Runtime session, preprocessing landmark sequences, and running model inference.
2. **`frame_queue.h`**: A wait-free SPSC (Single-Producer Single-Consumer) ring buffer that safely passes webcam frames from the camera thread to the inference thread.
3. **`result_bus.h`**: An atomic bus allowing the inference thread to publish the latest predictions and the UI thread to read them asynchronously.
4. **`landmark_types.h`**: Defines the data structures for hand and pose landmarks (178 total features per frame).

## Code Examples

### Inference Thread Initialization

```cpp
// In inference_thread.cpp
InferenceThread::OrtState::OrtState() {
    opts.SetInterOpNumThreads(1);
    opts.SetIntraOpNumThreads(
        static_cast<int>(std::min(4u, std::thread::hardware_concurrency()))
    );
    opts.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);
    opts.SetExecutionMode(ExecutionMode::ORT_SEQUENTIAL);
    opts.DisableCpuMemArena();
    opts.EnableMemPattern();
}
```

This snippet initializes the ONNX Runtime environment, optimizing thread usage and graph execution specifically for local desktop/mobile constraints.

### Thread Safe Inter-communication

The system strictly separates video capture and inference processing. Instead of web sockets, the components talk using lock-free structures.

```cpp
// 1. In main.cpp (Camera Thread):
cv::Mat frame;
cap >> frame;
g_frame_queue.push(frame); // Non-blocking push

// 2. In inference_thread.cpp (Inference Thread):
cv::Mat current_frame;
if (frame_queue_.pop(current_frame)) {
    // Process frame...
    LandmarkFrame lm_frame = extract_landmarks(current_frame);
    push_landmark_frame(std::move(lm_frame));
    // ... run ONNX inference
    result_bus_.publish(prediction_string);
}
```

### Preprocessing and ONNX Execution

Once a sequence of 15 frames is accumulated, the engine flattens it into a `[1, 15, 178]` float tensor and feeds it to the model.

```cpp
// 5. ONNX Inference
auto input_tensor = preprocess_sequence();
auto logits = run_onnx(input_tensor);

// 6. Post-processing: softmax + top-5
std::vector<float> probs = softmax(logits);
```

By keeping the inference out of the main thread and moving from Python to Native C++, the system achieves significantly higher framerates and lower battery usage on mobile.
