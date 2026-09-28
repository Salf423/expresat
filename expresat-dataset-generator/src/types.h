#pragma once
#include <vector>
#include <string>
#include <array>

namespace expresat {

// ─── Feature layout constants (must match train_and_export.py) ──────────────
// Upper Pose: landmarks {0,11,12,13,14,15,16,17,18,19,20,21,22} = 13 pts × 4D
constexpr int POSE_UPPER_COUNT     = 13;
constexpr int POSE_COORDS          = 4;   // x, y, z, visibility
constexpr int POSE_FEATURE_DIM     = POSE_UPPER_COUNT * POSE_COORDS; // 52

// Hand: 21 landmarks × 3D
constexpr int HAND_LANDMARK_COUNT  = 21;
constexpr int HAND_COORDS          = 3;   // x, y, z
constexpr int HAND_FEATURE_DIM     = HAND_LANDMARK_COUNT * HAND_COORDS; // 63

// Total per frame = 52 + 63 + 63
constexpr int TOTAL_FEATURES       = POSE_FEATURE_DIM + HAND_FEATURE_DIM * 2; // 178
constexpr int DEFAULT_SEQUENCE_LEN = 15; // frames (1 second @ 15 FPS)

// Pose landmark indices used for upper body
constexpr std::array<int,13> POSE_UPPER_INDICES = {0,11,12,13,14,15,16,17,18,19,20,21,22};
// Reference landmarks for shoulder-center normalization
constexpr int SHOULDER_LEFT  = 11;
constexpr int SHOULDER_RIGHT = 12;

// ─── Raw landmark from MediaPipe ────────────────────────────────────────────
struct Landmark {
    Landmark() = default;
    float x = 0.f, y = 0.f, z = 0.f;
    float visibility = 1.f; // only meaningful for Pose
};

// ─── Per-frame extracted data (before flattening) ───────────────────────────
struct FrameLandmarks {
    FrameLandmarks() = default;
    std::vector<Landmark> pose;      // 33 pose landmarks (full)
    std::vector<Landmark> leftHand;  // 21 or empty
    std::vector<Landmark> rightHand; // 21 or empty
    bool poseValid     = false;
    bool leftValid     = false;
    bool rightValid    = false;
};

// ─── Flattened feature vector (one frame) ───────────────────────────────────
// Layout: [pose_upper(52), left_hand(63), right_hand(63)]
using FeatureVector = std::vector<float>;

// ─── A sequence of frames ───────────────────────────────────────────────────
using Sequence = std::vector<FeatureVector>;

// ─── GUI-configurable body parts ────────────────────────────────────────────
struct BodyPartConfig {
    BodyPartConfig() = default;
    bool upperPose  = true;
    bool leftHand   = true;
    bool rightHand  = true;
    bool faceExtra  = false;
    bool showSkeleton = true;
};

// ─── Recording session config ────────────────────────────────────────────────
struct RecordingConfig {
    RecordingConfig() = default;
    std::string label         = "hola";
    int         syntheticN    = 500;
    int         sequenceLen   = DEFAULT_SEQUENCE_LEN;
};

// ─── App state machine ───────────────────────────────────────────────────────
enum class AppState {
    Idle,
    CountingDown,   // 3-2-1 countdown before recording
    Recording,      // capturing live sequence
    Processing,     // generating synthetic data
    Done,           // generation complete, ready to save
    Error
};

} // namespace expresat
