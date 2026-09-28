---
title: "Dataset Generator C++: Arquitectura y Compilación"
description: "Sistema de compilación CMake 3.20+, C++17, dependencias vendored/FetchContent y scripts de automatización de compilación."
version: "2.0.0"
category: "Código / Dataset Generator"
target_agents: ["cpp-pro", "devops-troubleshooter"]
recommended_skills:
  - "[[../../Skills/Backend_APIs_y_Sistemas|Backend_APIs_y_Sistemas]] (`cpp-pro`, `c-pro`)"
  - "[[../../Skills/DevOps_CI_CD_y_Despliegue|DevOps_CI_CD_y_Despliegue]] (`github-actions-templates`)"
related_docs:
  - "[[../../00_INDICE_MAESTRO]]"
  - "[[Cpp_Generator]]"
  - "[[02_Extraccion_y_Normalizacion]]"
---

# Fase 1: Arquitectura del Proyecto y Configuración de Compilación

> **Navegación:** [[../../00_INDICE_MAESTRO|🏠 Índice Maestro]] > [[Cpp_Generator|🛠️ Dataset Generator]] > **Fase 1: Arquitectura y Compilación**

## Estructura de Directorios

La herramienta está organizada de forma modular para permitir que cada componente pueda compilarse, probarse y depurarse de manera aislada:

```text
expresat-dataset-generator/
├── CMakeLists.txt              # Script de construcción principal de CMake
├── README.md                   # Documentación rápida de usuario
├── .gitignore                  # Reglas de exclusión para builds y binarios
├── scripts/
│   ├── setup_third_party.sh   # Script bash para clonar/descargar dependencias
│   └── build.sh               # Script de compilación parametrizado (debug/release/mediapipe)
├── src/
│   ├── main.cpp                # Punto de entrada de la aplicación
│   ├── types.h                 # Constantes de layout, estructuras y máquina de estados
│   ├── camera_stream.h/.cpp    # Captura asíncrona de cámara y subida a textura OpenGL
│   ├── mediapipe_extractor.h/.cpp # Extracción de landmarks, normalización y skeleton
│   ├── data_augmenter.h/.cpp   # Motor de aumentación sintética estocástica
│   ├── dataset_writer.h/.cpp   # Serialización JSON individual y agregada
│   └── gui_manager.h/.cpp      # Ventana GLFW, Dear ImGui y loop de render
├── third_party/                # Dependencias embebidas (vendored)
│   ├── imgui/                  # Dear ImGui (v1.91.1) + Backends GLFW/OpenGL3
│   ├── glad/                   # Cargador OpenGL 3.3 Core (opcional)
│   └── json/                   # nlohmann/json single-header (v3.11.3)
└── dataset/                    # Salida de archivos JSON generados (*.json)
```

---

## Configuración de CMake (`CMakeLists.txt`)

El archivo `CMakeLists.txt` implementa un diseño robusto y adaptable a diversas distribuciones Linux (incluyendo Arch Linux con OpenCV 5 y Ubuntu/Debian con OpenCV 4).

### 1. Detección Inteligente de OpenCV (v5 / v4)

En distribuciones como Arch Linux, los paquetes de OpenCV se entregan en su versión 5 (`OpenCV 5.0.0`), mientras que en otras ramas se utiliza `OpenCV 4.x`. El script intenta localizar primero la versión 5 y, si no está presente, recurre a la versión 4:

```cmake
find_package(OpenCV 5 QUIET)
if(NOT OpenCV_FOUND)
    find_package(OpenCV 4 REQUIRED)
endif()
message(STATUS "OpenCV version: ${OpenCV_VERSION}")
```

### 2. Gestión de GLFW y nlohmann/json vía `FetchContent`

Para evitar que el usuario deba instalar dependencias manualmente mediante `sudo pacman` o `sudo apt`, CMake incorpora `FetchContent`: si `find_package(glfw3)` o `find_package(nlohmann_json)` fallan a nivel de sistema, CMake clona automáticamente el repositorio oficial de GLFW (v3.4) y descarga el single-header de `nlohmann/json` durante la etapa de configuración:

```cmake
include(FetchContent)

find_package(glfw3 QUIET)
if(NOT glfw3_FOUND)
    message(STATUS "GLFW not found — fetching via FetchContent")
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
```

### 3. Integración de Dear ImGui

Dear ImGui se compila como una biblioteca estática (`imgui`) a partir de su código fuente en `third_party/imgui`, incluyendo los dos backends requeridos:
- `imgui_impl_glfw.cpp`: Manejo de ventanas, ratón, teclado y redimensionamiento.
- `imgui_impl_opengl3.cpp`: Renderizado acelerado por hardware mediante shaders GLSL `#version 330`.

```cmake
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
target_include_directories(imgui PUBLIC ${IMGUI_DIR} ${IMGUI_DIR}/backends)
target_link_libraries(imgui PUBLIC glfw OpenGL::GL)
```

---

## Modos de Compilación y Opciones

El proyecto expone dos variables condicionales clave:

| Bandera CMake | Valor por Defecto | Efecto |
|---|---|---|
| `-DUSE_STUB_EXTRACTOR` | `ON` | Activa un extractor sintético senoidal en C++ que genera landmarks continuos y realistas sin requerir las dependencias masivas de MediaPipe en C++. Ideal para desarrollo y recolección rápida. |
| `-DUSE_MEDIAPIPE` | `OFF` | Activa el enlace con las bibliotecas C++ de MediaPipe Tasks API (`libpose_landmarker_graph.a`), requiriendo que la variable de entorno `MEDIAPIPE_ROOT` esté configurada. |

---

## Scripts de Automatización

### 1. `scripts/setup_third_party.sh`
Se encarga de clonar Dear ImGui v1.91.1 en `third_party/imgui` y descargar el encabezado de `nlohmann/json`:

```bash
bash scripts/setup_third_party.sh
```

### 2. `scripts/build.sh`
Permite compilar en un solo comando según el perfil deseado:

```bash
# Modo desarrollo con stub extractor y símbolos de depuración
bash scripts/build.sh debug

# Modo producción optimizado (-O3, Release)
bash scripts/build.sh release

# Modo integrado con MediaPipe C++ Tasks API
export MEDIAPIPE_ROOT=/opt/mediapipe
bash scripts/build.sh mediapipe
```

---

## Compatibilidad Estricta con Compiladores Modernos (GCC 16)

Durante la implementación en sistemas modernos con GCC 16 (GCC 16.2.1), se resolvió una incompatibilidad técnica con listas de inicialización vacías en constructores con parámetros por defecto (`Config cfg = {}`).

**Problema:** En C++17/C++20, si un struct tiene inicializadores de miembros por defecto pero no define un constructor explícito, el compilador puede rechazar la conversión por lista vacía (`{}`) en parámetros por defecto de clases envolventes.

**Solución aplicada:**
1. Se declaró explícitamente `Config() = default;` en todos los structs de configuración (`types.h`, `camera_stream.h`, `mediapipe_extractor.h`, `data_augmenter.h`).
2. Se sobrecargaron los constructores por defecto delegados:
   ```cpp
   CameraStream::CameraStream() : CameraStream(Config{}) {}
   CameraStream::CameraStream(Config cfg) : cfg_(std::move(cfg)) {}
   ```
Esto garantiza portabilidad completa y compilación limpia con `-Wall -Wextra -Wpedantic` sin advertencias.
