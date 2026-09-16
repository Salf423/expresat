FROM ubuntu:22.04

# Prevent interactive prompts during apt-get
ENV DEBIAN_FRONTEND=noninteractive

# Update system and install required tools & libraries
RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    git \
    wget \
    tar \
    unzip \
    libopencv-dev \
    libglfw3-dev \
    libglew-dev \
    libgl1-mesa-dev \
    libglx-dev \
    libx11-dev \
    x11-apps \
    && rm -rf /var/lib/apt/lists/*

# Set up working directory
WORKDIR /app

# Copy the entire project source into the container
COPY . /app

# Download and extract ONNX Runtime (v1.19.2 for Linux x64)
RUN mkdir -p third_party/onnxruntime && \
    wget -qO- https://github.com/microsoft/onnxruntime/releases/download/v1.19.2/onnxruntime-linux-x64-1.19.2.tgz \
    | tar --strip-components=1 -xz -C third_party/onnxruntime

# Download ImGui (docking branch)
RUN rm -rf third_party/imgui && \
    git clone --depth 1 -b docking https://github.com/ocornut/imgui.git third_party/imgui

# Configure and build the project
RUN cmake -B build -S . -DBUILD_DESKTOP=ON -DBUILD_ANDROID=OFF && \
    cmake --build build -j$(nproc)

# Make sure the binary is executable
RUN chmod +x build/bin/expresat_desktop

# Add the ONNX Runtime library to the system library path
ENV LD_LIBRARY_PATH=/app/third_party/onnxruntime/lib:$LD_LIBRARY_PATH

# Define the entrypoint to run the compiled application
WORKDIR /app/build/bin
CMD ["./expresat_desktop"]
