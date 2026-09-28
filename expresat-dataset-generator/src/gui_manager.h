#pragma once
#include "types.h"
#include "camera_stream.h"
#include "mediapipe_extractor.h"
#include "data_augmenter.h"
#include "dataset_writer.h"

#include <imgui.h>
#include <backends/imgui_impl_glfw.h>
#include <backends/imgui_impl_opengl3.h>

#include <GLFW/glfw3.h>
#include <thread>
#include <atomic>
#include <mutex>
#include <vector>
#include <string>

namespace expresat {

/**
 * GuiManager — Owns the GLFW window, Dear ImGui context, and all subsystems.
 *
 * Lifecycle:
 *   GuiManager mgr;
 *   mgr.init();       // Creates window, GL context, ImGui
 *   mgr.run();        // Blocks until window closes
 *   mgr.shutdown();   // Releases all resources
 *
 * Layout:
 *   ┌─────────────────┬──────────────────────────────┐
 *   │  Control Panel  │         Video Viewport        │
 *   │  (left ~300px)  │  (right, camera + skeleton)  │
 *   └─────────────────┴──────────────────────────────┘
 */
class GuiManager {
public:
    GuiManager();
    ~GuiManager();

    bool init(int windowWidth = 1280, int windowHeight = 720,
              const char* title = "ExpresaT — Dataset Generator");

    /// Main event + render loop. Blocks until the user closes the window.
    void run();

    void shutdown();

private:
    // ── Window & GL ────────────────────────────────────────────────────────
    GLFWwindow* window_   = nullptr;
    unsigned int camTexId_ = 0;   // GL texture for live camera feed

    // ── Subsystems ─────────────────────────────────────────────────────────
    CameraStream        camera_;
    MediapipeExtractor  extractor_;
    DataAugmenter       augmenter_;
    DatasetWriter       writer_;

    // ── GUI state ─────────────────────────────────────────────────────────
    BodyPartConfig     parts_;
    RecordingConfig    recCfg_;
    char               labelBuf_[64]  = "hola";

    // ── App state machine ──────────────────────────────────────────────────
    AppState           state_         = AppState::Idle;
    int                countdownSec_  = 3;
    float              countdownTimer_= 0.f;
    std::string        statusMsg_     = "Listo.";

    // ── Recording buffer ───────────────────────────────────────────────────
    std::vector<FeatureVector> recordBuffer_;   // captured frames
    Sequence                   baseSequence_;   // confirmed base (seqLen frames)

    // ── Generation / progress ─────────────────────────────────────────────
    std::thread          workerThread_;
    std::atomic<float>   progress_{0.f};
    std::atomic<bool>    workerDone_{false};
    std::vector<Sequence> generatedSamples_;
    std::mutex            samplesMutex_;

    // ── Latest landmarks (for skeleton overlay) ────────────────────────────
    FrameLandmarks lastLandmarks_;
    std::mutex     landmarksMutex_;

    // ── Per-frame update ──────────────────────────────────────────────────
    void onNewFrame(const cv::Mat& bgrFrame);

    // ── ImGui panels ─────────────────────────────────────────────────────
    void renderControlPanel(float dt);
    void renderVideoPanel();

    // ── State transitions ─────────────────────────────────────────────────
    void startCountdown();
    void startRecording();
    void stopRecording();
    void startGeneration();
    void saveDataset();

    // ── Worker ────────────────────────────────────────────────────────────
    void generationWorker(Sequence base, int count, RecordingConfig cfg);
};

} // namespace expresat
