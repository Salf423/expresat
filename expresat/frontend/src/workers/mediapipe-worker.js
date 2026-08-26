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

// ─── Hand-visibility heuristic ───────────────────────────────────────────────
// Pose landmark indices that indicate a hand may be in frame:
//   13, 14 = left/right elbow  |  15, 16 = left/right wrist
// If any of these is detected (y < 1.05, visibility > 0.3) we run HandLandmarker.
const HAND_INDICATOR_INDICES = [13, 14, 15, 16];

/**
 * Returns true if the pose suggests at least one hand could be visible.
 * @param {Array<{x,y,z,visibility}>|null} poseLandmarks
 */
function handsLikelyVisible(poseLandmarks) {
    if (!poseLandmarks || poseLandmarks.length === 0) return true; // no pose → run both to be safe
    for (const idx of HAND_INDICATOR_INDICES) {
        const lm = poseLandmarks[idx];
        if (lm && (lm.visibility ?? 1) > 0.3 && lm.y < 1.05) return true;
    }
    return false;
}

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
        // 1. Always run Pose — it's the cheaper model and drives the hand heuristic.
        const poseResults = poseLandmarker.detectForVideo(imageBitmap, timestamp);
        const poseLandmarks = poseResults.landmarks[0] ?? null;

        // 2. Run HandLandmarker only when the Pose indicates hands may be visible.
        //    On slow devices this skips ~10-20 ms of GPU work per skipped frame.
        let handResults = { landmarks: [], handedness: [] };
        if (handsLikelyVisible(poseLandmarks)) {
            handResults = handLandmarker.detectForVideo(imageBitmap, timestamp);
        }

        // Free the bitmap memory immediately after inference
        imageBitmap.close();

        // ── Normalize hand landmarks into a consistent left/right structure ──
        // tasks-vision returns hands in detection order, with handedness metadata.
        // We pass both arrays raw; the EMA filter in the main thread indexes by i.
        self.postMessage({
            type: 'results',
            // Pose: array of 33 NormalizedLandmark, or empty
            pose: poseLandmarks,
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
