#include "inference_thread.h"

#include <onnxruntime_cxx_api.h>
#include <opencv2/imgproc.hpp>

#include <algorithm>
#include <cassert>
#include <cmath>
#include <iostream>
#include <numeric>
#include <stdexcept>
#include <thread>
#include <filesystem>

namespace expresat {

// Private ONNX Runtime session state (PIMPL)
struct InferenceThread::OrtState {
    Ort::Env            env{ORT_LOGGING_LEVEL_WARNING, "expresat"};
    Ort::SessionOptions opts;
    std::unique_ptr<Ort::Session> session;
    std::string         input_name;
    std::string         output_name;
    size_t              model_size_bytes{0};

    OrtState() {
        opts.SetInterOpNumThreads(1);
        opts.SetIntraOpNumThreads(
            static_cast<int>(std::min(4u, std::thread::hardware_concurrency()))
        );
        opts.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);
        opts.SetExecutionMode(ExecutionMode::ORT_SEQUENTIAL);
        opts.DisableCpuMemArena();
        opts.EnableMemPattern();
        opts.SetLogSeverityLevel(3); // ERROR only
    }
};

InferenceThread::InferenceThread(
    const std::string& onnx_model_path,
    FrameQueue<4>&     frame_queue,
    ResultBus&         result_bus,
    float              confidence_thr)
    : frame_queue_(frame_queue)
    , result_bus_(result_bus)
    , confidence_threshold_(confidence_thr)
    , model_path_(onnx_model_path)
    , ort_(std::make_unique<OrtState>())
    , fps_timer_(std::chrono::steady_clock::now())
{
    load_onnx_model(onnx_model_path);
}

InferenceThread::~InferenceThread() = default;

void InferenceThread::load_onnx_model(const std::string& path) {
#ifdef _WIN32
    std::wstring wpath(path.begin(), path.end());
    ort_->session = std::make_unique<Ort::Session>(
        ort_->env, wpath.c_str(), ort_->opts);
#else
    ort_->session = std::make_unique<Ort::Session>(
        ort_->env, path.c_str(), ort_->opts);
#endif

    Ort::AllocatorWithDefaultOptions alloc;
    auto in_name  = ort_->session->GetInputNameAllocated(0, alloc);
    auto out_name = ort_->session->GetOutputNameAllocated(0, alloc);
    ort_->input_name  = in_name.get();
    ort_->output_name = out_name.get();

    if (std::filesystem::exists(path)) {
        ort_->model_size_bytes = std::filesystem::file_size(path);
    }

    std::cout << "[Inference] ONNX model loaded: " << path << "\n";
    std::cout << "[Inference]   Input:  " << ort_->input_name << " [1, "
              << SEQUENCE_LENGTH << ", " << NUM_FEATURES << "]\n";
    std::cout << "[Inference]   Output: " << ort_->output_name << " [1, "
              << NUM_CLASSES << "]\n";
}

void InferenceThread::run(const std::atomic<bool>& running) {
    cv::Mat frame;

    while (running.load(std::memory_order_relaxed)) {
        // 1. Non-blocking pop from frame queue
        if (!frame_queue_.try_pop(frame)) {
            std::this_thread::yield();
            continue;
        }

        const auto t_start = std::chrono::steady_clock::now();
        ++global_frame_id_;

        // 2. Extract landmarks
        LandmarkFrame lm_frame = extract_landmarks(frame);
        lm_frame.valid = true;

        // 3. Push to circular buffer (15 frames)
        push_landmark_frame(std::move(lm_frame));

        if (frames_accumulated_ < SEQUENCE_LENGTH) continue;

        // 4. Preprocess -> tensor [1, 15, 178]
        const auto t_preprocess_start = std::chrono::steady_clock::now();
        auto input_tensor = preprocess_sequence();
        const float preprocess_ms = std::chrono::duration<float, std::milli>(
            std::chrono::steady_clock::now() - t_preprocess_start).count();

        // 5. ONNX Inference
        const auto t_infer_start = std::chrono::steady_clock::now();
        auto logits = run_onnx(input_tensor);
        const float infer_ms = std::chrono::duration<float, std::milli>(
            std::chrono::steady_clock::now() - t_infer_start).count();

        // 6. Post-processing: softmax + top-5
        auto probs      = softmax(logits);
        int  pred_idx   = static_cast<int>(
            std::distance(probs.begin(),
                          std::max_element(probs.begin(), probs.end())));
        float pred_conf = probs[pred_idx];

        std::vector<int> indices(NUM_CLASSES);
        std::iota(indices.begin(), indices.end(), 0);
        std::partial_sort(indices.begin(), indices.begin() + 5, indices.end(),
                          [&probs](int a, int b){ return probs[a] > probs[b]; });

        // 7. Calculate inference FPS
        ++fps_frame_count_;
        const float elapsed_s = std::chrono::duration<float>(
            std::chrono::steady_clock::now() - fps_timer_).count();
        if (elapsed_s >= 1.0f) {
            current_fps_    = fps_frame_count_ / elapsed_s;
            fps_frame_count_ = 0;
            fps_timer_       = std::chrono::steady_clock::now();
        }

        // 8. Publish result
        auto result = std::make_shared<InferenceResult>();
        result->valid              = true;
        result->confidence         = pred_conf;
        result->fps_inference      = current_fps_;
        result->latency_preprocess_ms = preprocess_ms;
        result->latency_inference_ms  = infer_ms;
        result->frame_id           = global_frame_id_;
        result->timestamp_ms       = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now().time_since_epoch()).count();

        if (pred_conf >= confidence_threshold_) {
            result->label = SIGN_LABELS[pred_idx];
        }

        for (int i = 0; i < 5; ++i) {
            result->top5.emplace_back(SIGN_LABELS[indices[i]], probs[indices[i]]);
        }

        result_bus_.publish(std::move(result));
    }
}

void InferenceThread::push_landmark_frame(LandmarkFrame&& frame) {
    sequence_buffer_[buffer_head_] = std::move(frame);
    buffer_head_ = (buffer_head_ + 1) % SEQUENCE_LENGTH;
    frames_accumulated_ = std::min(frames_accumulated_ + 1, SEQUENCE_LENGTH);
}

// Converts sequence buffer to normalized tensor [SEQUENCE_LENGTH * NUM_FEATURES]
std::array<float, SEQUENCE_LENGTH * NUM_FEATURES>
InferenceThread::preprocess_sequence() const {
    std::array<float, SEQUENCE_LENGTH * NUM_FEATURES> tensor{};

    for (int i = 0; i < SEQUENCE_LENGTH; ++i) {
        const int buf_idx = (buffer_head_ + i) % SEQUENCE_LENGTH;
        const auto& frame = sequence_buffer_[buf_idx];
        float* frame_ptr  = tensor.data() + i * NUM_FEATURES;

        if (!frame.valid) continue;

        auto pose_feats = extract_pose_upper(frame.pose);
        std::copy(pose_feats.begin(), pose_feats.end(), frame_ptr);

        auto lh_feats = extract_hand(frame.left_hand);
        std::copy(lh_feats.begin(), lh_feats.end(), frame_ptr + 52);

        auto rh_feats = extract_hand(frame.right_hand);
        std::copy(rh_feats.begin(), rh_feats.end(), frame_ptr + 115);

        // Normalize landmarks relative to shoulders (pose 11 & 12)
        if (frame.pose.size() > 12) {
            normalize_to_shoulders(
                frame_ptr, NUM_FEATURES,
                frame.pose[11], frame.pose[12]
            );
        }
    }
    return tensor;
}

std::array<float, POSE_COORDS * static_cast<int>(POSE_UPPER_INDICES.size())>
InferenceThread::extract_pose_upper(const std::vector<PoseLandmark>& pose) {
    constexpr int N = POSE_COORDS * static_cast<int>(POSE_UPPER_INDICES.size());
    std::array<float, N> out{};

    for (std::size_t i = 0; i < POSE_UPPER_INDICES.size(); ++i) {
        const int idx = POSE_UPPER_INDICES[i];
        if (idx < static_cast<int>(pose.size())) {
            const auto& lm = pose[idx];
            out[i * 4 + 0] = lm.x;
            out[i * 4 + 1] = lm.y;
            out[i * 4 + 2] = lm.z;
            out[i * 4 + 3] = lm.visibility;
        }
    }
    return out;
}

std::array<float, HAND_POINTS * HAND_COORDS>
InferenceThread::extract_hand(const std::vector<HandLandmark>& hand) {
    std::array<float, HAND_POINTS * HAND_COORDS> out{};
    const int n = static_cast<int>(std::min(hand.size(), static_cast<std::size_t>(HAND_POINTS)));
    for (int i = 0; i < n; ++i) {
        out[i * 3 + 0] = hand[i].x;
        out[i * 3 + 1] = hand[i].y;
        out[i * 3 + 2] = hand[i].z;
    }
    return out;
}

// Normalizes coordinates: relative to shoulder midpoint, scaled by shoulder distance
void InferenceThread::normalize_to_shoulders(
    float* features, int n,
    const PoseLandmark& ls, const PoseLandmark& rs)
{
    const float cx = (ls.x + rs.x) * 0.5f;
    const float cy = (ls.y + rs.y) * 0.5f;
    const float cz = (ls.z + rs.z) * 0.5f;

    const float dx = ls.x - rs.x;
    const float dy = ls.y - rs.y;
    const float scale = std::max(std::sqrt(dx * dx + dy * dy), 1e-6f);

    constexpr int POSE_END = static_cast<int>(POSE_UPPER_INDICES.size()) * POSE_COORDS;
    for (int j = 0; j < POSE_END; j += POSE_COORDS) {
        features[j + 0] = (features[j + 0] - cx) / scale;
        features[j + 1] = (features[j + 1] - cy) / scale;
        features[j + 2] = (features[j + 2] - cz) / scale;
    }

    for (int j = POSE_END; j < n; j += HAND_COORDS) {
        features[j + 0] = (features[j + 0] - cx) / scale;
        features[j + 1] = (features[j + 1] - cy) / scale;
        features[j + 2] = (features[j + 2] - cz) / scale;
    }
}

std::vector<float> InferenceThread::softmax(const std::vector<float>& logits) {
    std::vector<float> probs(logits.size());
    const float max_val = *std::max_element(logits.begin(), logits.end());
    float sum = 0.f;
    for (std::size_t i = 0; i < logits.size(); ++i) {
        probs[i] = std::exp(logits[i] - max_val);
        sum += probs[i];
    }
    for (auto& p : probs) p /= sum;
    return probs;
}

std::vector<float> InferenceThread::run_onnx(
    const std::array<float, SEQUENCE_LENGTH * NUM_FEATURES>& input)
{
    Ort::MemoryInfo mem_info =
        Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);

    const std::array<int64_t, 3> shape = {1, SEQUENCE_LENGTH, NUM_FEATURES};

    Ort::Value input_tensor = Ort::Value::CreateTensor<float>(
        mem_info,
        const_cast<float*>(input.data()),
        input.size(),
        shape.data(),
        shape.size()
    );

    const char* in_names[]  = {ort_->input_name.c_str()};
    const char* out_names[] = {ort_->output_name.c_str()};

    auto outputs = ort_->session->Run(
        Ort::RunOptions{nullptr},
        in_names,  &input_tensor, 1,
        out_names, 1
    );

    float* out_data = outputs[0].GetTensorMutableData<float>();
    const std::size_t out_size =
        outputs[0].GetTensorTypeAndShapeInfo().GetElementCount();

    return std::vector<float>(out_data, out_data + out_size);
}

// MediaPipe stub (replace with MediaPipe Tasks C++ API)
LandmarkFrame InferenceThread::extract_landmarks(const cv::Mat& /*frame*/) {
    LandmarkFrame lf;
    // TODO: Replace with MediaPipe Tasks C++ API
    lf.pose.resize(33);
    lf.left_hand.resize(21);
    lf.right_hand.resize(21);
    lf.valid = true;
    return lf;
}

InferenceThread::EngineInfo InferenceThread::engine_info() const {
    EngineInfo info;
    info.model_file     = model_path_;
    info.num_classes    = NUM_CLASSES;
    info.sequence_length= SEQUENCE_LENGTH;
    info.num_features   = NUM_FEATURES;
    if (ort_ && ort_->session) {
        info.input_name     = ort_->input_name;
        info.model_size_bytes = ort_->model_size_bytes;
    }
    info.ort_version = OrtGetApiBase()->GetVersionString();
    return info;
}

} // namespace expresat
