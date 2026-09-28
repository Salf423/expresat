cmake_minimum_required(VERSION 3.20)
project(expresat_dataset_generator CXX)

# ── C++17 ────────────────────────────────────────────────────────────────────
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# ── Build type default ────────────────────────────────────────────────────────
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release)
endif()

# ── Options ───────────────────────────────────────────────────────────────────
option(USE_MEDIAPIPE "Link against MediaPipe C++ Tasks API" OFF)
option(USE_STUB_EXTRACTOR "Use stub extractor (no MediaPipe, for GUI dev)" ON)

# ── FetchContent setup ────────────────────────────────────────────────────────
include(FetchContent)

# ── Find OpenCV (try v5 first, then v4) ───────────────────────────────────────
find_package(OpenCV 5 QUIET)
if(NOT OpenCV_FOUND)
    find_package(OpenCV 4 REQUIRED)
endif()
message(STATUS "OpenCV version: ${OpenCV_VERSION}")

# ── Find OpenGL ───────────────────────────────────────────────────────────────
find_package(OpenGL REQUIRED)

# ── GLFW via system or FetchContent ───────────────────────────────────────────
find_package(glfw3 QUIET)
if(NOT glfw3_FOUND)
    message(STATUS "GLFW not found via find_package — fetching via FetchContent")
    FetchContent_Declare(glfw
        GIT_REPOSITORY https://github.com/glfw/glfw.git
        GIT_TAG        3.4
        GIT_SHALLOW    TRUE
    )
    set(GLFW_BUILD_DOCS     OFF CACHE BOOL "" FORCE)
    set(GLFW_BUILD_TESTS    OFF CACHE BOOL "" FORCE)
    set(GLFW_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
    FetchContent_MakeAvailable(glfw)
endif()

# ── nlohmann/json ─────────────────────────────────────────────────────────────
find_package(nlohmann_json QUIET)
if(NOT nlohmann_json_FOUND)
    set(JSON_LOCAL_DIR ${CMAKE_SOURCE_DIR}/third_party/json)
    if(EXISTS ${JSON_LOCAL_DIR}/include/nlohmann/json.hpp)
        add_library(nlohmann_json INTERFACE)
        target_include_directories(nlohmann_json INTERFACE ${JSON_LOCAL_DIR}/include)
        message(STATUS "nlohmann/json: using vendored copy")
    else()
        message(STATUS "nlohmann/json not found — fetching via FetchContent")
        FetchContent_Declare(json
            URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.tar.xz
            DOWNLOAD_EXTRACT_TIMESTAMP TRUE
        )
        set(JSON_BuildTests OFF CACHE BOOL "" FORCE)
        FetchContent_MakeAvailable(json)
    endif()
endif()

# ── Dear ImGui (vendored) ─────────────────────────────────────────────────────
set(IMGUI_DIR ${CMAKE_SOURCE_DIR}/third_party/imgui)
set(IMGUI_SOURCES
    ${IMGUI_DIR}/imgui.cpp
    ${IMGUI_DIR}/imgui_draw.cpp
    ${IMGUI_DIR}/imgui_tables.cpp
    ${IMGUI_DIR}/imgui_widgets.cpp
    ${IMGUI_DIR}/backends/imgui_impl_glfw.cpp
    ${IMGUI_DIR}/backends/imgui_impl_opengl3.cpp
)
add_library(imgui STATIC ${IMGUI_SOURCES})
target_include_directories(imgui PUBLIC
    ${IMGUI_DIR}
    ${IMGUI_DIR}/backends
)
target_link_libraries(imgui PUBLIC glfw OpenGL::GL)

# ── GLAD (vendored, optional) ─────────────────────────────────────────────────
set(GLAD_DIR ${CMAKE_SOURCE_DIR}/third_party/glad)
if(EXISTS ${GLAD_DIR}/src/glad.c)
    add_library(glad STATIC ${GLAD_DIR}/src/glad.c)
    target_include_directories(glad PUBLIC ${GLAD_DIR}/include)
    set(GLAD_TARGET glad)
    message(STATUS "GLAD: using vendored copy")
else()
    set(GLAD_TARGET "")
    message(STATUS "GLAD: not found, using system OpenGL loader")
endif()

# ── Application sources ───────────────────────────────────────────────────────
set(APP_SOURCES
    src/main.cpp
    src/camera_stream.cpp
    src/mediapipe_extractor.cpp
    src/data_augmenter.cpp
    src/dataset_writer.cpp
    src/gui_manager.cpp
)

add_executable(expresat_dataset_generator ${APP_SOURCES})

target_include_directories(expresat_dataset_generator PRIVATE
    ${CMAKE_SOURCE_DIR}/src
    ${OpenCV_INCLUDE_DIRS}
)

target_link_libraries(expresat_dataset_generator PRIVATE
    imgui
    ${GLAD_TARGET}
    glfw
    OpenGL::GL
    ${OpenCV_LIBS}
    nlohmann_json
)

# ── MediaPipe (optional) ──────────────────────────────────────────────────────
if(USE_MEDIAPIPE)
    target_compile_definitions(expresat_dataset_generator PRIVATE EXPRESAT_USE_MEDIAPIPE=1)
    target_include_directories(expresat_dataset_generator PRIVATE
        $ENV{MEDIAPIPE_ROOT}
        $ENV{MEDIAPIPE_ROOT}/bazel-bin
    )
else()
    target_compile_definitions(expresat_dataset_generator PRIVATE EXPRESAT_USE_MEDIAPIPE=0)
endif()

if(USE_STUB_EXTRACTOR)
    target_compile_definitions(expresat_dataset_generator PRIVATE EXPRESAT_STUB_EXTRACTOR=1)
endif()

# ── Warnings ──────────────────────────────────────────────────────────────────
if(MSVC)
    target_compile_options(expresat_dataset_generator PRIVATE /W4)
else()
    target_compile_options(expresat_dataset_generator PRIVATE
        -Wall -Wextra -Wpedantic -Wno-unused-parameter
    )
endif()

install(TARGETS expresat_dataset_generator RUNTIME DESTINATION bin)

message(STATUS "Build type:         ${CMAKE_BUILD_TYPE}")
message(STATUS "USE_MEDIAPIPE:      ${USE_MEDIAPIPE}")
message(STATUS "USE_STUB_EXTRACTOR: ${USE_STUB_EXTRACTOR}")
