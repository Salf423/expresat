#pragma once
#include <array>
#include <atomic>
#include <opencv2/core/mat.hpp>

namespace expresat {

// Lock-free SPSC (Single-Producer Single-Consumer) ring buffer for camera frames.
// Drops frames when full to prioritize low latency over completeness.
template <std::size_t Capacity = 4>
class FrameQueue {
    static_assert(Capacity >= 2, "Capacity must be at least 2");

public:
    FrameQueue() = default;
    FrameQueue(const FrameQueue&) = delete;
    FrameQueue& operator=(const FrameQueue&) = delete;

    // Called from Camera Thread (PRODUCER). Returns false if full.
    bool try_push(cv::Mat frame) noexcept {
        const std::size_t w    = write_.load(std::memory_order_relaxed);
        const std::size_t next = advance(w);
        if (next == read_.load(std::memory_order_acquire)) {
            return false; // Queue full - drop frame
        }
        buffer_[w] = std::move(frame);
        write_.store(next, std::memory_order_release);
        return true;
    }

    // Called from Inference Thread (CONSUMER). Returns false if empty.
    bool try_pop(cv::Mat& out) noexcept {
        const std::size_t r = read_.load(std::memory_order_relaxed);
        if (r == write_.load(std::memory_order_acquire)) {
            return false; // Queue empty
        }
        out = std::move(buffer_[r]);
        read_.store(advance(r), std::memory_order_release);
        return true;
    }

    std::size_t size_approx() const noexcept {
        const std::size_t w = write_.load(std::memory_order_relaxed);
        const std::size_t r = read_.load(std::memory_order_relaxed);
        return (w >= r) ? (w - r) : (Capacity - r + w);
    }

    bool empty() const noexcept {
        return read_.load(std::memory_order_relaxed) ==
               write_.load(std::memory_order_relaxed);
    }

private:
    static constexpr std::size_t advance(std::size_t i) noexcept {
        return (i + 1) % Capacity;
    }

    // Cacheline alignment to prevent false sharing
    alignas(64) std::array<cv::Mat, Capacity> buffer_{};
    alignas(64) std::atomic<std::size_t> write_{0};
    alignas(64) std::atomic<std::size_t> read_{0};
};

} // namespace expresat
