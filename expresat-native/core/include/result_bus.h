#pragma once
#include <atomic>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace expresat {

// Model class labels (matches model_metadata.json order)
static const std::vector<std::string> SIGN_LABELS = {
    "hello",      "thank_you",   "please",    "goodbye", "yes",
    "no",         "help",        "good",      "bad",     "name",
    "how_are_you","nice_to_meet","sorry",     "water",   "food"};

struct InferenceResult {
  std::string label;      // Predicted sign label
  float confidence{0.0f}; // Main prediction confidence [0.0, 1.0]
  std::vector<std::pair<std::string, float>> top5; // Top-5 class probabilities
  float fps_inference{0.0f};
  float latency_preprocess_ms{0.0f};
  float latency_inference_ms{0.0f};
  int64_t timestamp_ms{0};
  uint64_t frame_id{0};
  bool valid{false};
};

// Thread-safe result publication via atomic shared_ptr swap (non-blocking).
class ResultBus {
public:
  ResultBus() = default;
  ResultBus(const ResultBus &) = delete;
  ResultBus &operator=(const ResultBus &) = delete;

  void publish(std::shared_ptr<InferenceResult> result) noexcept {
    std::atomic_store_explicit(&latest_, std::move(result),
                               std::memory_order_release);
  }

  [[nodiscard]]
  std::shared_ptr<InferenceResult> latest() const noexcept {
    return std::atomic_load_explicit(&latest_, std::memory_order_acquire);
  }

  void reset() noexcept {
    std::atomic_store_explicit(&latest_,
                               std::shared_ptr<InferenceResult>{nullptr},
                               std::memory_order_release);
  }

private:
  std::shared_ptr<InferenceResult> latest_{nullptr};
};

} // namespace expresat
