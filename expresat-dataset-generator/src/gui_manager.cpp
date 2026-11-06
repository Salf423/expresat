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
#include <fstream>
#include <sstream>
#include <cstdio>

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

        // ── Memory monitoring update ──────────────────────────────────────
        memTimer_ += dt;
        if (memTimer_ >= 0.5f) {
            memTimer_ = 0.f;
            updateMemoryStats();
        }

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

        // ── Check training done ───────────────────────────────────────────
        if (trainDone_.load()) {
            trainDone_.store(false);
            if (trainThread_.joinable()) trainThread_.join();
            isTraining_.store(false);
        }
    }
}

// ─── shutdown() ───────────────────────────────────────────────────────────────
void GuiManager::shutdown() {
    if (workerThread_.joinable()) workerThread_.join();
    if (trainThread_.joinable()) trainThread_.join();
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

    // ── Memory Usage Monitor ──────────────────────────────────────────────
    ImGui::Separator();
    ImGui::TextColored(ImVec4(0.4f, 0.8f, 1.f, 1.f), "Uso de Memoria:");
    ImGui::Text("Proceso RSS : %.1f MB", memStats_.procRssMB);
    ImGui::Text("Sistema RAM : %.0f / %.0f MB", memStats_.sysUsedMB, memStats_.sysTotalMB);

    char memOverlay[32];
    snprintf(memOverlay, sizeof(memOverlay), "%.1f%% RAM", memStats_.sysPercent);
    float ramRatio = static_cast<float>(memStats_.sysPercent / 100.0);
    ramRatio = std::clamp(ramRatio, 0.0f, 1.0f);
    ImVec4 ramBarColor = ImVec4(0.2f, 0.7f, 0.2f, 1.0f);
    if (ramRatio > 0.85f) ramBarColor = ImVec4(0.9f, 0.2f, 0.2f, 1.0f);
    else if (ramRatio > 0.70f) ramBarColor = ImVec4(0.9f, 0.7f, 0.1f, 1.0f);

    ImGui::PushStyleColor(ImGuiCol_PlotHistogram, ramBarColor);
    ImGui::ProgressBar(ramRatio, ImVec2(-1, 14), memOverlay);
    ImGui::PopStyleColor();

    // ── Training Script Trigger ───────────────────────────────────────────
    ImGui::Separator();
    ImGui::TextColored(ImVec4(1.0f, 0.75f, 0.2f, 1.0f), "Entrenamiento del Modelo:");

    bool trainingActive = isTraining_.load();
    if (trainingActive) {
        ImGui::BeginDisabled();
        ImGui::Button("Entrenando Modelo...", ImVec2(-1, 32));
        ImGui::EndDisabled();
    } else {
        if (ImGui::Button("Ejecutar Entrenamiento PyTorch", ImVec2(-1, 32))) {
            startTraining();
        }
    }

    {
        std::lock_guard<std::mutex> lock(trainMutex_);
        ImGui::TextWrapped("Estado: %s", trainStatus_.c_str());
    }

    ImGui::EndChild();
}

// ─── renderVideoPanel() ───────────────────────────────────────────────────────
void GuiManager::renderVideoPanel() {
    ImGui::BeginChild("##video_panel", ImVec2(0, 0), false);

    ImVec2 avail = ImGui::GetContentRegionAvail();

    // Reserve comfortable height for the logs console at the bottom
    float logPanelHeight = std::clamp(avail.y * 0.32f, 150.0f, 240.0f);
    float availVideoH = avail.y - logPanelHeight - 16.0f;
    if (availVideoH < 180.0f) availVideoH = 180.0f;

    // Maintain 4:3 aspect ratio for video preview
    float texH = availVideoH;
    float texW = texH * (640.f / 480.f);
    if (texW > avail.x) {
        texW = avail.x;
        texH = texW * (480.f / 640.f);
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
        ImGui::SetCursorPosX(padX > 0 ? ImGui::GetCursorPosX() + padX + 10 : 10);
        ImGui::TextColored(ImVec4(1, 0.2f, 0.2f, 1.f), "● REC");
    }

    // ── Training Logs Panel (debajo de la cámara para máxima legibilidad) ──
    ImGui::Spacing();
    ImGui::Separator();

    ImGui::TextColored(ImVec4(0.4f, 0.8f, 1.f, 1.f), "Consola de Entrenamiento PyTorch (Logs):");
    ImGui::SameLine();
    {
        std::lock_guard<std::mutex> lock(trainMutex_);
        if (isTraining_.load()) {
            ImGui::TextColored(ImVec4(1.0f, 0.8f, 0.2f, 1.0f), "● En ejecución...");
        } else {
            ImGui::TextDisabled("| %s", trainStatus_.c_str());
        }
    }

    float clearBtnW = 105.0f;
    if (avail.x > clearBtnW + 20.0f) {
        ImGui::SameLine(avail.x - clearBtnW);
        if (ImGui::SmallButton("Limpiar Logs")) {
            std::lock_guard<std::mutex> lock(trainMutex_);
            trainLogs_.clear();
        }
    }

    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.08f, 0.09f, 0.11f, 1.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(8, 6));

    if (ImGui::BeginChild("##train_logs_wide", ImVec2(0, 0), true, ImGuiWindowFlags_HorizontalScrollbar)) {
        std::lock_guard<std::mutex> lock(trainMutex_);
        if (trainLogs_.empty()) {
            ImGui::TextDisabled("No hay logs disponibles. Haz clic en 'Ejecutar Entrenamiento PyTorch' para comenzar.");
        } else {
            for (const auto& logLine : trainLogs_) {
                if (logLine.find("[ERROR]") != std::string::npos || logLine.find("Traceback") != std::string::npos || logLine.find("Error") != std::string::npos) {
                    ImGui::TextColored(ImVec4(1.0f, 0.35f, 0.35f, 1.0f), "%s", logLine.c_str());
                } else if (logLine.find("[SUCCESS]") != std::string::npos || logLine.find("CUMPLE") != std::string::npos || logLine.find("✓") != std::string::npos) {
                    ImGui::TextColored(ImVec4(0.35f, 1.0f, 0.45f, 1.0f), "%s", logLine.c_str());
                } else if (logLine.find("[INFO]") != std::string::npos || logLine.find("[EXEC]") != std::string::npos) {
                    ImGui::TextColored(ImVec4(0.4f, 0.8f, 1.0f, 1.0f), "%s", logLine.c_str());
                } else if (logLine.find("Época") != std::string::npos) {
                    ImGui::TextColored(ImVec4(1.0f, 0.85f, 0.3f, 1.0f), "%s", logLine.c_str());
                } else {
                    ImGui::TextUnformatted(logLine.c_str());
                }
            }
            if (ImGui::GetScrollY() >= ImGui::GetScrollMaxY() - 20.0f) {
                ImGui::SetScrollHereY(1.0f);
            }
        }
    }
    ImGui::EndChild();
    ImGui::PopStyleVar();
    ImGui::PopStyleColor();

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
        // En ExpresaT el vector canónico es siempre TOTAL_FEATURES (178D: 52 upper pose + 63 mano izq + 63 mano der)
        int featDim = TOTAL_FEATURES;

        auto samples = augmenter_.generate(base, count, featDim);

        {
            std::lock_guard<std::mutex> lock(samplesMutex_);
            generatedSamples_ = std::move(samples);
        }

        // Write to disk
        writer_.write(cfg.label, generatedSamples_, cfg.sequenceLen, featDim);
        writer_.writeCombined();

        {
            std::lock_guard<std::mutex> lock(landmarksMutex_);
            statusMsg_ = "Guardado: ./dataset/" + cfg.label + ".json";
        }
    } catch (const std::exception& e) {
        std::lock_guard<std::mutex> lock(landmarksMutex_);
        state_     = AppState::Error;
        statusMsg_ = std::string("Error: ") + e.what();
    }

    workerDone_.store(true);
}

// ─── updateMemoryStats() ──────────────────────────────────────────────────────
void GuiManager::updateMemoryStats() {
    // 1. System Memory from /proc/meminfo
    std::ifstream meminfo("/proc/meminfo");
    if (meminfo.is_open()) {
        std::string key;
        long long value;
        std::string unit;
        long long memTotal = 0, memAvail = 0;
        while (meminfo >> key >> value >> unit) {
            if (key == "MemTotal:") memTotal = value;
            else if (key == "MemAvailable:") memAvail = value;
        }
        if (memTotal > 0) {
            memStats_.sysTotalMB = memTotal / 1024.0;
            memStats_.sysUsedMB = (memTotal - memAvail) / 1024.0;
            memStats_.sysPercent = (memStats_.sysUsedMB / memStats_.sysTotalMB) * 100.0;
        }
    }

    // 2. Process Resident Set Size (RSS) from /proc/self/statm
    std::ifstream statm("/proc/self/statm");
    if (statm.is_open()) {
        long long size = 0, resident = 0;
        if (statm >> size >> resident) {
            memStats_.procRssMB = (resident * 4096.0) / (1024.0 * 1024.0);
        }
    }
}

// ─── startTraining() & trainingWorker() ──────────────────────────────────────
void GuiManager::startTraining() {
    if (isTraining_.load()) return;

    if (trainThread_.joinable()) {
        trainThread_.join();
    }

    isTraining_.store(true);
    trainDone_.store(false);

    {
        std::lock_guard<std::mutex> lock(trainMutex_);
        trainStatus_ = "Iniciando proceso de entrenamiento...";
        trainLogs_.clear();
        trainLogs_.push_back("[INFO] Lanzando script de entrenamiento PyTorch...");
    }

    trainThread_ = std::thread(&GuiManager::trainingWorker, this);
}

void GuiManager::trainingWorker() {
    // Check available Python venvs and training script
    const std::vector<std::string> pythonCandidates = {
        "/home/adrian/Proyectos/expresat/expresat/models/venv/bin/python",
        "/home/adrian/Proyectos/expresat/expresat/venv/bin/python",
        "/home/adrian/Proyectos/expresat/venv/bin/python",
        "python3"
    };

    std::string pythonBin = "python3";
    for (const auto& candidate : pythonCandidates) {
        std::ifstream testFile(candidate);
        if (testFile.good()) {
            pythonBin = candidate;
            break;
        }
    }

    std::string trainScript = "/home/adrian/Proyectos/expresat/expresat/models/train_and_export.py";
    std::string dataDir     = "/home/adrian/Proyectos/expresat/expresat-dataset-generator/dataset";
    std::string outputDir   = "/home/adrian/Proyectos/expresat/expresat/models/exported_model";
    // -u para desactivar el buffer de stdout y recibir logs en tiempo real vía popen
    std::string cmd = pythonBin + " -u " + trainScript + " --epochs 30 --data-dir " + dataDir + " --output " + outputDir + " 2>&1";

    {
        std::lock_guard<std::mutex> lock(trainMutex_);
        trainStatus_ = "Entrenando modelo (" + pythonBin + ")...";
        trainLogs_.push_back("[EXEC] " + cmd);
    }

    FILE* pipe = popen(cmd.c_str(), "r");
    if (!pipe) {
        std::lock_guard<std::mutex> lock(trainMutex_);
        trainStatus_ = "Error al ejecutar el comando de entrenamiento.";
        trainLogs_.push_back("[ERROR] No se pudo abrir pipe para ejecutar el proceso.");
        trainDone_.store(true);
        return;
    }

    char buffer[512];
    while (fgets(buffer, sizeof(buffer), pipe) != nullptr) {
        std::string line(buffer);
        // Trim newline
        while (!line.empty() && (line.back() == '\n' || line.back() == '\r')) {
            line.pop_back();
        }
        std::lock_guard<std::mutex> lock(trainMutex_);
        trainLogs_.push_back(line);
        if (trainLogs_.size() > 200) {
            trainLogs_.erase(trainLogs_.begin());
        }
    }

    int exitCode = pclose(pipe);
    {
        std::lock_guard<std::mutex> lock(trainMutex_);
        if (exitCode == 0) {
            trainStatus_ = "Entrenamiento completado exitosamente (exit 0).";
            trainLogs_.push_back("[SUCCESS] Modelo entrenado y exportado a ONNX/INT8.");
        } else {
            trainStatus_ = "Entrenamiento finalizado con error (código " + std::to_string(exitCode) + ").";
            trainLogs_.push_back("[ERROR] Código de salida: " + std::to_string(exitCode));
        }
    }

    trainDone_.store(true);
}

} // namespace expresat
