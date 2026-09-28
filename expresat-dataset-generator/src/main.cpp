#include "gui_manager.h"
#include <iostream>
#include <cstdlib>

int main(int argc, char* argv[]) {
    (void)argc; (void)argv;

    std::cout << "=== ExpresaT Dataset Generator ===\n";
    std::cout << "Feature mode: " <<
#if EXPRESAT_STUB_EXTRACTOR
        "STUB (synthetic landmarks)"
#elif EXPRESAT_USE_MEDIAPIPE
        "MediaPipe C++ Tasks API"
#else
        "UNKNOWN"
#endif
        << "\n";

    expresat::GuiManager app;

    if (!app.init(1280, 720, "ExpresaT — Dataset Generator")) {
        std::cerr << "[main] Failed to initialize application.\n";
        return EXIT_FAILURE;
    }

    app.run();
    app.shutdown();

    std::cout << "=== Bye! ===\n";
    return EXIT_SUCCESS;
}
