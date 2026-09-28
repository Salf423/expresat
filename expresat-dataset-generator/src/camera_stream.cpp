#include "camera_stream.h"
#include <chrono>
#include <iostream>

// OpenGL (for texture upload — included only when compiling desktop target)
#include <GL/gl.h>

namespace expresat {

CameraStream::CameraStream()
    : CameraStream(Config{})
{}

CameraStream::CameraStream(Config cfg)
    : cfg_(std::move(cfg))
{}

CameraStream::~CameraStream() {
    close();
}

bool CameraStream::open() {
    if (running_.load()) return true;

    cap_.open(cfg_.deviceIndex, cv::CAP_ANY);
    if (!cap_.isOpened()) {
        std::cerr << "[CameraStream] Cannot open camera index " << cfg_.deviceIndex << "\n";
        return false;
    }
    cap_.set(cv::CAP_PROP_FRAME_WIDTH,  cfg_.captureWidth);
    cap_.set(cv::CAP_PROP_FRAME_HEIGHT, cfg_.captureHeight);
    cap_.set(cv::CAP_PROP_FPS,          cfg_.captureFPS);

    running_.store(true);
    captureThread_ = std::thread(&CameraStream::captureLoop, this);
    return true;
}

void CameraStream::close() {
    running_.store(false);
    if (captureThread_.joinable())
        captureThread_.join();
    cap_.release();
}

bool CameraStream::getLatestFrame(cv::Mat& out) {
    std::lock_guard<std::mutex> lock(frameMutex_);
    if (latestFrame_.empty()) return false;
    latestFrame_.copyTo(out);
    return true;
}

bool CameraStream::uploadToTexture(unsigned int texId) {
    cv::Mat rgb;
    {
        std::lock_guard<std::mutex> lock(frameMutex_);
        if (uploadFrame_.empty() || frameSeq_ == lastUploadSeq_)
            return false;
        uploadFrame_.copyTo(rgb);
        lastUploadSeq_ = frameSeq_;
    }

    glBindTexture(GL_TEXTURE_2D, texId);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGB,
                 rgb.cols, rgb.rows, 0,
                 GL_RGB, GL_UNSIGNED_BYTE, rgb.data);
    glBindTexture(GL_TEXTURE_2D, 0);
    return true;
}

void CameraStream::captureLoop() {
    using clock = std::chrono::steady_clock;
    cv::Mat frame;
    int frameCount = 0;
    auto fpsStart = clock::now();

    while (running_.load()) {
        if (!cap_.read(frame) || frame.empty()) {
            std::this_thread::sleep_for(std::chrono::milliseconds(5));
            continue;
        }

        // Prepare BGR copy for landmark processing + RGB copy for GL upload
        cv::Mat rgb;
        cv::cvtColor(frame, rgb, cv::COLOR_BGR2RGB);

        {
            std::lock_guard<std::mutex> lock(frameMutex_);
            latestFrame_ = frame.clone();  // BGR
            uploadFrame_ = std::move(rgb); // RGB
            ++frameSeq_;
        }

        // FPS measurement (update every second)
        ++frameCount;
        auto now = clock::now();
        float elapsed = std::chrono::duration<float>(now - fpsStart).count();
        if (elapsed >= 1.0f) {
            measuredFPS_.store(frameCount / elapsed);
            frameCount = 0;
            fpsStart   = now;
        }
    }
}

} // namespace expresat
