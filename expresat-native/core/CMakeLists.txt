cmake_minimum_required(VERSION 3.24)

# core - Shared static library for all targets

add_library(expresat_core STATIC
    src/inference_thread.cpp
)

target_include_directories(expresat_core
    PUBLIC  ${CMAKE_CURRENT_SOURCE_DIR}/include
            ${OpenCV_INCLUDE_DIRS}
)

find_package(Threads REQUIRED)

target_link_libraries(expresat_core
    PUBLIC
        ${OpenCV_LIBS}
        onnxruntime
        Threads::Threads
)

# Optimization flags per build configuration
target_compile_options(expresat_core PRIVATE
    $<$<CXX_COMPILER_ID:GNU,Clang>:
        $<$<CONFIG:Release>:-O3 -march=native -DNDEBUG>
        $<$<CONFIG:Debug>:-O0 -g -Wall -Wextra -Wpedantic>
    >
    $<$<CXX_COMPILER_ID:MSVC>:
        $<$<CONFIG:Release>:/O2 /DNDEBUG>
        $<$<CONFIG:Debug>:/Od /W4>
    >
)

# std::filesystem linkage for GCC < 9
if(CMAKE_CXX_COMPILER_ID STREQUAL "GNU" AND CMAKE_CXX_COMPILER_VERSION VERSION_LESS "9.0")
    target_link_libraries(expresat_core PRIVATE stdc++fs)
endif()
