## Key Concepts

1. **GRU (Gated Recurrent Unit)**: The model architecture used to learn sequence dependencies in sign language gestures. It's more efficient than LSTM, providing lower latency for real-time inference.
2. **ONNX Runtime**: A high-performance inference engine used to execute the `.onnx` model natively in C++ across Desktop and Android targets.
3. **Keypoints (Landmarks)**: 178 features extracted per frame (pose upper body, left hand, right hand coordinates) normalized relative to the shoulders.
4. **Sequence Buffer**: A rolling window of frames (Sequence Length = 15) maintained in memory to provide temporal context to the GRU model.

## Code Structure

The inference logic is encapsulated within the `InferenceThread` class in C++. Below are its main responsibilities:

- **Initialization (`__init__` / Constructor)**: Loads the `.onnx` model into memory, configures ONNX Runtime session options (threading, optimization), and prepares the rolling sequence buffer.
- **Landmark Extraction (`extract_landmarks`)**: (Pending transition to MediaPipe Tasks API in C++) Extracts body and hand landmarks from a given OpenCV frame.
- **Sequence Preprocessing (`preprocess_sequence`)**: Flattens the accumulated 15 frames into a continuous 1D float array of size `15 * 178`, required by the ONNX model input shape `[1, 15, 178]`.
- **Inference (`run_onnx`)**: Pushes the preprocessed tensor into the ONNX Runtime session and receives the raw prediction logits.
- **Post-processing (`softmax`)**: Converts logits into normalized confidence scores to determine if the `CONFIDENCE_THRESHOLD` has been met.

## Code Examples

### Inference Thread Loop

```cpp
void InferenceThread::run(const std::atomic<bool> &running) {
    while (running) {
        cv::Mat current_frame;
        // 1. Pop from queue (Wait-free)
        if (!frame_queue_.pop(current_frame)) {
            std::this_thread::sleep_for(std::chrono::milliseconds(2));
            continue;
        }

        // 2. Extract landmarks
        LandmarkFrame lm_frame = extract_landmarks(current_frame);

        // 3. Push to circular buffer (15 frames)
        push_landmark_frame(std::move(lm_frame));

        if (frames_accumulated_ < SEQUENCE_LENGTH) continue;

        // 4. Preprocess -> tensor [1, 15, 178]
        auto input_tensor = preprocess_sequence();

        // 5. ONNX Inference
        auto logits = run_onnx(input_tensor);

        // 6. Post-processing: softmax + top-5
        std::vector<float> probs = softmax(logits);
        
        // ... threshold checking and publishing to ResultBus
    }
}
```

This represents the core loop of the C++ inference engine. Notice how the logic accumulates frames until it reaches `SEQUENCE_LENGTH` before running `run_onnx`. This ensures the model always receives the correct temporal window.

### ONNX Model Execution

```cpp
std::vector<float> InferenceThread::run_onnx(const std::array<float, SEQUENCE_LENGTH * NUM_FEATURES>& input) {
    std::vector<int64_t> input_dims = {1, SEQUENCE_LENGTH, NUM_FEATURES};

    auto memory_info = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
    auto input_tensor = Ort::Value::CreateTensor<float>(
        memory_info, const_cast<float*>(input.data()), input.size(),
        input_dims.data(), input_dims.size()
    );

    const char* input_names[] = { ort_->input_name.c_str() };
    const char* output_names[] = { ort_->output_name.c_str() };

    auto output_tensors = ort_->session->Run(
        Ort::RunOptions{nullptr}, input_names, &input_tensor, 1, output_names, 1
    );

    float* floatarr = output_tensors.front().GetTensorMutableData<float>();
    size_t out_count = output_tensors.front().GetTensorTypeAndShapeInfo().GetElementCount();

    return std::vector<float>(floatarr, floatarr + out_count);
}
```

This method bridges our application's `std::array` with the `Ort::Value::CreateTensor` wrapper and invokes the model in a single call.