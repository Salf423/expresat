export class MediaPipeEngine {
    /**
     * Initializes the MediaPipe Holistic detection engine.
     * @param {HTMLVideoElement} videoElement - Source video element.
     * @param {HTMLCanvasElement} canvasElement - Canvas where results will be drawn.
     * @param {Function} onBatchReady - Callback to send detected landmarks.
     */
    constructor(videoElement, canvasElement, onBatchReady) {
        this.videoElement = videoElement;
        this.canvasElement = canvasElement;
        this.canvasCtx = canvasElement.getContext('2d');
        this.onBatchReady = onBatchReady;
        this.targetFPS = 15;
        this.frameInterval = 1000 / this.targetFPS;
        this.lastFrameTime = 0;
        this.frameCount = 0;
        this.lastFpsTime = performance.now();
        this.fpsElement = document.getElementById('fps-counter');

        // Pause state control for background tab management
        this._isPaused = false;
        this._renderLoopId = null;

        this.holistic = new window.Holistic({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${file}`
        });

        this.holistic.setOptions({
            // Lite model complexity (0) reduces CPU usage by ~30%
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
     * Starts the camera capture and visual rendering loop.
     */
    start() {
        this.camera.start();
        this.renderLoop();
    }

    /**
     * Clean up resources and event listeners on component unmount.
     */
    destroy() {
        if (this._renderLoopId) {
            cancelAnimationFrame(this._renderLoopId);
            this._renderLoopId = null;
        }
        document.removeEventListener('visibilitychange', this._handleVisibility);
    }

    /**
     * FPS counter render loop. Pauses updates when tab is hidden.
     */
    renderLoop() {
        if (!document.hidden) {
            this.frameCount++;
            const now = performance.now();
            if (now - this.lastFpsTime >= 1000) {
                if (this.fpsElement) {
                    this.fpsElement.innerText = `FPS: ${this.frameCount}`;
                }
                this.frameCount = 0;
                this.lastFpsTime = now;
            }
        }
        this._renderLoopId = window.requestAnimationFrame(() => this.renderLoop());
    }

    /**
     * Processes MediaPipe results and draws them on the canvas.
     * Decision: Connectors and keypoints (pose and hands) are drawn with specific
     * colors to provide immediate visual feedback to the user.
     * @param {Object} results - The results returned by the Holistic model.
     */
    onResults(results) {
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

        const payload = this.extractLandmarks(results);
        if (this.onBatchReady) {
            this.onBatchReady(payload);
        }
    }

    /**
     * Extracts and normalizes the coordinates of the landmarks of interest.
     * Decision: Only X, Y, Z are extracted to reduce the size of the JSON payload
     * sent via WebSocket.
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
