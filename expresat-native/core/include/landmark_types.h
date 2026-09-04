#pragma once
#include <array>
#include <vector>
#include <cstddef>

namespace expresat {

// Model layout constants (must match model_metadata.json)
constexpr int SEQUENCE_LENGTH    = 15;
constexpr int NUM_FEATURES       = 178; // Pose upper (52) + Left hand (63) + Right hand (63)
constexpr int NUM_CLASSES        = 15;
constexpr float CONFIDENCE_THRESHOLD = 0.5f;

// MediaPipe Pose indices used by the model
constexpr std::array<int, 13> POSE_UPPER_INDICES = {
    0, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22
};
constexpr int POSE_COORDS  = 4;  // x, y, z, visibility
constexpr int HAND_POINTS  = 21;
constexpr int HAND_COORDS  = 3;  // x, y, z

struct PoseLandmark {
    float x{0.f}, y{0.f}, z{0.f}, visibility{0.f};
};

struct HandLandmark {
    float x{0.f}, y{0.f}, z{0.f};
};

struct LandmarkFrame {
    std::vector<PoseLandmark> pose;        // MediaPipe Pose (33 points)
    std::vector<HandLandmark> left_hand;   // 21 points if detected
    std::vector<HandLandmark> right_hand;  // 21 points if detected
    bool valid{false};
};

using FrameSequence = std::array<LandmarkFrame, SEQUENCE_LENGTH>;

} // namespace expresat
