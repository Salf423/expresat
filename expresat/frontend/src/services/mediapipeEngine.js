export class MediaPipeEngine {
    /**
     * Initializes the MediaPipe Holistic detection engine.
     * @param {HTMLVideoElement} videoElement - Source video element.
     * @param {HTMLCanvasElement} canvasElement - Canvas where results will be drawn.
     * @param {Function} onBatchReady - Callback invoked (throttled) to send detected landmarks.
     * @param {Function} [onFps] - Optional. Called once per second with the real FPS count.
     */
    constructor(videoElement, canvasElement, onBatchReady, onFps = null) {
        this.videoElement = videoElement;
        this.canvasElement = canvasElement;
        this.canvasCtx = canvasElement.getContext('2d');
        this.onBatchReady = onBatchReady;
        this.onFps = onFps;

        // Detection rate: how often MediaPipe processes a frame (15 FPS cap)
        this.targetFPS = 15;
        this.frameInterval = 1000 / this.targetFPS;
        this.lastFrameTime = 0;

        // Landmark send rate: throttle WebSocket payloads to 2 per second (500 ms)
        this.sendInterval = 500;
        this.lastSendTime = 0;

        // FPS tracking — counts actual MediaPipe result callbacks, not rAF ticks
        this._fpsFrameCount = 0;
        this._fpsLastTime = performance.now();

        // Pause state control for background tab management
        this._isPaused = false;

        this.holistic = new window.Holistic({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${file}`
        });

        this.holistic.setOptions({
            // Lite model (0) reduces CPU usage ~30-60% vs full model
            modelComplexity: 0,
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
                // Skip frame processing when tab is hidden or paused
                if (this._isPaused || document.hidden) return;

                const now = performance.now();
                if (now - this.lastFrameTime >= this.frameInterval) {
                    this.lastFrameTime = now;
                    await this.holistic.send({ image: this.videoElement });
                }
            },
            width: 640,
            height: 480
        });

        // Automatically pause/resume based on tab visibility
        this._handleVisibility = () => {
            this._isPaused = document.hidden;
        };
        document.addEventListener('visibilitychange', this._handleVisibility);
    }

    /**
     * Starts the camera capture. No separate render loop needed —
     * all drawing happens inside the onResults callback, driven by MediaPipe.
     */
    start() {
        this.camera.start();
    }

    /**
     * Clean up resources and event listeners on component unmount.
     */
    destroy() {
        document.removeEventListener('visibilitychange', this._handleVisibility);
    }

    /**
     * Processes MediaPipe results:
     *  1. Draws video frame + skeleton overlays on canvas (~15/sec).
     *  2. Updates FPS counter once per second via onFps callback.
     *  3. Throttles landmark payloads to the backend (max 2/sec).
     *
     * @param {Object} results - The results returned by the Holistic model.
     */
    onResults(results) {
        // --- 1. Draw on canvas (every processed frame, up to 15/sec) ---
        this.canvasCtx.save();
        this.canvasCtx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
        this.canvasCtx.drawImage(results.image, 0, 0, this.canvasElement.width, this.canvasElement.height);

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

        // --- 2. FPS tracking: count real MediaPipe results per second ---
        this._fpsFrameCount++;
        const now = performance.now();
        if (now - this._fpsLastTime >= 1000) {
            if (this.onFps) this.onFps(this._fpsFrameCount);
            this._fpsFrameCount = 0;
            this._fpsLastTime = now;
        }

        // --- 3. Throttled landmark send: max 2 payloads per second ---
        if (now - this.lastSendTime >= this.sendInterval) {
            this.lastSendTime = now;
            const payload = this.extractLandmarks(results);
            if (this.onBatchReady) {
                this.onBatchReady(payload);
            }
        }
    }

    /**
     * Extracts and normalizes the coordinates of the landmarks of interest.
     * Only X, Y, Z are extracted to reduce the size of the JSON payload sent via WebSocket.
     * @param {Object} results - Raw MediaPipe results.
     * @returns {Object} A structured object with pose, left hand, and right hand.
     */
    extractLandmarks(results) {
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
