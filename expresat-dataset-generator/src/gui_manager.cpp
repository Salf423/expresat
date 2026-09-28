#include "gui_manager.h"
#include <imgui.h>
#include <backends/imgui_impl_glfw.h>
#include <backends/imgui_impl_opengl3.h>
#include <GL/gl.h>

#include <opencv2/opencv.hpp>
#include <iostream>
#include <cstring>
#include <chrono>
#include <algorithm>

namespace expresat {

// ─── Constructor / Destructor ─────────────────────────────────────────────────
GuiManager::GuiManager()
    : camera_()
    , extractor_()
    , augmenter_()
    , writer_("./dataset")
{}

GuiManager::~GuiManager() {
    shutdown();
}

// ─── init() ───────────────────────────────────────────────────────────────────
bool GuiManager::init(int w, int h, const char* title) {
    // ── GLFW ─────────────────────────────────────────────────────────────
    glfwSetErrorCallback([](int err, const char* desc) {
        std::cerr << "[GLFW] Error " << err << ": " << desc << "\n";
    });
    if (!glfwInit()) {
        std::cerr << "[GuiManager] glfwInit failed\n";
        return false;
    }

    // OpenGL 3.3 Core
    glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 3);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 3);
    glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);
#ifdef __APPLE__
    glfwWindowHint(GLFW_OPENGL_FORWARD_COMPAT, GL_TRUE);
#endif

    window_ = glfwCreateWindow(w, h, title, nullptr, nullptr);
    if (!window_) {
        std::cerr << "[GuiManager] glfwCreateWindow failed\n";
        glfwTerminate();
        return false;
    }
    glfwMakeContextCurrent(window_);
    glfwSwapInterval(1); // vsync

    // ── ImGui ─────────────────────────────────────────────────────────────
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    io.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;

    ImGui::StyleColorsDark();
    ImGui_ImplGlfw_InitForOpenGL(window_, true);
    ImGui_ImplOpenGL3_Init("#version 330");

    // ── GL texture for camera feed ────────────────────────────────────────
    glGenTextures(1, &camTexId_);
    glBindTexture(GL_TEXTURE_2D, camTexId_);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    // Allocate a default black texture
    {
        int dw = 640, dh = 480;
        std::vector<uint8_t> black(dw * dh * 3, 0);
        glTexImage2D(GL_TEXTURE_2D, 0, GL_RGB, dw, dh, 0, GL_RGB, GL_UNSIGNED_BYTE, black.data());
    }
    glBindTexture(GL_TEXTURE_2D, 0);

    // ── Camera & extractor ────────────────────────────────────────────────
    camera_.open();
    extractor_.open();

    std::strncpy(labelBuf_, recCfg_.label.c_str(), sizeof(labelBuf_) - 1);
    return true;
}

// ─── run() — main loop ───────────────────────────────────────────────────────
void GuiManager::run() {
    using clock = std::chrono::steady_clock;
    auto prev   = clock::now();

    while (!glfwWindowShouldClose(window_)) {
        glfwPollEvents();

        auto now = clock::now();
        float dt = std::chrono::duration<float>(now - prev).count();
        prev = now;

        // ── Capture + process frame ───────────────────────────────────────
        cv::Mat bgrFrame;
        if (camera_.getLatestFrame(bgrFrame) && !bgrFrame.empty()) {
            onNewFrame(bgrFrame);
        }

        // ── Upload to GL texture (with skeleton overlay) ──────────────────
        if (!bgrFrame.empty()) {
            cv::Mat display;
            {
                std::lock_guard<std::mutex> lock(landmarksMutex_);
                display = bgrFrame.clone();
                MediapipeExtractor::drawSkeleton(display, lastLandmarks_, parts_);
            }
            cv::Mat rgb;
            cv::cvtColor(display, rgb, cv::COLOR_BGR2RGB);
            glBindTexture(GL_TEXTURE_2D, camTexId_);
            glTexImage2D(GL_TEXTURE_2D, 0, GL_RGB,
                         rgb.cols, rgb.rows, 0,
                         GL_RGB, GL_UNSIGNED_BYTE, rgb.data);
            glBindTexture(GL_TEXTURE_2D, 0);
        }

        // ── Begin ImGui frame ─────────────────────────────────────────────
        ImGui_ImplOpenGL3_NewFrame();
        ImGui_ImplGlfw_NewFrame();
        ImGui::NewFrame();

        // Full-screen dockspace
        ImGui::SetNextWindowPos({0, 0});
        int dispW, dispH;
        glfwGetFramebufferSize(window_, &dispW, &dispH);
        ImGui::SetNextWindowSize({(float)dispW, (float)dispH});
        ImGui::SetNextWindowBgAlpha(0.f);
        ImGui::Begin("##root", nullptr,
                     ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize |
                     ImGuiWindowFlags_NoMove    | ImGuiWindowFlags_NoBringToFrontOnFocus |
                     ImGuiWindowFlags_NoScrollbar);

        renderControlPanel(dt);
        ImGui::SameLine();
        renderVideoPanel();

        ImGui::End();

        // ── Render ────────────────────────────────────────────────────────
        ImGui::Render();
        glViewport(0, 0, dispW, dispH);
        glClearColor(0.1f, 0.1f, 0.1f, 1.f);
        glClear(GL_COLOR_BUFFER_BIT);
        ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());
        glfwSwapBuffers(window_);

        // ── Check worker done ─────────────────────────────────────────────
        if (workerDone_.load()) {
            workerDone_.store(false);
            if (workerThread_.joinable()) workerThread_.join();
            if (state_ == AppState::Processing) {
                state_     = AppState::Done;
                statusMsg_ = "Generación completa. Listo para guardar.";
            }
        }
    }
}

// ─── shutdown() ───────────────────────────────────────────────────────────────
void GuiManager::shutdown() {
    if (workerThread_.joinable()) workerThread_.join();
    camera_.close();
    extractor_.close();

    if (window_) {
        if (camTexId_) { glDeleteTextures(1, &camTexId_); camTexId_ = 0; }
        ImGui_ImplOpenGL3_Shutdown();
        ImGui_ImplGlfw_Shutdown();
        ImGui::DestroyContext();
        glfwDestroyWindow(window_);
        glfwTerminate();
        window_ = nullptr;
    }
}

// ─── onNewFrame() — per-frame landmark extraction + recording ─────────────────
void GuiManager::onNewFrame(const cv::Mat& bgrFrame) {
    FrameLandmarks lm = extractor_.process(bgrFrame);

    {
        std::lock_guard<std::mutex> lock(landmarksMutex_);
        lastLandmarks_ = lm;
    }

    // If recording: buffer feature vectors
    if (state_ == AppState::Recording) {
        FeatureVector fv = MediapipeExtractor::extract(lm, parts_);
        recordBuffer_.push_back(fv);

        if ((int)recordBuffer_.size() >= recCfg_.sequenceLen) {
            stopRecording();
        }
    }
}

// ─── renderControlPanel() ─────────────────────────────────────────────────────
void GuiManager::renderControlPanel(float dt) {
    ImGui::BeginChild("##control", ImVec2(310, 0), true);

    // Title
    ImGui::TextColored(ImVec4(0.4f, 0.8f, 1.f, 1.f), "ExpresaT Dataset Generator");
    ImGui::Separator();

    // ── Body parts ────────────────────────────────────────────────────────
    ImGui::Text("Partes del Cuerpo:");
    ImGui::Checkbox("Upper Pose (52D)",  &parts_.upperPose);
    ImGui::Checkbox("Left Hand  (63D)",  &parts_.leftHand);
    ImGui::Checkbox("Right Hand (63D)",  &parts_.rightHand);
    ImGui::Checkbox("Face / Extra",       &parts_.faceExtra);
    ImGui::Checkbox("Mostrar Skeleton",   &parts_.showSkeleton);

    // Total features preview
    int featDim = (parts_.upperPose ? POSE_FEATURE_DIM : 0)
                + (parts_.leftHand  ? HAND_FEATURE_DIM : 0)
                + (parts_.rightHand ? HAND_FEATURE_DIM : 0);
    ImGui::TextDisabled("Features por frame: %d", featDim);

    ImGui::Separator();

    // ── Recording config ──────────────────────────────────────────────────
    ImGui::Text("Configuración:");
    if (ImGui::InputText("Etiqueta", labelBuf_, sizeof(labelBuf_)))
        recCfg_.label = labelBuf_;
    ImGui::InputInt("Muestras Sintéticas", &recCfg_.syntheticN);
    ImGui::InputInt("Frames por Secuencia", &recCfg_.sequenceLen);
    recCfg_.syntheticN  = std::max(1,  recCfg_.syntheticN);
    recCfg_.sequenceLen = std::max(5,  recCfg_.sequenceLen);

    ImGui::Separator();

    // ── State machine: countdown timer ────────────────────────────────────
    if (state_ == AppState::CountingDown) {
        countdownTimer_ -= dt;
        if (countdownTimer_ <= 0.f) {
            --countdownSec_;
            countdownTimer_ = 1.f;
            if (countdownSec_ <= 0) startRecording();
            else statusMsg_ = "Grabando en: " + std::to_string(countdownSec_);
        }
    }

    // ── Buttons ───────────────────────────────────────────────────────────
    bool busy = (state_ == AppState::CountingDown
              || state_ == AppState::Recording
              || state_ == AppState::Processing);

    if (busy) ImGui::BeginDisabled();

    if (ImGui::Button("Grabar Muestra Base", ImVec2(-1, 36))) {
        startCountdown();
    }

    if (state_ == AppState::Done) {
        if (ImGui::Button("Generar y Guardar Dataset", ImVec2(-1, 36)))
            startGeneration();
    } else if (state_ == AppState::Idle || state_ == AppState::Error) {
        if (ImGui::Button("Generar y Guardar Dataset", ImVec2(-1, 36)))
            ImGui::OpenPopup("sin_base_popup");
    }

    if (busy) ImGui::EndDisabled();

    // Popup: no base sample yet
    if (ImGui::BeginPopup("sin_base_popup")) {
        ImGui::TextColored(ImVec4(1,0.5f,0,1), "Graba primero una muestra base.");
        ImGui::EndPopup();
    }

    // ── Status ────────────────────────────────────────────────────────────
    ImGui::Separator();
    ImGui::Text("Estado:");

    // Status color based on state
    ImVec4 stateColor = ImVec4(0.7f, 0.7f, 0.7f, 1.f);
    if (state_ == AppState::Recording)    stateColor = ImVec4(1, 0.3f, 0.3f, 1.f);
    if (state_ == AppState::CountingDown) stateColor = ImVec4(1, 0.8f, 0.0f, 1.f);
    if (state_ == AppState::Processing)   stateColor = ImVec4(0.3f, 0.8f, 1.f, 1.f);
    if (state_ == AppState::Done)         stateColor = ImVec4(0.3f, 1.f, 0.3f, 1.f);
    if (state_ == AppState::Error)        stateColor = ImVec4(1.f, 0.2f, 0.2f, 1.f);

    ImGui::TextColored(stateColor, "%s", statusMsg_.c_str());

    // Recording progress
    if (state_ == AppState::Recording) {
        float p = (float)recordBuffer_.size() / (float)recCfg_.sequenceLen;
        ImGui::ProgressBar(p, ImVec2(-1, 12), "");
        ImGui::TextDisabled("%d / %d frames", (int)recordBuffer_.size(), recCfg_.sequenceLen);
    }

    // Synthetic generation progress
    if (state_ == AppState::Processing) {
        float p = progress_.load();
        char overlay[32];
        snprintf(overlay, sizeof(overlay), "%.0f%%", p * 100.f);
        ImGui::ProgressBar(p, ImVec2(-1, 20), overlay);
    }

    // Base sequence captured info
    if (!baseSequence_.empty()) {
        ImGui::Separator();
        ImGui::TextColored(ImVec4(0.5f, 1.f, 0.5f, 1.f),
                           "Base: %d frames capturados", (int)baseSequence_.size());
    }

    // FPS
    ImGui::Separator();
    ImGui::TextDisabled("Cam FPS: %.1f", camera_.measuredFPS());

    ImGui::EndChild();
}

// ─── renderVideoPanel() ───────────────────────────────────────────────────────
void GuiManager::renderVideoPanel() {
    ImGui::BeginChild("##video", ImVec2(0, 0), false);

    ImVec2 avail = ImGui::GetContentRegionAvail();
    // Maintain 4:3 aspect
    float texW = avail.x;
    float texH = texW * (480.f / 640.f);
    if (texH > avail.y) {
        texH = avail.y;
        texW = texH * (640.f / 480.f);
    }

    // Center horizontally
    float padX = (avail.x - texW) * 0.5f;
    if (padX > 0) ImGui::SetCursorPosX(ImGui::GetCursorPosX() + padX);

    ImGui::Image(
        (ImTextureID)(uintptr_t)camTexId_,
        ImVec2(texW, texH),
        ImVec2(0, 0), ImVec2(1, 1)  // UV: normal orientation
    );

    // Countdown overlay
    if (state_ == AppState::CountingDown && countdownSec_ > 0) {
        ImDrawList* dl = ImGui::GetWindowDrawList();
        ImVec2 pos     = ImGui::GetItemRectMin();
        ImVec2 sz      = ImGui::GetItemRectSize();
        ImVec2 center  = {pos.x + sz.x * 0.5f, pos.y + sz.y * 0.5f};
        char buf[8];
        snprintf(buf, sizeof(buf), "%d", countdownSec_);
        ImVec2 ts = ImGui::CalcTextSize(buf);
        dl->AddText(ImGui::GetFont(), 96.f,
                    {center.x - ts.x * 3, center.y - ts.y * 3},
                    IM_COL32(255, 220, 0, 220), buf);
    }

    // Recording indicator
    if (state_ == AppState::Recording) {
        ImGui::TextColored(ImVec4(1, 0.2f, 0.2f, 1.f), "● REC");
    }

    ImGui::EndChild();
}

// ─── State transitions ────────────────────────────────────────────────────────
void GuiManager::startCountdown() {
    recordBuffer_.clear();
    countdownSec_   = 3;
    countdownTimer_ = 1.f;
    state_          = AppState::CountingDown;
    statusMsg_      = "Grabando en: 3";
}

void GuiManager::startRecording() {
    recordBuffer_.clear();
    state_     = AppState::Recording;
    statusMsg_ = "Grabando... (" + std::to_string(recCfg_.sequenceLen) + " frames)";
}

void GuiManager::stopRecording() {
    // Trim to exact sequenceLen
    if ((int)recordBuffer_.size() > recCfg_.sequenceLen)
        recordBuffer_.resize(recCfg_.sequenceLen);

    baseSequence_ = recordBuffer_;
    recordBuffer_.clear();
    state_     = AppState::Done;
    statusMsg_ = "Muestra base capturada. Listo para generar.";
}

void GuiManager::startGeneration() {
    if (baseSequence_.empty()) return;

    state_     = AppState::Processing;
    statusMsg_ = "Generando datos sintéticos...";
    progress_.store(0.f);
    workerDone_.store(false);

    // Copy state for worker thread
    Sequence base     = baseSequence_;
    int      count    = recCfg_.syntheticN;
    RecordingConfig cfg = recCfg_;
    cfg.label = labelBuf_;

    // Configure progress callback
    DataAugmenter::Config augCfg;
    augCfg.onProgress = [this, count](int done, int total) {
        progress_.store((float)done / (float)total);
        (void)count; (void)total;
    };
    augmenter_ = DataAugmenter(augCfg);

    workerThread_ = std::thread(&GuiManager::generationWorker, this,
                                std::move(base), count, cfg);
}

// ─── generationWorker() — runs in std::thread ────────────────────────────────
void GuiManager::generationWorker(Sequence base, int count, RecordingConfig cfg) {
    try {
        int featDim = (parts_.upperPose ? POSE_FEATURE_DIM : 0)
                    + (parts_.leftHand  ? HAND_FEATURE_DIM : 0)
                    + (parts_.rightHand ? HAND_FEATURE_DIM : 0);

        auto samples = augmenter_.generate(base, count, featDim);

        {
            std::lock_guard<std::mutex> lock(samplesMutex_);
            generatedSamples_ = std::move(samples);
        }

        // Write to disk
        writer_.write(cfg.label, generatedSamples_, cfg.sequenceLen, featDim);
        writer_.writeCombined();

        statusMsg_ = "Guardado: ./dataset/" + cfg.label + ".json";
    } catch (const std::exception& e) {
        state_     = AppState::Error;
        statusMsg_ = std::string("Error: ") + e.what();
    }

    workerDone_.store(true);
}

} // namespace expresat
