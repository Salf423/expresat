#pragma once
#include "types.h"
#include <random>
#include <functional>

namespace expresat {

/**
 * DataAugmenter — Synthetic sequence generator
 *
 * Given one real base sequence (15 frames × 178 features), produces N
 * augmented variants by applying stochastic transforms in this order:
 *
 *  1. Gaussian noise   (σ = 0.005-0.02)          — per-coordinate jitter
 *  2. Spatial scale    (0.90x – 1.10x)            — uniform XYZ scale
 *  3. 2D XY rotation   (±5°)                      — sign-plane rotation
 *  4. Temporal warp    (±10% speed variation)      — frame-index resampling
 *
 * All transforms are applied in a single pass to keep memory coherent.
 */
class DataAugmenter {
public:
    struct Config {
        Config() = default;
        // Gaussian noise
        float noiseMin   = 0.005f;
        float noiseMax   = 0.020f;
        // Spatial scale range
        float scaleMin   = 0.90f;
        float scaleMax   = 1.10f;
        // Rotation range (degrees)
        float rotDegMin  = -5.0f;
        float rotDegMax  =  5.0f;
        // Temporal warp: fraction of frames that can be shifted
        float warpFactor = 0.10f;
        // Progress callback: called with (current, total)
        std::function<void(int,int)> onProgress;
    };

    DataAugmenter();
    explicit DataAugmenter(Config cfg);

    /**
     * Generate `count` augmented sequences from `base`.
     * Thread-safe: uses per-call RNG state.
     * @param base       Original sequence (sequenceLen × featureDim)
     * @param count      Number of synthetic samples to generate
     * @param featureDim Width of each feature vector (default 178)
     * @return           Vector of `count` augmented sequences
     */
    std::vector<Sequence> generate(
        const Sequence& base,
        int count,
        int featureDim = TOTAL_FEATURES
    );

private:
    Config cfg_;
    std::mt19937 rng_;

    Sequence applyNoise   (const Sequence& seq, float sigma);
    Sequence applyScale   (const Sequence& seq, float scale);
    Sequence applyRotation(const Sequence& seq, float angleDeg, int featureDim);
    Sequence applyTemporalWarp(const Sequence& seq, float warpFactor);
};

} // namespace expresat
