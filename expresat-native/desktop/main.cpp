#include "frame_queue.h"
#include "result_bus.h"
#include "inference_thread.h"

#include "imgui.h"
#include "imgui_impl_glfw.h"
#include "imgui_impl_opengl3.h"

#include <opencv2/videoio.hpp>
#include <GLFW/glfw3.h>

#include <atomic>
#include <chrono>
#include <cstdio>
#include <filesystem>
#include <iostream>
#include <thread>

namespace fs = std::filesystem;
using namespace expresat;

// Shared shutdown signal
static std::atomic<bool> g_running{true};

// Shared inter-thread data structures
static FrameQueue<4> g_frame_queue;
static ResultBus     g_result_bus;

// Thread 1: Camera frame capture producer
void camera_thread_func(int camera_index) {
    cv::VideoCapture cap(camera_index);
    if (!cap.isOpened()) {
        std::cerr << "[Camera] ERROR: Could not open camera index "
                  << camera_index << "\n";
        g_running.store(false, std::memory_order_relaxed);
        return;
    }

    cap.set(cv::CAP_PROP_FRAME_WIDTH,  640);
    cap.set(cv::CAP_PROP_FRAME_HEIGHT, 480);
    cap.set(cv::CAP_PROP_FPS, 30);

    std::cout << "[Camera] Capture started: "
              << cap.get(cv::CAP_PROP_FRAME_WIDTH)  << "x"
              << cap.get(cv::CAP_PROP_FRAME_HEIGHT) << " @ "
              << cap.get(cv::CAP_PROP_FPS) << " FPS\n";

    cv::Mat frame;
    while (g_running.load(std::memory_order_relaxed)) {
        if (!cap.read(frame) || frame.empty()) continue;
        g_frame_queue.try_push(frame.clone());
    }

    cap.release();
    std::cout << "[Camera] Thread finished.\n";
}

// Thread 2: Inference pipeline consumer
void inference_thread_func(const std::string& model_path) {
    try {
        InferenceThread worker(model_path, g_frame_queue, g_result_bus);

        auto info = worker.engine_info();
        std::cout << "[Inference] Model: " << info.model_file << "\n";
        std::cout << "[Inference] ORT:   " << info.ort_version << "\n";

        worker.run(g_running);

    } catch (const std::exception& e) {
        std::cerr << "[Inference] FATAL ERROR: " << e.what() << "\n";
        g_running.store(false, std::memory_order_relaxed);
    }
    std::cout << "[Inference] Thread finished.\n";
}

static void glfw_error_callback(int error, const char* description) {
    std::fprintf(stderr, "[GLFW] Error %d: %s\n", error, description);
}

// Main thread UI rendering with ImGui
static void render_ui(const std::shared_ptr<InferenceResult>& result) {
    const ImGuiViewport* vp = ImGui::GetMainViewport();
    ImGui::SetNextWindowPos(vp->WorkPos);
    ImGui::SetNextWindowSize(vp->WorkSize);
    ImGui::SetNextWindowBgAlpha(0.92f);

    ImGuiWindowFlags main_flags =
        ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize |
        ImGuiWindowFlags_NoMove     | ImGuiWindowFlags_NoBringToFrontOnFocus;

    ImGui::Begin("##main", nullptr, main_flags);

    ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.4f, 0.9f, 0.6f, 1.0f));
    ImGui::SetWindowFontScale(1.6f);
    ImGui::Text("EXPRESAT");
    ImGui::SetWindowFontScale(1.0f);
    ImGui::PopStyleColor();
    ImGui::SameLine();
    ImGui::TextDisabled("  Sign Recognition - C++ Native Inference");
    ImGui::Separator();
    ImGui::Spacing();

    // Prediction Panel
    ImGui::BeginChild("##prediction", ImVec2(400, 0), true);
    {
        ImGui::TextDisabled("ACTIVE PREDICTION");
        ImGui::Spacing();

        if (result && result->valid && !result->label.empty()) {
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.2f, 1.0f, 0.5f, 1.0f));
            ImGui::SetWindowFontScale(2.4f);
            ImGui::Text("%s", result->label.c_str());
            ImGui::SetWindowFontScale(1.0f);
            ImGui::PopStyleColor();

            ImGui::Spacing();
            ImGui::Text("Confidence:");
            ImGui::SameLine();
            ImGui::PushStyleColor(ImGuiCol_PlotHistogram,
                ImVec4(0.2f, 0.85f, 0.4f, 1.0f));
            ImGui::ProgressBar(result->confidence, ImVec2(-1, 12),
                               nullptr);
            ImGui::PopStyleColor();
            ImGui::TextDisabled("%.1f%%", result->confidence * 100.f);

        } else if (result && result->valid) {
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.7f, 0.7f, 0.3f, 1.0f));
            ImGui::SetWindowFontScale(1.4f);
            ImGui::Text("< threshold");
            ImGui::SetWindowFontScale(1.0f);
            ImGui::PopStyleColor();
            ImGui::TextDisabled("Confidence: %.1f%%  (threshold: %.0f%%)",
                result ? result->confidence * 100.f : 0.f,
                CONFIDENCE_THRESHOLD * 100.f);
        } else {
            ImGui::TextDisabled("Waiting for pipeline...");
        }

        if (result && !result->top5.empty()) {
            ImGui::Spacing();
            ImGui::Separator();
            ImGui::TextDisabled("TOP 5");
            ImGui::Spacing();
            for (const auto& [label, prob] : result->top5) {
                ImGui::PushStyleColor(ImGuiCol_PlotHistogram,
                    ImVec4(0.3f, 0.5f, 0.8f, 0.8f));
                char label_buf[64];
                snprintf(label_buf, sizeof(label_buf),
                         "%-16s %.1f%%", label.c_str(), prob * 100.f);
                ImGui::ProgressBar(prob, ImVec2(-1, 10), label_buf);
                ImGui::PopStyleColor();
            }
        }
    }
    ImGui::EndChild();

    ImGui::SameLine();

    // Performance Metrics Panel
    ImGui::BeginChild("##metrics", ImVec2(0, 0), true);
    {
        ImGui::TextDisabled("PERFORMANCE METRICS");
        ImGui::Spacing();

        if (result && result->valid) {
            ImGui::Text("Inference FPS");
            ImGui::SameLine(160);
            ImGui::PushStyleColor(ImGuiCol_Text,
                result->fps_inference >= 25.f
                    ? ImVec4(0.2f, 1.f, 0.4f, 1.f)
                    : ImVec4(1.f, 0.6f, 0.2f, 1.f));
            ImGui::Text("%.1f FPS", result->fps_inference);
            ImGui::PopStyleColor();

            ImGui::Text("ONNX Latency");
            ImGui::SameLine(160);
            ImGui::Text("%.2f ms", result->latency_inference_ms);

            ImGui::Text("Preprocess Latency");
            ImGui::SameLine(160);
            ImGui::Text("%.2f ms", result->latency_preprocess_ms);

            ImGui::Text("Frame ID");
            ImGui::SameLine(160);
            ImGui::TextDisabled("#%llu", (unsigned long long)result->frame_id);

            ImGui::Text("Frame Queue");
            ImGui::SameLine(160);
            ImGui::TextDisabled("%zu / 4", g_frame_queue.size_approx());

        } else {
            ImGui::TextDisabled("No data yet...");
        }

        ImGui::Spacing();
        ImGui::Separator();
        ImGui::Spacing();

        ImGui::TextDisabled("SYSTEM STATUS");
        ImGui::Spacing();
        auto running_color = g_running.load()
            ? ImVec4(0.2f, 1.f, 0.4f, 1.f)
            : ImVec4(1.f, 0.3f, 0.3f, 1.f);
        ImGui::PushStyleColor(ImGuiCol_Text, running_color);
        ImGui::Bullet(); ImGui::Text("Camera Thread");
        ImGui::Bullet(); ImGui::Text("Inference Thread");
        ImGui::PopStyleColor();

        ImGui::Spacing();
        ImGui::Separator();
        ImGui::Spacing();

        static float ui_threshold = CONFIDENCE_THRESHOLD;
        ImGui::Text("Confidence Threshold");
        ImGui::SliderFloat("##thr", &ui_threshold, 0.1f, 0.99f, "%.2f");

        ImGui::Spacing();
        ImGui::PushStyleColor(ImGuiCol_Button,
                               ImVec4(0.8f, 0.2f, 0.2f, 0.8f));
        if (ImGui::Button("Stop", ImVec2(-1, 32))) {
            g_running.store(false, std::memory_order_relaxed);
        }
        ImGui::PopStyleColor();
    }
    ImGui::EndChild();

    ImGui::End();
}

int main(int argc, char** argv) {
    const std::string model_path = (argc > 1)
        ? argv[1]
        : "models/exported_model/expresat_gru_float32.onnx";
    const int camera_index = (argc > 2) ? std::atoi(argv[2]) : 0;

    if (!fs::exists(model_path)) {
        std::cerr << "[Main] ERROR: Model file not found: " << model_path << "\n";
        std::cerr << "Usage: expresat_desktop [model_path.onnx] [camera_index]\n";
        return 1;
    }

    std::cout << "[Main] Expresat Native Desktop\n";
    std::cout << "[Main] Model:  " << model_path << "\n";
    std::cout << "[Main] Camera: " << camera_index << "\n";

    glfwSetErrorCallback(glfw_error_callback);
    if (!glfwInit()) {
        std::cerr << "[Main] ERROR: glfwInit() failed\n";
        return 1;
    }

    glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 3);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 3);
    glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);
#ifdef __APPLE__
    glfwWindowHint(GLFW_OPENGL_FORWARD_COMPAT, GL_TRUE);
#endif

    GLFWwindow* window = glfwCreateWindow(
        1280, 720, "Expresat - Native Sign Recognition", nullptr, nullptr);
    if (!window) {
        std::cerr << "[Main] ERROR: glfwCreateWindow() failed\n";
        glfwTerminate();
        return 1;
    }

    glfwMakeContextCurrent(window);
    glfwSwapInterval(1);

    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    io.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;
    io.IniFilename = nullptr;

    ImGui::StyleColorsDark();
    ImGuiStyle& style = ImGui::GetStyle();
    style.WindowRounding    = 6.0f;
    style.FrameRounding     = 4.0f;
    style.ItemSpacing       = {8.f, 6.f};
    style.ScrollbarRounding = 4.0f;
    style.Colors[ImGuiCol_WindowBg]  = ImVec4(0.08f, 0.09f, 0.10f, 0.95f);
    style.Colors[ImGuiCol_ChildBg]   = ImVec4(0.10f, 0.11f, 0.13f, 0.90f);
    style.Colors[ImGuiCol_FrameBg]   = ImVec4(0.14f, 0.16f, 0.19f, 1.00f);
    style.Colors[ImGuiCol_TitleBg]   = ImVec4(0.05f, 0.05f, 0.07f, 1.00f);

    ImGui_ImplGlfw_InitForOpenGL(window, true);
    ImGui_ImplOpenGL3_Init("#version 330");

    std::thread cam_thread(camera_thread_func, camera_index);
    std::thread inf_thread(inference_thread_func, model_path);

    std::cout << "[Main] Worker threads started. Entering render loop...\n";

    while (!glfwWindowShouldClose(window) &&
           g_running.load(std::memory_order_relaxed)) {

        glfwPollEvents();
        auto result = g_result_bus.latest();

        ImGui_ImplOpenGL3_NewFrame();
        ImGui_ImplGlfw_NewFrame();
        ImGui::NewFrame();

        render_ui(result);

        ImGui::Render();
        int display_w, display_h;
        glfwGetFramebufferSize(window, &display_w, &display_h);
        glViewport(0, 0, display_w, display_h);
        glClearColor(0.06f, 0.07f, 0.08f, 1.00f);
        glClear(GL_COLOR_BUFFER_BIT);
        ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());
        glfwSwapBuffers(window);
    }

    std::cout << "[Main] Shutdown signal sent. Joining threads...\n";
    g_running.store(false, std::memory_order_relaxed);

    if (cam_thread.joinable()) cam_thread.join();
    if (inf_thread.joinable()) inf_thread.join();

    ImGui_ImplOpenGL3_Shutdown();
    ImGui_ImplGlfw_Shutdown();
    ImGui::DestroyContext();
    glfwDestroyWindow(window);
    glfwTerminate();

    std::cout << "[Main] Expresat shutdown complete.\n";
    return 0;
}
