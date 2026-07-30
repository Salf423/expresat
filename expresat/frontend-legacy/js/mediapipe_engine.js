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
     * Starts the camera capture and visual rendering loop.
     */
    start() {
        this.camera.start();
        this.renderLoop();
    }

    // Optional: We use requestAnimationFrame to clear/render standard elements independently
    /**
     * Independent rendering loop for statistics (FPS).
     * Decision: requestAnimationFrame is used to ensure the counter updates smoothly
     * regardless of camera processing.
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
        // Returns an object with normalized coordinates
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
