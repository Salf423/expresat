#include "data_augmenter.h"
#include <cmath>
#include <algorithm>
#include <cassert>
#include <stdexcept>

namespace expresat {

// ─── Constants ────────────────────────────────────────────────────────────────
static constexpr float PI = 3.14159265358979f;
static constexpr float DEG2RAD = PI / 180.f;

// ─── Constructor ──────────────────────────────────────────────────────────────
DataAugmenter::DataAugmenter()
    : DataAugmenter(Config{})
{}

DataAugmenter::DataAugmenter(Config cfg)
    : cfg_(std::move(cfg))
{
    std::random_device rd;
    rng_.seed(rd());
}

// ─── generate() — main entry point ───────────────────────────────────────────
std::vector<Sequence> DataAugmenter::generate(const Sequence& base,
                                               int count,
                                               int featureDim) {
    if (base.empty())
        throw std::invalid_argument("DataAugmenter::generate — base sequence is empty");
    if (count <= 0)
        throw std::invalid_argument("DataAugmenter::generate — count must be positive");

    std::vector<Sequence> results;
    results.reserve(count);

    // Per-call distributions (keeps generate() re-entrant if called from threads)
    std::uniform_real_distribution<float> noiseDist(cfg_.noiseMin, cfg_.noiseMax);
    std::uniform_real_distribution<float> scaleDist(cfg_.scaleMin, cfg_.scaleMax);
    std::uniform_real_distribution<float> rotDist(cfg_.rotDegMin, cfg_.rotDegMax);
    std::uniform_real_distribution<float> warpDist(0.f, cfg_.warpFactor);

    for (int i = 0; i < count; ++i) {
        float sigma    = noiseDist(rng_);
        float scale    = scaleDist(rng_);
        float angleDeg = rotDist(rng_);
        float warp     = warpDist(rng_);

        // Apply transforms in order: noise → scale → rotation → temporal warp
        Sequence s = applyNoise(base, sigma);
        s = applyScale(s, scale);
        s = applyRotation(s, angleDeg, featureDim);
        s = applyTemporalWarp(s, warp);

        results.push_back(std::move(s));

        if (cfg_.onProgress)
            cfg_.onProgress(i + 1, count);
    }

    return results;
}

// ─── applyNoise() — Gaussian per-coordinate jitter ───────────────────────────
Sequence DataAugmenter::applyNoise(const Sequence& seq, float sigma) {
    std::normal_distribution<float> noise(0.f, sigma);
    Sequence out;
    out.reserve(seq.size());
    for (const auto& frame : seq) {
        FeatureVector fv = frame;
        for (auto& v : fv) v += noise(rng_);
        out.push_back(std::move(fv));
    }
    return out;
}

// ─── applyScale() — uniform XYZ scale ────────────────────────────────────────
// Scales x,y,z but NOT the visibility channel (every 4th value in pose block).
// For hand blocks (pure x,y,z triplets) all values are scaled.
// Simple heuristic: scale every value uniformly (visibility clamped to [0,1]).
Sequence DataAugmenter::applyScale(const Sequence& seq, float scale) {
    Sequence out;
    out.reserve(seq.size());
    for (const auto& frame : seq) {
        FeatureVector fv = frame;

        // Pose block: 52 values (13 × 4: x,y,z,vis)
        for (int pt = 0; pt < POSE_UPPER_COUNT; ++pt) {
            int base = pt * POSE_COORDS;
            fv[base + 0] *= scale;
            fv[base + 1] *= scale;
            fv[base + 2] *= scale;
            // visibility (index base+3) — untouched
        }

        // Left hand block: starts at POSE_FEATURE_DIM
        int handStart = POSE_FEATURE_DIM;
        for (int i = handStart; i < handStart + HAND_FEATURE_DIM; ++i)
            fv[i] *= scale;

        // Right hand block
        int rHandStart = POSE_FEATURE_DIM + HAND_FEATURE_DIM;
        for (int i = rHandStart; i < rHandStart + HAND_FEATURE_DIM; ++i)
            fv[i] *= scale;

        out.push_back(std::move(fv));
    }
    return out;
}

// ─── applyRotation() — 2D XY rotation (sign plane) ───────────────────────────
// Rotates x,y pairs across all spatial positions (skips visibility channel
// in pose block; z is left unchanged — minimal out-of-plane movement).
Sequence DataAugmenter::applyRotation(const Sequence& seq,
                                       float angleDeg,
                                       int /*featureDim*/) {
    float theta = angleDeg * DEG2RAD;
    float cosT  = std::cos(theta);
    float sinT  = std::sin(theta);

    auto rotateXY = [&](float& x, float& y) {
        float nx = cosT * x - sinT * y;
        float ny = sinT * x + cosT * y;
        x = nx; y = ny;
    };

    Sequence out;
    out.reserve(seq.size());
    for (const auto& frame : seq) {
        FeatureVector fv = frame;

        // Pose block
        for (int pt = 0; pt < POSE_UPPER_COUNT; ++pt) {
            int b = pt * POSE_COORDS;
            rotateXY(fv[b + 0], fv[b + 1]);
        }

        // Left hand
        int hs = POSE_FEATURE_DIM;
        for (int pt = 0; pt < HAND_LANDMARK_COUNT; ++pt) {
            int b = hs + pt * HAND_COORDS;
            rotateXY(fv[b + 0], fv[b + 1]);
        }

        // Right hand
        int rhs = POSE_FEATURE_DIM + HAND_FEATURE_DIM;
        for (int pt = 0; pt < HAND_LANDMARK_COUNT; ++pt) {
            int b = rhs + pt * HAND_COORDS;
            rotateXY(fv[b + 0], fv[b + 1]);
        }

        out.push_back(std::move(fv));
    }
    return out;
}

// ─── applyTemporalWarp() — frame jittering ───────────────────────────────────
// Re-samples the sequence maintaining the same length.
// warpFactor ∈ [0, 1]: fraction of frames that may be dropped/duplicated.
// Algorithm: build a warped index list and interpolate.
Sequence DataAugmenter::applyTemporalWarp(const Sequence& seq, float warpFactor) {
    int N = static_cast<int>(seq.size());
    if (N <= 1) return seq;

    // Build warped float indices (drift around natural indices with ±warpFactor*N/2)
    std::uniform_real_distribution<float> drift(-warpFactor, warpFactor);
    float offset = drift(rng_) * N;

    Sequence out;
    out.reserve(N);

    for (int i = 0; i < N; ++i) {
        // Warped source index with clamp
        float srcF = i + offset * (static_cast<float>(i) / (N - 1));
        srcF = std::clamp(srcF, 0.f, static_cast<float>(N - 1));

        int   lo    = static_cast<int>(srcF);
        int   hi    = std::min(lo + 1, N - 1);
        float alpha = srcF - lo;

        // Linear interpolation between frames lo and hi
        const auto& fLo = seq[lo];
        const auto& fHi = seq[hi];
        FeatureVector interp(fLo.size());
        for (size_t j = 0; j < fLo.size(); ++j)
            interp[j] = fLo[j] * (1.f - alpha) + fHi[j] * alpha;

        out.push_back(std::move(interp));
    }
    return out;
}

} // namespace expresat
