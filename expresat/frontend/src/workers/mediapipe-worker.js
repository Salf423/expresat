/**
 * mediapipe-worker.js — Off-Main-Thread MediaPipe Inference
 *
 * Runs entirely inside a Web Worker. The main thread sends raw ImageBitmap
 * frames (zero-copy via Transferable), and this worker responds with
 * structured landmark data.
 *
 * Protocol:
 *   Main → Worker:
 *     { type: 'init' }
 *     { type: 'process', imageBitmap: ImageBitmap, timestamp: number }
 *     { type: 'destroy' }
 *
 *   Worker → Main:
 *     { type: 'ready' }
 *     { type: 'results', pose, hands, handedness, timestamp }
 *     { type: 'error', message: string }
 */

import {
    HandLandmarker,
    PoseLandmarker,
    FilesetResolver,
} from '@mediapipe/tasks-vision';

// ─── Model URLs (CDN — no bundle overhead) ───────────────────────────────────
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm';

const HAND_MODEL_URL =
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const POSE_MODEL_URL =
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

// ─── State ────────────────────────────────────────────────────────────────────
let handLandmarker = null;
let poseLandmarker = null;
let initialized = false;
let initPromise = null;

// ─── Initialization ───────────────────────────────────────────────────────────
async function initialize() {
    if (initPromise) return initPromise;

    initPromise = (async () => {
        try {
            const vision = await FilesetResolver.forVisionTasks(WASM_URL);

            // Both models created in parallel to halve load time
            [handLandmarker, poseLandmarker] = await Promise.all([
                HandLandmarker.createFromOptions(vision, {
                    baseOptions: {
                        modelAssetPath: HAND_MODEL_URL,
                        // GPU delegate → auto-fallback to CPU on unsupported devices
                        delegate: 'GPU',
                    },
                    runningMode: 'VIDEO',
                    numHands: 2,
                    minHandDetectionConfidence: 0.5,
                    minHandPresenceConfidence: 0.5,
                    minTrackingConfidence: 0.5,
                }),
                PoseLandmarker.createFromOptions(vision, {
                    baseOptions: {
                        modelAssetPath: POSE_MODEL_URL,
                        delegate: 'GPU',
                    },
                    runningMode: 'VIDEO',
                    numPoses: 1,
                    minPoseDetectionConfidence: 0.5,
                    minPosePresenceConfidence: 0.5,
                    minTrackingConfidence: 0.5,
                }),
            ]);

            initialized = true;
            self.postMessage({ type: 'ready' });
        } catch (err) {
            self.postMessage({ type: 'error', message: `Worker init failed: ${err.message}` });
            throw err;
        }
    })();

    return initPromise;
}

// ─── Frame processing ─────────────────────────────────────────────────────────
function processFrame(imageBitmap, timestamp) {
    if (!initialized) return;

    try {
        // Both models run on the same ImageBitmap — VIDEO mode requires
        // monotonically increasing timestamps in milliseconds.
        const handResults = handLandmarker.detectForVideo(imageBitmap, timestamp);
        const poseResults = poseLandmarker.detectForVideo(imageBitmap, timestamp);

        // Free the bitmap memory immediately after inference
        imageBitmap.close();

        // ── Normalize hand landmarks into a consistent left/right structure ──
        // tasks-vision returns hands in detection order, with handedness metadata.
        // We pass both arrays raw; the EMA filter in the main thread indexes by i.
        self.postMessage({
            type: 'results',
            // Pose: array of 33 NormalizedLandmark, or empty
            pose: poseResults.landmarks[0] ?? null,
            // Hands: array of arrays (up to 2), each 21 NormalizedLandmark
            hands: handResults.landmarks,
            // Handedness: [{ categoryName: 'Left'|'Right', score }]
            handedness: handResults.handedness,
            timestamp,
        });

    } catch (err) {
        // Don't crash the worker on a single bad frame
        imageBitmap.close();
        self.postMessage({ type: 'error', message: `Frame processing error: ${err.message}` });
    }
}

// ─── Message handler ──────────────────────────────────────────────────────────
self.onmessage = async (event) => {
    const { type, imageBitmap, timestamp } = event.data;

    switch (type) {
        case 'init':
            await initialize();
            break;

        case 'process':
            if (!initialized) {
                // Models not ready yet — discard this frame silently
                imageBitmap?.close();
                return;
            }
            processFrame(imageBitmap, timestamp);
            break;

        case 'destroy':
            handLandmarker?.close();
            poseLandmarker?.close();
            initialized = false;
            break;

        default:
            self.postMessage({ type: 'error', message: `Unknown message type: ${type}` });
    }
};

// Start initializing immediately on worker load
initialize();
