/**
 * useMediaPipe.js — Custom Hook: Off-Main-Thread MediaPipe + EMA Filter
 *
 * Responsibilities:
 *  1. Manages the Web Worker lifecycle (create / destroy on mount / unmount).
 *  2. Captures camera frames efficiently with requestVideoFrameCallback.
 *  3. Transfers frames to the Worker as ImageBitmap (zero-copy).
 *  4. Receives raw landmarks from the Worker and applies EMA smoothing.
 *  5. Draws the smoothed skeleton on the canvas (Main Thread, 2D API).
 *  6. Throttles WebSocket payload sends to 2 per second.
 *  7. Exposes real FPS count to the component.
 *
 * Usage:
 *   const { fps } = useMediaPipe(videoRef, canvasRef, onLandmarks, onFps);
 */

import { useEffect, useRef } from 'react';
import { LandmarkEMAFilter } from '../services/landmarkFilter';

// ─── Drawing constants ────────────────────────────────────────────────────────

// Pose connections (MediaPipe 33-point model, relevant upper body)
const POSE_CONNECTIONS = [
    [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], // arms
    [11, 23], [12, 24], [23, 24],                      // torso
    [15, 17], [15, 19], [15, 21],                       // left wrist
    [16, 18], [16, 20], [16, 22],                       // right wrist
];

// Hand connections (MediaPipe 21-point hand model)
const HAND_CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,4],         // thumb
    [0,5],[5,6],[6,7],[7,8],         // index
    [0,9],[9,10],[10,11],[11,12],    // middle
    [0,13],[13,14],[14,15],[15,16],  // ring
    [0,17],[17,18],[18,19],[19,20],  // pinky
    [5,9],[9,13],[13,17],            // palm
];

// ─── Drawing helpers ──────────────────────────────────────────────────────────

/**
 * Projects a normalized landmark to canvas pixel coordinates.
 */
function project(lm, w, h) {
    return { px: lm.x * w, py: lm.y * h };
}

/**
 * Draws connectors between landmark pairs on the canvas.
 */
function drawConnectors(ctx, landmarks, connections, color, lineWidth, w, h) {
    if (!landmarks || landmarks.length === 0) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    for (const [a, b] of connections) {
        if (!landmarks[a] || !landmarks[b]) continue;
        const pa = project(landmarks[a], w, h);
        const pb = project(landmarks[b], w, h);
        ctx.moveTo(pa.px, pa.py);
        ctx.lineTo(pb.px, pb.py);
    }
    ctx.stroke();
}

/**
 * Draws landmark dots.
 */
function drawLandmarks(ctx, landmarks, color, radius, w, h) {
    if (!landmarks || landmarks.length === 0) return;
    ctx.fillStyle = color;
    for (const lm of landmarks) {
        const { px, py } = project(lm, w, h);
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fill();
    }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * @param {React.RefObject<HTMLVideoElement>} videoRef
 * @param {React.RefObject<HTMLCanvasElement>} canvasRef
 * @param {(payload: {pose, leftHand, rightHand}) => void} onLandmarks
 *   Called (throttled, 2/sec) with landmark data ready to send via WebSocket.
 * @param {(fps: number) => void} [onFps]
 *   Called once per second with the current real processing FPS.
 * @param {object} [options]
 * @param {number} [options.alpha=0.45]      EMA smoothing factor
 * @param {number} [options.targetFPS=15]    Max frames to send to Worker
 * @param {number} [options.sendInterval=500] WebSocket throttle in ms (2/sec)
 */
export function useMediaPipe(videoRef, canvasRef, onLandmarks, onFps, options = {}) {
    const {
        alpha = 0.45,
        targetFPS = 15,
        sendInterval = 500,
    } = options;

    // Stable refs — these never trigger re-renders
    const workerRef      = useRef(null);
    const filterRef      = useRef(null);
    const streamRef      = useRef(null);
    const rafIdRef       = useRef(null);

    // Timing refs
    const lastFrameRef   = useRef(0);
    const lastSendRef    = useRef(0);
    const frameInterval  = 1000 / targetFPS;

    // FPS tracking
    const fpsCountRef    = useRef(0);
    const fpsTimeRef     = useRef(performance.now());

    // Latest smoothed results — written by Worker message handler,
    // read by the draw loop. No useState → zero re-renders from here.
    const resultsRef     = useRef(null);
    const onLandmarksRef = useRef(onLandmarks);
    const onFpsRef       = useRef(onFps);

    // Keep callback refs fresh without re-running the effect
    useEffect(() => { onLandmarksRef.current = onLandmarks; }, [onLandmarks]);
    useEffect(() => { onFpsRef.current = onFps; }, [onFps]);

    useEffect(() => {
        const video  = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas) return;

        const ctx = canvas.getContext('2d');
        filterRef.current = new LandmarkEMAFilter(alpha);

        // ── 1. Create Worker ──────────────────────────────────────────────────
        const worker = new Worker(
            new URL('../workers/mediapipe-worker.js', import.meta.url),
            { type: 'module' }
        );
        workerRef.current = worker;

        // ── 2. Handle Worker messages ─────────────────────────────────────────
        worker.onmessage = (event) => {
            const { type } = event.data;

            if (type === 'ready') {
                console.log('[useMediaPipe] Worker ready — starting camera');
                startCamera();
                return;
            }

            if (type === 'results') {
                const { pose, hands, handedness, timestamp } = event.data;

                // Apply EMA filter to smooth out jitter
                const smoothed = filterRef.current.smoothResults({ pose, hands, handedness });
                resultsRef.current = smoothed;

                // FPS tracking (counts result callbacks per second)
                fpsCountRef.current++;
                const now = performance.now();
                if (now - fpsTimeRef.current >= 1000) {
                    onFpsRef.current?.(fpsCountRef.current);
                    fpsCountRef.current = 0;
                    fpsTimeRef.current = now;
                }

                // Throttled WebSocket send (max 2/sec)
                if (now - lastSendRef.current >= sendInterval) {
                    lastSendRef.current = now;
                    onLandmarksRef.current?.(buildPayload(smoothed));
                }

                void timestamp; // used for Worker-side monotonic checks
            }

            if (type === 'error') {
                console.warn('[useMediaPipe] Worker error:', event.data.message);
            }
        };

        worker.onerror = (e) => {
            console.error('[useMediaPipe] Worker uncaught error:', e);
        };

        // Worker starts initializing immediately on load (see worker file).
        // 'ready' message will trigger startCamera().

        // ── 3. Camera capture loop ────────────────────────────────────────────
        function captureFrame(now, _meta) {
            if (document.hidden) {
                // Reschedule — visibility listener will re-enable when visible
                rafIdRef.current = video.requestVideoFrameCallback(captureFrame);
                return;
            }

            // Throttle to targetFPS
            if (now - lastFrameRef.current >= frameInterval) {
                lastFrameRef.current = now;

                // createImageBitmap is async but extremely fast for video frames.
                // We don't await it to avoid blocking the rVFC callback.
                createImageBitmap(video).then((bitmap) => {
                    worker.postMessage(
                        { type: 'process', imageBitmap: bitmap, timestamp: now },
                        [bitmap] // Transfer ownership — zero-copy
                    );
                }).catch(() => {/* frame skipped if video not ready */});
            }

            // Schedule next capture
            rafIdRef.current = video.requestVideoFrameCallback(captureFrame);
        }

        // ── 4. Draw loop (runs every rAF tick, reads resultsRef) ─────────────
        // Decoupled from inference: canvas updates at display refresh rate
        // while inference runs at targetFPS.
        let drawRafId;

        function drawLoop() {
            drawRafId = requestAnimationFrame(drawLoop);
            if (document.hidden) return;

            const results = resultsRef.current;
            const w = canvas.width;
            const h = canvas.height;

            ctx.save();
            ctx.clearRect(0, 0, w, h);

            // Draw video frame
            if (video.readyState >= 2) {
                ctx.drawImage(video, 0, 0, w, h);
            }

            if (results) {
                // Pose skeleton
                if (results.pose) {
                    drawConnectors(ctx, results.pose, POSE_CONNECTIONS, '#00f3ff', 3, w, h);
                    drawLandmarks(ctx, results.pose, '#ffffff', 3, w, h);
                }

                // Hands (color by handedness)
                results.hands.forEach((handLandmarks, i) => {
                    const side = results.handedness[i]?.[0]?.categoryName ?? 'Left';
                    const color = side === 'Right' ? '#9d4edd' : '#7b2ff7';
                    drawConnectors(ctx, handLandmarks, HAND_CONNECTIONS, color, 4, w, h);
                    drawLandmarks(ctx, handLandmarks, '#ffffff', 3, w, h);
                });
            }

            ctx.restore();
        }

        // ── 5. Start camera ───────────────────────────────────────────────────
        async function startCamera() {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        width: { ideal: 640 },
                        height: { ideal: 480 },
                        facingMode: 'user',
                        frameRate: { ideal: 30, max: 30 },
                    },
                    audio: false,
                });

                streamRef.current = stream;
                video.srcObject = stream;
                await video.play();

                // Start both loops
                rafIdRef.current = video.requestVideoFrameCallback(captureFrame);
                drawLoop();

            } catch (err) {
                console.error('[useMediaPipe] Camera error:', err);
            }
        }

        // ── 6. Cleanup on unmount ─────────────────────────────────────────────
        return () => {
            // Stop capture loop
            if (rafIdRef.current != null) {
                video.cancelVideoFrameCallback(rafIdRef.current);
            }

            // Stop draw loop
            cancelAnimationFrame(drawRafId);

            // Stop camera stream
            streamRef.current?.getTracks().forEach(t => t.stop());

            // Terminate Worker
            worker.postMessage({ type: 'destroy' });
            setTimeout(() => worker.terminate(), 200);

            // Reset filter state
            filterRef.current?.reset();
        };

    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // intentionally empty — all values accessed via refs
}

// ─── Payload builder ──────────────────────────────────────────────────────────

/**
 * Converts the tasks-vision output format into the backend-compatible payload.
 * Backend expects: { pose, leftHand, rightHand }
 *
 * tasks-vision handedness.categoryName is from the *camera* perspective,
 * which is the MIRROR of the user's actual hand. We swap here so that
 * 'leftHand' in the payload always refers to the user's left hand.
 */
function buildPayload({ pose, hands, handedness }) {
    let leftHand = null;
    let rightHand = null;

    hands.forEach((lms, i) => {
        // categoryName is 'Left' or 'Right' from camera view → swap for user
        const cameraLabel = handedness[i]?.[0]?.categoryName ?? 'Left';
        if (cameraLabel === 'Left') {
            rightHand = lms; // camera left = user right (mirrored)
        } else {
            leftHand = lms;  // camera right = user left
        }
    });

    return { pose, leftHand, rightHand };
}
