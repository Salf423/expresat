#include "mediapipe_extractor.h"
#include <cmath>
#include <cassert>
#include <iostream>

// ─── Stub vs. Real build paths ───────────────────────────────────────────────
#if EXPRESAT_USE_MEDIAPIPE && !EXPRESAT_STUB_EXTRACTOR
#  include "mediapipe/tasks/cc/vision/holistic_landmarker/holistic_landmarker.h"
#endif

namespace expresat {

// ─── Connection tables for skeleton drawing ───────────────────────────────────
static const std::vector<std::pair<int,int>> POSE_CONNECTIONS = {
    {0,1},{1,2},{2,3},{3,7}, {0,4},{4,5},{5,6},{6,8},
    {11,12},{11,13},{13,15},{15,17},{15,19},{15,21},{17,19},
    {12,14},{14,16},{16,18},{16,20},{16,22},{18,20},
    {11,23},{12,24}
};
static const std::vector<std::pair<int,int>> HAND_CONNECTIONS = {
    {0,1},{1,2},{2,3},{3,4},
    {0,5},{5,6},{6,7},{7,8},
    {0,9},{9,10},{10,11},{11,12},
    {0,13},{13,14},{14,15},{15,16},
    {0,17},{17,18},{18,19},{19,20},
    {5,9},{9,13},{13,17}
};

// ─── Constructor / Destructor ─────────────────────────────────────────────────
MediapipeExtractor::MediapipeExtractor()
    : MediapipeExtractor(Config{}) {}

MediapipeExtractor::MediapipeExtractor(Config cfg)
    : cfg_(std::move(cfg)) {}

MediapipeExtractor::~MediapipeExtractor() { close(); }

bool MediapipeExtractor::open() {
#if EXPRESAT_USE_MEDIAPIPE && !EXPRESAT_STUB_EXTRACTOR
    // Initialize real MediaPipe Tasks API
    // mp_ = std::make_unique<MPImpl>(...);
    // Full implementation requires Bazel-built MediaPipe C++ libs.
    std::cerr << "[MediapipeExtractor] Real MediaPipe mode not fully linked.\n";
    open_ = false;
    return false;
#else
    // Stub mode: always succeeds
    std::cout << "[MediapipeExtractor] Running in STUB mode (synthetic landmarks).\n";
    open_ = true;
    return true;
#endif
}

void MediapipeExtractor::close() {
    open_ = false;
#if EXPRESAT_USE_MEDIAPIPE && !EXPRESAT_STUB_EXTRACTOR
    mp_.reset();
#endif
}

// ─── process() — detect landmarks from a BGR frame ───────────────────────────
FrameLandmarks MediapipeExtractor::process(const cv::Mat& /*bgrFrame*/) {
    FrameLandmarks result;

#if EXPRESAT_STUB_EXTRACTOR
    // ── Stub: generate plausible sine-wave landmarks ─────────────────────
    ++stubFrameIdx_;
    float t = stubFrameIdx_ * 0.1f;

    // 33 pose landmarks (body centered near 0.5, 0.5)
    result.pose.resize(33);
    for (int i = 0; i < 33; ++i) {
        result.pose[i].x = 0.5f + 0.15f * std::cos(t + i * 0.3f);
        result.pose[i].y = 0.3f + 0.05f * i / 33.f + 0.02f * std::sin(t * 2 + i);
        result.pose[i].z = 0.0f + 0.01f * std::sin(t + i);
        result.pose[i].visibility = 0.95f;
    }
    result.poseValid = true;

    // 21 left-hand landmarks
    result.leftHand.resize(21);
    for (int i = 0; i < 21; ++i) {
        result.leftHand[i].x = 0.3f + 0.05f * std::cos(t * 1.5f + i * 0.5f);
        result.leftHand[i].y = 0.6f + 0.05f * std::sin(t * 1.5f + i * 0.5f);
        result.leftHand[i].z = 0.0f + 0.005f * i;
    }
    result.leftValid = true;

    // 21 right-hand landmarks
    result.rightHand.resize(21);
    for (int i = 0; i < 21; ++i) {
        result.rightHand[i].x = 0.7f + 0.05f * std::cos(t * 1.3f + i * 0.4f);
        result.rightHand[i].y = 0.6f + 0.05f * std::sin(t * 1.3f + i * 0.4f);
        result.rightHand[i].z = 0.0f + 0.005f * i;
    }
    result.rightValid = true;
#else
    // Real MediaPipe path (requires linked library)
    if (!open_) return result;
    // TODO: call mp_->Process(bgrFrame, &result);
#endif
    return result;
}

// ─── extract() — normalize + flatten to FeatureVector ────────────────────────
FeatureVector MediapipeExtractor::extract(const FrameLandmarks& landmarks,
                                          const BodyPartConfig& parts) {
    FeatureVector fv(TOTAL_FEATURES, 0.f);

    // Deep-copy so we can normalize in place
    std::vector<Landmark> pose      = landmarks.pose;
    std::vector<Landmark> leftHand  = landmarks.leftHand;
    std::vector<Landmark> rightHand = landmarks.rightHand;

    // ── Shoulder-relative normalization ───────────────────────────────────
    // Requires at least landmarks 11 and 12 in pose
    if (landmarks.poseValid && (int)pose.size() > SHOULDER_RIGHT) {
        normalizePose(pose, leftHand, rightHand);
    }

    int offset = 0;

    // ── Upper Pose (52 = 13 pts × 4) ──────────────────────────────────────
    if (parts.upperPose && landmarks.poseValid) {
        for (int idx : POSE_UPPER_INDICES) {
            if (idx < (int)pose.size()) {
                const auto& lm = pose[idx];
                fv[offset + 0] = lm.x;
                fv[offset + 1] = lm.y;
                fv[offset + 2] = lm.z;
                fv[offset + 3] = lm.visibility;
            }
            offset += POSE_COORDS;
        }
    } else {
        offset += POSE_FEATURE_DIM; // skip
    }

    // ── Left Hand (63 = 21 pts × 3) ───────────────────────────────────────
    if (parts.leftHand && landmarks.leftValid) {
        for (int i = 0; i < HAND_LANDMARK_COUNT && i < (int)leftHand.size(); ++i) {
            fv[offset + 0] = leftHand[i].x;
            fv[offset + 1] = leftHand[i].y;
            fv[offset + 2] = leftHand[i].z;
            offset += HAND_COORDS;
        }
    } else {
        offset += HAND_FEATURE_DIM;
    }

    // ── Right Hand (63 = 21 pts × 3) ──────────────────────────────────────
    if (parts.rightHand && landmarks.rightValid) {
        for (int i = 0; i < HAND_LANDMARK_COUNT && i < (int)rightHand.size(); ++i) {
            fv[offset + 0] = rightHand[i].x;
            fv[offset + 1] = rightHand[i].y;
            fv[offset + 2] = rightHand[i].z;
            offset += HAND_COORDS;
        }
    } else {
        offset += HAND_FEATURE_DIM;
    }

    assert(offset == TOTAL_FEATURES);
    return fv;
}

// ─── normalizePose() — shoulder-center subtraction ───────────────────────────
void MediapipeExtractor::normalizePose(std::vector<Landmark>& pose,
                                       std::vector<Landmark>& leftHand,
                                       std::vector<Landmark>& rightHand) {
    const auto& L = pose[SHOULDER_LEFT];
    const auto& R = pose[SHOULDER_RIGHT];
    float cx = (L.x + R.x) * 0.5f;
    float cy = (L.y + R.y) * 0.5f;
    float cz = (L.z + R.z) * 0.5f;

    // Shift upper-pose landmarks
    for (int idx : POSE_UPPER_INDICES) {
        if (idx < (int)pose.size()) {
            pose[idx].x -= cx;
            pose[idx].y -= cy;
            pose[idx].z -= cz;
            // visibility stays unchanged
        }
    }

    // Shift hands
    for (auto& lm : leftHand) {
        lm.x -= cx; lm.y -= cy; lm.z -= cz;
    }
    for (auto& lm : rightHand) {
        lm.x -= cx; lm.y -= cy; lm.z -= cz;
    }
}

// ─── drawSkeleton() ───────────────────────────────────────────────────────────
void MediapipeExtractor::drawSkeleton(cv::Mat& frame,
                                       const FrameLandmarks& lm,
                                       const BodyPartConfig& parts) {
    if (!parts.showSkeleton) return;

    int W = frame.cols, H = frame.rows;
    auto toPixel = [&](float nx, float ny) {
        return cv::Point(static_cast<int>(nx * W),
                         static_cast<int>(ny * H));
    };

    // Draw pose connections
    if (parts.upperPose && lm.poseValid) {
        for (auto [a, b] : POSE_CONNECTIONS) {
            if (a < (int)lm.pose.size() && b < (int)lm.pose.size()) {
                cv::line(frame, toPixel(lm.pose[a].x, lm.pose[a].y),
                                toPixel(lm.pose[b].x, lm.pose[b].y),
                         cv::Scalar(0, 255, 0), 2, cv::LINE_AA);
            }
        }
        for (int idx : POSE_UPPER_INDICES) {
            if (idx < (int)lm.pose.size()) {
                cv::circle(frame, toPixel(lm.pose[idx].x, lm.pose[idx].y),
                           4, cv::Scalar(255, 0, 0), -1, cv::LINE_AA);
            }
        }
    }

    // Draw left hand
    if (parts.leftHand && lm.leftValid) {
        for (auto [a, b] : HAND_CONNECTIONS) {
            if (a < (int)lm.leftHand.size() && b < (int)lm.leftHand.size()) {
                cv::line(frame, toPixel(lm.leftHand[a].x, lm.leftHand[a].y),
                                toPixel(lm.leftHand[b].x, lm.leftHand[b].y),
                         cv::Scalar(255, 165, 0), 2, cv::LINE_AA);
            }
        }
    }

    // Draw right hand
    if (parts.rightHand && lm.rightValid) {
        for (auto [a, b] : HAND_CONNECTIONS) {
            if (a < (int)lm.rightHand.size() && b < (int)lm.rightHand.size()) {
                cv::line(frame, toPixel(lm.rightHand[a].x, lm.rightHand[a].y),
                                toPixel(lm.rightHand[b].x, lm.rightHand[b].y),
                         cv::Scalar(0, 165, 255), 2, cv::LINE_AA);
            }
        }
    }
}

} // namespace expresat
