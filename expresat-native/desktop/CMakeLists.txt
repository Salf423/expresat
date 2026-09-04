cmake_minimum_required(VERSION 3.24)

# desktop - Executable target for Windows and Linux

set(IMGUI_DIR "${CMAKE_SOURCE_DIR}/third_party/imgui")

set(IMGUI_SOURCES
    ${IMGUI_DIR}/imgui.cpp
    ${IMGUI_DIR}/imgui_draw.cpp
    ${IMGUI_DIR}/imgui_tables.cpp
    ${IMGUI_DIR}/imgui_widgets.cpp
    ${IMGUI_DIR}/backends/imgui_impl_glfw.cpp
    ${IMGUI_DIR}/backends/imgui_impl_opengl3.cpp
)

if(NOT EXISTS "${IMGUI_DIR}/imgui.h")
    message(FATAL_ERROR
        "ImGui not found at ${IMGUI_DIR}.\n"
        "Run: git submodule update --init --recursive"
    )
endif()

find_package(glfw3 3.3 REQUIRED)
find_package(OpenGL REQUIRED)

add_executable(expresat_desktop
    main.cpp
    ${IMGUI_SOURCES}
)

target_include_directories(expresat_desktop PRIVATE
    ${IMGUI_DIR}
    ${IMGUI_DIR}/backends
)

target_link_libraries(expresat_desktop PRIVATE
    expresat_core
    glfw
    OpenGL::GL
)

if(UNIX AND NOT APPLE)
    target_link_libraries(expresat_desktop PRIVATE dl)
endif()

# Copy models directory to output directory
set(MODEL_SRC "${CMAKE_SOURCE_DIR}/models")
if(EXISTS "${MODEL_SRC}")
    add_custom_command(TARGET expresat_desktop POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_directory
            "${MODEL_SRC}"
            "$<TARGET_FILE_DIR:expresat_desktop>/models"
        COMMENT "Copying models to output directory..."
    )
endif()

# Copy ONNX Runtime DLL on Windows
if(WIN32)
    add_custom_command(TARGET expresat_desktop POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "${ONNXRUNTIME_ROOT}/lib/onnxruntime.dll"
            "$<TARGET_FILE_DIR:expresat_desktop>"
        COMMENT "Copying onnxruntime.dll to output directory..."
    )
endif()

target_compile_options(expresat_desktop PRIVATE
    $<$<CXX_COMPILER_ID:GNU,Clang>:
        $<$<CONFIG:Release>:-O3 -march=native -DNDEBUG>
        $<$<CONFIG:Debug>:-O0 -g>
    >
    $<$<CXX_COMPILER_ID:MSVC>:
        $<$<CONFIG:Release>:/O2 /GL /DNDEBUG>
        $<$<CONFIG:Debug>:/Od>
    >
)

message(STATUS "[Desktop] Target expresat_desktop configured.")
