export class MediaPipeEngine {
    /**
     * Inicializa el motor de detección de MediaPipe Holistic.
     * @param {HTMLVideoElement} videoElement - Elemento de video fuente.
     * @param {HTMLCanvasElement} canvasElement - Canvas donde se dibujarán los resultados.
     * @param {Function} onBatchReady - Callback para enviar los landmarks detectados.
     * Decisión: Se fija el target FPS a 15 para optimizar el ancho de banda y procesamiento del backend.
     */
    constructor(videoElement, canvasElement, onBatchReady) {
        this.videoElement = videoElement;
        this.canvasElement = canvasElement;
        this.canvasCtx = canvasElement.getContext('2d');
        this.onBatchReady = onBatchReady;
        
        // Batcher logic: exactly 15 FPS
        this.targetFPS = 15;
        this.frameInterval = 1000 / this.targetFPS;
        this.lastFrameTime = 0;
        
        // FPS Counter
        this.frameCount = 0;
        this.lastFpsTime = performance.now();
        this.fpsElement = document.getElementById('fps-counter');

        this.holistic = new window.Holistic({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${file}`
        });

        this.holistic.setOptions({
            modelComplexity: 1,
            smoothLandmarks: true,
            enableSegmentation: false,
            smoothSegmentation: false,
            refineFaceLandmarks: false,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        this.holistic.onResults((results) => this.onResults(results));

        this.camera = new window.Camera(this.videoElement, {
            onFrame: async () => {
                const now = performance.now();
                // Check if we reached the frame interval
                if (now - this.lastFrameTime >= this.frameInterval) {
                    this.lastFrameTime = now;
                    await this.holistic.send({ image: this.videoElement });
                }
            },
            width: 640,
            height: 480
        });
    }

    /**
     * Inicia la captura de cámara y el bucle de renderizado visual.
     */
    start() {
        this.camera.start();
        this.renderLoop();
    }

    // Optional: We use requestAnimationFrame to clear/render standard elements independently
    /**
     * Bucle de renderizado independiente para estadísticas (FPS).
     * Decisión: Se usa requestAnimationFrame para asegurar que el contador se actualice fluidamente
     * sin importar el procesamiento de la cámara.
     */
    renderLoop() {
        // FPS Calculation
        this.frameCount++;
        const now = performance.now();
        if (now - this.lastFpsTime >= 1000) {
            if (this.fpsElement) {
                this.fpsElement.innerText = `FPS: ${this.frameCount}`;
            }
            this.frameCount = 0;
            this.lastFpsTime = now;
        }
        window.requestAnimationFrame(() => this.renderLoop());
    }

    /**
     * Procesa los resultados de MediaPipe y los dibuja en el canvas.
     * Decisión: Se dibujan conectores y puntos clave (pose y manos) con colores
     * específicos para dar feedback visual inmediato al usuario.
     * @param {Object} results - Los resultados devueltos por el modelo Holistic.
     */
    onResults(results) {
        this.canvasCtx.save();
        this.canvasCtx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
        
        // Dibujar video de fondo
        this.canvasCtx.drawImage(results.image, 0, 0, this.canvasElement.width, this.canvasElement.height);

        // Renderizar marcas y esqueleto
        if (results.poseLandmarks) {
            window.drawConnectors(this.canvasCtx, results.poseLandmarks, window.POSE_CONNECTIONS, { color: '#00f3ff', lineWidth: 4 });
            window.drawLandmarks(this.canvasCtx, results.poseLandmarks, { color: '#ffffff', lineWidth: 2 });
        }
        if (results.leftHandLandmarks) {
            window.drawConnectors(this.canvasCtx, results.leftHandLandmarks, window.HAND_CONNECTIONS, { color: '#9d4edd', lineWidth: 5 });
            window.drawLandmarks(this.canvasCtx, results.leftHandLandmarks, { color: '#ffffff', lineWidth: 2 });
        }
        if (results.rightHandLandmarks) {
            window.drawConnectors(this.canvasCtx, results.rightHandLandmarks, window.HAND_CONNECTIONS, { color: '#9d4edd', lineWidth: 5 });
            window.drawLandmarks(this.canvasCtx, results.rightHandLandmarks, { color: '#ffffff', lineWidth: 2 });
        }
        this.canvasCtx.restore();

        // Extraer landmarks y enviarlos en el Batch (15FPS controlados por el onFrame)
        const payload = this.extractLandmarks(results);
        if (this.onBatchReady) {
            this.onBatchReady(payload);
        }
    }

    /**
     * Extrae y normaliza las coordenadas de los landmarks de interés.
     * Decisión: Solo se extraen X, Y, Z para reducir el tamaño del payload JSON
     * enviado por WebSocket.
     * @param {Object} results - Resultados crudos de MediaPipe.
     * @returns {Object} Un objeto estructurado con pose, mano izquierda y mano derecha.
     */
    extractLandmarks(results) {
        // Retorna un objeto con las coordenadas normalizadas
        const extract = (landmarks) => {
            if (!landmarks) return null;
            return landmarks.map(lm => ({ x: lm.x, y: lm.y, z: lm.z }));
        };

        return {
            pose: extract(results.poseLandmarks),
            leftHand: extract(results.leftHandLandmarks),
            rightHand: extract(results.rightHandLandmarks)
        };
    }
}
