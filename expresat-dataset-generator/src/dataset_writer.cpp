#include "dataset_writer.h"
#include <nlohmann/json.hpp>
#include <fstream>
#include <stdexcept>
#include <iostream>

namespace expresat {

using json = nlohmann::json;
namespace fs = std::filesystem;

// ─── Constructor ──────────────────────────────────────────────────────────────
DatasetWriter::DatasetWriter(fs::path outputDir)
    : outputDir_(std::move(outputDir)) {}

// ─── write() — serialise one label to disk ───────────────────────────────────
void DatasetWriter::write(const std::string& label,
                           const std::vector<Sequence>& samples,
                           int seqLen,
                           int featDim) {
    fs::create_directories(outputDir_);

    // ── Build JSON ─────────────────────────────────────────────────────────
    json root;
    root["label"]           = label;
    root["num_samples"]     = static_cast<int>(samples.size());
    root["sequence_length"] = seqLen;
    root["feature_dim"]     = featDim;

    json dataArray = json::array();
    for (const auto& seq : samples) {
        json seqArray = json::array();
        for (const auto& frame : seq) {
            // Convert FeatureVector (std::vector<float>) directly
            seqArray.push_back(frame);
        }
        dataArray.push_back(std::move(seqArray));
    }
    root["data"] = std::move(dataArray);

    // ── Write to file ──────────────────────────────────────────────────────
    fs::path outPath = outputDir_ / (label + ".json");
    std::ofstream ofs(outPath);
    if (!ofs.is_open())
        throw std::runtime_error("DatasetWriter: cannot open " + outPath.string());

    // indent=2 for human-readability; set to -1 for compact output
    ofs << root.dump(2) << "\n";
    ofs.close();

    std::cout << "[DatasetWriter] Wrote " << samples.size()
              << " samples → " << outPath << "\n";
}

// ─── writeCombined() — merge all label JSONs into dataset.json ───────────────
void DatasetWriter::writeCombined(const fs::path& outPath) {
    json combined = json::array();

    for (const auto& entry : fs::directory_iterator(outputDir_)) {
        if (entry.path().extension() != ".json") continue;
        if (entry.path().filename() == "dataset.json") continue;

        std::ifstream ifs(entry.path());
        if (!ifs.is_open()) {
            std::cerr << "[DatasetWriter] Cannot open " << entry.path() << " — skipping\n";
            continue;
        }

        json labelData;
        try {
            ifs >> labelData;
            combined.push_back(std::move(labelData));
        } catch (const json::exception& e) {
            std::cerr << "[DatasetWriter] JSON parse error in " << entry.path()
                      << ": " << e.what() << " — skipping\n";
        }
    }

    std::ofstream ofs(outPath);
    if (!ofs.is_open())
        throw std::runtime_error("DatasetWriter: cannot open " + outPath.string());

    ofs << combined.dump(2) << "\n";
    std::cout << "[DatasetWriter] Combined dataset → " << outPath << "\n";
}

} // namespace expresat
