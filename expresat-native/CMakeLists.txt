cmake_minimum_required(VERSION 3.24)

project(expresat_native
    VERSION 1.0.0
    DESCRIPTION "Expresat - Sign Language Recognition (Native C++ Layer)"
    LANGUAGES CXX
)

# Global C++ configuration
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# Output directories
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin)
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/lib)
set(CMAKE_ARCHIVE_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/lib)

# Build options
option(BUILD_DESKTOP "Build desktop target (ImGui+GLFW+OpenGL)" ON)
option(BUILD_ANDROID "Build Android target (requires NDK)" OFF)
option(USE_VULKAN    "Use Vulkan instead of OpenGL as ImGui backend" OFF)
option(ENABLE_ASAN   "Enable AddressSanitizer (Debug only)" OFF)

# ONNX Runtime configuration
set(ONNXRUNTIME_VERSION "1.19.2" CACHE STRING "ONNX Runtime version")
set(ONNXRUNTIME_ROOT
    "${CMAKE_SOURCE_DIR}/third_party/onnxruntime"
    CACHE PATH "Path to prebuilt ONNX Runtime (headers + libs)"
)

# System dependencies
if(NOT ANDROID)
    find_package(OpenCV REQUIRED COMPONENTS core imgproc videoio)
    message(STATUS "OpenCV ${OpenCV_VERSION} found: ${OpenCV_INCLUDE_DIRS}")
endif()

# Imported ONNX Runtime target
add_library(onnxruntime SHARED IMPORTED GLOBAL)

if(WIN32)
    set(ORT_LIB_NAME "onnxruntime.dll")
    set(ORT_IMPLIB   "onnxruntime.lib")
    set_target_properties(onnxruntime PROPERTIES
        IMPORTED_LOCATION   "${ONNXRUNTIME_ROOT}/lib/${ORT_LIB_NAME}"
        IMPORTED_IMPLIB     "${ONNXRUNTIME_ROOT}/lib/${ORT_IMPLIB}"
    )
elseif(ANDROID)
    set_target_properties(onnxruntime PROPERTIES
        IMPORTED_LOCATION   "${ONNXRUNTIME_ROOT}/jni/${ANDROID_ABI}/libonnxruntime.so"
    )
else()
    set_target_properties(onnxruntime PROPERTIES
        IMPORTED_LOCATION   "${ONNXRUNTIME_ROOT}/lib/libonnxruntime.so"
    )
endif()

target_include_directories(onnxruntime INTERFACE
    "${ONNXRUNTIME_ROOT}/include"
)

# Sanitizers (Debug, Linux only)
if(ENABLE_ASAN AND CMAKE_BUILD_TYPE STREQUAL "Debug" AND NOT WIN32)
    add_compile_options(-fsanitize=address -fno-omit-frame-pointer)
    add_link_options(-fsanitize=address)
endif()

# Subprojects
add_subdirectory(core)

if(BUILD_DESKTOP AND NOT ANDROID)
    add_subdirectory(desktop)
endif()

if(BUILD_ANDROID OR ANDROID)
    add_subdirectory(android)
endif()

message(STATUS "")
message(STATUS "=== Expresat Native - Configuration ===")
message(STATUS "  C++ Standard : ${CMAKE_CXX_STANDARD}")
message(STATUS "  Build Type   : ${CMAKE_BUILD_TYPE}")
message(STATUS "  Build Desktop: ${BUILD_DESKTOP}")
message(STATUS "  Build Android: ${BUILD_ANDROID}")
message(STATUS "  ORT Root     : ${ONNXRUNTIME_ROOT}")
message(STATUS "  ORT Version  : ${ONNXRUNTIME_VERSION}")
message(STATUS "========================================")
message(STATUS "")
