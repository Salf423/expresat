#include "inference_thread.h"
#include "frame_queue.h"
#include "result_bus.h"

#include <jni.h>
#include <android/log.h>
#include <android/native_window.h>
#include <android/native_window_jni.h>

#include <atomic>
#include <memory>
#include <string>
#include <thread>

#define LOG_TAG "ExpresatNative"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO,  LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

namespace {

struct NativeState {
    expresat::FrameQueue<4>             frame_queue;
    expresat::ResultBus                 result_bus;
    std::atomic<bool>                   running{false};
    std::unique_ptr<expresat::InferenceThread> inference;
    std::thread                         inf_thread;
    ANativeWindow*                      window{nullptr};

    ~NativeState() {
        running.store(false);
        if (inf_thread.joinable()) inf_thread.join();
        if (window) ANativeWindow_release(window);
    }
};

static std::unique_ptr<NativeState> g_state;

} // namespace

extern "C" {

// Initialize inference engine
JNIEXPORT jboolean JNICALL
Java_com_expresat_native_1app_MainActivity_nativeInit(
    JNIEnv* env, jobject /*thiz*/, jstring model_path_jstr)
{
    const char* model_path_cstr = env->GetStringUTFChars(model_path_jstr, nullptr);
    std::string model_path(model_path_cstr);
    env->ReleaseStringUTFChars(model_path_jstr, model_path_cstr);

    LOGI("nativeInit: model=%s", model_path.c_str());

    g_state = std::make_unique<NativeState>();
    g_state->running.store(true);

    try {
        g_state->inference = std::make_unique<expresat::InferenceThread>(
            model_path, g_state->frame_queue, g_state->result_bus
        );

        g_state->inf_thread = std::thread([&]() {
            g_state->inference->run(g_state->running);
        });

        LOGI("nativeInit: inference engine initialized OK");
        return JNI_TRUE;

    } catch (const std::exception& e) {
        LOGE("nativeInit: ERROR: %s", e.what());
        g_state.reset();
        return JNI_FALSE;
    }
}

// Destroy engine (called in onDestroy)
JNIEXPORT void JNICALL
Java_com_expresat_native_1app_MainActivity_nativeDestroy(
    JNIEnv* /*env*/, jobject /*thiz*/)
{
    LOGI("nativeDestroy: stopping threads...");
    g_state.reset();
    LOGI("nativeDestroy: OK");
}

// Submit camera frame from Java (YUV_420_888 format)
JNIEXPORT void JNICALL
Java_com_expresat_native_1app_MainActivity_nativeSubmitFrame(
    JNIEnv* env, jobject /*thiz*/,
    jbyteArray yuv_data, jint width, jint height)
{
    if (!g_state || !g_state->running.load()) return;

    jbyte* yuv_ptr = env->GetByteArrayElements(yuv_data, nullptr);

    cv::Mat yuv_mat(height + height / 2, width, CV_8UC1,
                    reinterpret_cast<uint8_t*>(yuv_ptr));
    cv::Mat bgr_mat;
    cv::cvtColor(yuv_mat, bgr_mat, cv::COLOR_YUV2BGR_NV21);

    env->ReleaseByteArrayElements(yuv_data, yuv_ptr, JNI_ABORT);

    g_state->frame_queue.try_push(std::move(bgr_mat));
}

// Poll latest prediction result as JSON string
JNIEXPORT jstring JNICALL
Java_com_expresat_native_1app_MainActivity_nativeGetResult(
    JNIEnv* env, jobject /*thiz*/)
{
    if (!g_state) return env->NewStringUTF("{}");

    auto result = g_state->result_bus.latest();
    if (!result || !result->valid) {
        return env->NewStringUTF("{\"label\":\"\",\"confidence\":0.0}");
    }

    char buf[256];
    snprintf(buf, sizeof(buf),
             "{\"label\":\"%s\",\"confidence\":%.4f,\"fps\":%.1f}",
             result->label.c_str(),
             result->confidence,
             result->fps_inference);

    return env->NewStringUTF(buf);
}

} // extern "C"
