#pragma once
#include "types.h"
#include <string>
#include <filesystem>
#include <stdexcept>

namespace expresat {

/**
 * DatasetWriter — Serialises augmented sequences to JSON.
 *
 * Output format (one file per label, compatible with train_and_export.py):
 *
 *   ./dataset/<label>.json
 *   {
 *     "label":           "hola",
 *     "num_samples":     500,
 *     "sequence_length": 15,
 *     "feature_dim":     178,
 *     "data": [
 *       [ [f0,f1,...,f177], ...(15 frames) ],  // sample 0
 *       ...
 *     ]
 *   }
 *
 * The writer is intentionally single-threaded and writes synchronously
 * (called from a worker thread started by the GUI after generation).
 */
class DatasetWriter {
public:
    explicit DatasetWriter(std::filesystem::path outputDir = "./dataset");

    /**
     * Write all generated sequences for one label to disk.
     * Creates `outputDir` if it does not exist.
     * Overwrites any existing file for the same label.
     *
     * @param label     Sign name (used as filename stem)
     * @param samples   Vector of sequences  (N × seqLen × featureDim)
     * @param seqLen    Frames per sequence
     * @param featDim   Features per frame
     * @throws std::runtime_error on I/O failure
     */
    void write(
        const std::string&        label,
        const std::vector<Sequence>& samples,
        int seqLen,
        int featDim
    );

    /**
     * Append / merge all individual label files into one combined dataset.json.
     * Useful for the GitHub Actions training script.
     */
    void writeCombined(const std::filesystem::path& outPath = "./dataset/dataset.json");

    std::filesystem::path outputDir() const { return outputDir_; }

private:
    std::filesystem::path outputDir_;
};

} // namespace expresat
