#pragma once
#include "frame_queue.h"
#include "landmark_types.h"
#include "result_bus.h"

#include <array>
#include <atomic>
#include <chrono>
#include <memory>
#include <string>

namespace Ort {
class Session;
class Env;
class SessionOptions;
} // namespace Ort

namespace expresat {

// Dedicated inference pipeline: consumes frames, extracts landmarks, runs ONNX
// GRU model, publishes results.
class InferenceThread {
public:
  explicit InferenceThread(const std::string &onnx_model_path,
                           FrameQueue<4> &frame_queue, ResultBus &result_bus,
                           float confidence_thr = CONFIDENCE_THRESHOLD);

  ~InferenceThread();

  InferenceThread(const InferenceThread &) = delete;
  InferenceThread &operator=(const InferenceThread &) = delete;

  // Main thread loop. Runs until `running` is false.
  void run(const std::atomic<bool> &running);

  struct EngineInfo {
    std::string model_file;
    size_t model_size_bytes{0};
    int num_classes{0};
    int sequence_length{0};
    int num_features{0};
    std::string input_name;
    std::string ort_version;
  };
  [[nodiscard]] EngineInfo engine_info() const;

private:
  void load_onnx_model(const std::string &path);
  std::vector<float>
  run_onnx(const std::array<float, SEQUENCE_LENGTH * NUM_FEATURES> &input);

  void push_landmark_frame(LandmarkFrame &&frame);
  std::array<float, SEQUENCE_LENGTH * NUM_FEATURES> preprocess_sequence() const;

  static std::array<float,
                    POSE_COORDS *static_cast<int>(POSE_UPPER_INDICES.size())>
  extract_pose_upper(const std::vector<PoseLandmark> &pose);

  static std::array<float, HAND_POINTS * HAND_COORDS>
  extract_hand(const std::vector<HandLandmark> &hand);

  static void normalize_to_shoulders(float *features, int n,
                                     const PoseLandmark &left_shoulder,
                                     const PoseLandmark &right_shoulder);

  static std::vector<float> softmax(const std::vector<float> &logits);

  LandmarkFrame extract_landmarks(const cv::Mat &frame);

  FrameQueue<4> &frame_queue_;
  ResultBus &result_bus_;
  float confidence_threshold_;
  std::string model_path_;

  // Circular sequence buffer (15 frames)
  std::array<LandmarkFrame, SEQUENCE_LENGTH> sequence_buffer_{};
  int buffer_head_{0};
  int frames_accumulated_{0};

  struct OrtState;
  std::unique_ptr<OrtState> ort_;

  std::chrono::steady_clock::time_point fps_timer_;
  int fps_frame_count_{0};
  float current_fps_{0.f};

  uint64_t global_frame_id_{0};
};

} // namespace expresat
