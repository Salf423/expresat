#pragma once
#include "types.h"
#include <opencv2/opencv.hpp>

namespace expresat {

/**
 * MediapipeExtractor — Extracts, normalizes, and flattens landmarks per frame.
 *
 * Build modes (set via CMake definitions):
 *   EXPRESAT_STUB_EXTRACTOR=1  → Returns synthetic sine-wave landmarks
 *                                 (no MediaPipe dependency, for GUI development).
 *   EXPRESAT_USE_MEDIAPIPE=1   → Full MediaPipe C++ Tasks API integration.
 *   Neither                    → Compile-error (must pick one mode).
 *
 * Usage:
 *   MediapipeExtractor extractor;
 *   extractor.open();
 *   FrameLandmarks raw = extractor.process(bgrFrame);
 *   FeatureVector  fv  = extractor.extract(raw, config);
 */
class MediapipeExtractor {
public:
    struct Config {
        Config() = default;
        float minDetectionConfidence = 0.5f;
        float minTrackingConfidence  = 0.5f;
        // Path to MediaPipe model bundle (only used in real mode)
        std::string modelPath = "models/holistic_landmarker.task";
    };

    MediapipeExtractor();
    explicit MediapipeExtractor(Config cfg);
    ~MediapipeExtractor();

    // Non-copyable
    MediapipeExtractor(const MediapipeExtractor&) = delete;
    MediapipeExtractor& operator=(const MediapipeExtractor&) = delete;

    /// Initialize the underlying detector. Returns false on failure.
    bool open();
    void close();
    bool isOpen() const { return open_; }

    /**
     * Run landmark detection on a BGR frame.
     * Thread-safe: each call is stateless (no shared detection state).
     */
    FrameLandmarks process(const cv::Mat& bgrFrame);

    /**
     * Flatten FrameLandmarks into a normalised FeatureVector.
     *
     * Normalization:
     *   - Compute shoulder center C = (P11 + P12) / 2
     *   - Subtract C from all x,y,z of Pose + Hands
     *   - visibility channel is NOT shifted (it stays raw)
     *
     * Layout: [pose_upper(52) | left_hand(63) | right_hand(63)] = 178 floats
     * If a part is disabled or absent, that region is filled with 0.
     *
     * @param landmarks  Raw detection result
     * @param parts      Which body parts to include
     * @return           Flat vector of TOTAL_FEATURES (178) floats
     */
    static FeatureVector extract(const FrameLandmarks& landmarks,
                                 const BodyPartConfig& parts = BodyPartConfig{});

    /**
     * Draw pose + hand skeleton overlays onto a BGR/RGB frame (in-place).
     * Only draws if `parts.showSkeleton` is true.
     */
    static void drawSkeleton(cv::Mat& frame,
                             const FrameLandmarks& landmarks,
                             const BodyPartConfig& parts);

private:
    Config cfg_;
    bool   open_ = false;

#if EXPRESAT_USE_MEDIAPIPE && !EXPRESAT_STUB_EXTRACTOR
    // MediaPipe Tasks API handle (opaque pointer to avoid header pollution)
    struct MPImpl;
    std::unique_ptr<MPImpl> mp_;
#endif

    // Stub state for deterministic fake landmarks
    mutable int stubFrameIdx_ = 0;

    // Internal helpers
    static void normalizePose(std::vector<Landmark>& pose,
                              std::vector<Landmark>& leftHand,
                              std::vector<Landmark>& rightHand);
};

} // namespace expresat
