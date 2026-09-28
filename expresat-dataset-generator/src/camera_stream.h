#pragma once
#include <opencv2/opencv.hpp>
#include <atomic>
#include <thread>
#include <mutex>
#include <functional>
#include <cstdint>

namespace expresat {

/**
 * CameraStream — Background OpenCV capture with OpenGL texture upload.
 *
 * Runs capture on a dedicated thread to avoid blocking the render loop.
 * The main thread calls getTexture() / getLatestFrame() at will.
 */
class CameraStream {
public:
    struct Config {
        Config() = default;
        int deviceIndex  = 0;
        int captureWidth = 640;
        int captureHeight = 480;
        int captureFPS   = 15;
    };

    CameraStream();
    explicit CameraStream(Config cfg);
    ~CameraStream();

    // Non-copyable
    CameraStream(const CameraStream&) = delete;
    CameraStream& operator=(const CameraStream&) = delete;

    bool open();   ///< Start capture thread. Returns false if camera unavailable.
    void close();  ///< Stop capture thread and release device.

    bool isOpen() const { return running_.load(); }
    int  width()  const { return cfg_.captureWidth;  }
    int  height() const { return cfg_.captureHeight; }

    /**
     * Copy the latest captured frame (BGR). Thread-safe.
     * Returns false if no frame is available yet.
     */
    bool getLatestFrame(cv::Mat& out);

    /**
     * Upload the latest frame to an OpenGL texture.
     * Must be called from the OpenGL thread.
     * @param texId  OpenGL texture name (created externally, e.g. glGenTextures)
     * @return true if a new frame was uploaded, false if same frame as before.
     */
    bool uploadToTexture(unsigned int texId);

    /// Frames per second calculated from capture loop
    float measuredFPS() const { return measuredFPS_.load(); }

private:
    Config cfg_;
    cv::VideoCapture cap_;

    std::thread       captureThread_;
    std::atomic<bool> running_{false};

    mutable std::mutex frameMutex_;
    cv::Mat latestFrame_;      // BGR, latest captured
    cv::Mat uploadFrame_;      // RGB, ready for GL upload
    uint64_t frameSeq_ = 0;   // monotonically increasing
    uint64_t lastUploadSeq_ = UINT64_MAX;

    std::atomic<float> measuredFPS_{0.f};

    void captureLoop();
};

} // namespace expresat
