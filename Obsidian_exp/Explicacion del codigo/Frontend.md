## GENERAL PURPOSE

The frontend has been migrated from a legacy React web application to a **Native C++ application**. The new native frontend provides real-time video capture and directly interfaces with the local C++ inference engine, completely eliminating the need for a WebSocket backend and providing maximum performance with zero network latency.

**Architecture**: 
- **Desktop (Windows/Linux)**: C++17, Dear ImGui, GLFW3, OpenGL3
- **Android**: C++, JNI (Java Native Interface), Android NDK
- **Video Capture**: OpenCV (`cv::VideoCapture`)

---

## FILE STRUCTURE (FRONTEND COMPONENTS)

```
expresat-native/
├── desktop/                # Desktop UI target (Windows/Linux)
│   ├── main.cpp            # Main entry point, ImGui + GLFW window management
│   └── CMakeLists.txt      # Build configuration for desktop UI
├── android/                # Android mobile target
│   ├── app/build.gradle    # Gradle build configuration
│   └── app/src/main/
│       ├── cpp/android_main.cpp  # JNI bridge for inference engine
│       └── java/.../MainActivity.java # Native Android UI
```

## KEY COMPONENTS (DESKTOP)

### ImGui + GLFW Main Loop

The desktop frontend uses **Dear ImGui** to render an overlay UI on top of the webcam feed.

1. **Initialization**: GLFW initializes a window with an OpenGL context. ImGui is bound to this window.
2. **Camera Thread**: A dedicated `std::thread` uses OpenCV (`cv::VideoCapture`) to constantly poll frames from the camera. The frames are placed into a lock-free `FrameQueue`.
3. **Inference Thread**: Runs concurrently, consuming frames from the `FrameQueue`, running ONNX inference, and pushing results to the `ResultBus`.
4. **Render Loop (Main Thread)**:
   - Polls GLFW events.
   - Converts the latest OpenCV `cv::Mat` frame to an OpenGL texture (or ImGui image).
   - Reads the latest asynchronous inference result from the `ResultBus`.
   - Renders the UI overlay (FPS counters, predicted sign language class, and confidence graphs).
   - Renders the frame to the screen.

### Lock-Free Thread Communication

The UI and Inference engine communicate safely without mutex locks on the hot path:
- **`FrameQueue<N>`**: A Single-Producer Single-Consumer (SPSC) ring buffer holding camera frames. The camera thread pushes, the inference thread pops.
- **`ResultBus`**: An atomic data structure where the inference thread publishes the latest prediction and the ImGui render loop reads it for display.

## ANDROID INTEGRATION (WIP)

For Android, the UI is built using standard Android tools (Java/Kotlin), while the heavy lifting (OpenCV capture, MediaPipe extraction, ONNX inference) is delegated to C++ via **JNI (`android_main.cpp`)**. This provides the performance of native C++ while maintaining a native mobile user experience.