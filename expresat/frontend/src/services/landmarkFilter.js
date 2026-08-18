/**
 * landmarkFilter.js — Exponential Moving Average (EMA) Low-Pass Filter
 *
 * Reduces jitter in MediaPipe landmark coordinates by smoothing
 * each (x, y, z) independently using the formula:
 *
 *   S_t = α · x_t + (1 - α) · S_{t−1}
 *
 * Recommended alpha range for sign language:
 *   • α = 0.35  → very smooth, noticeable lag on fast gestures
 *   • α = 0.45  → balanced (default) — good for LSM/ASL
 *   • α = 0.60  → responsive, minor jitter on held poses
 */

export class LandmarkEMAFilter {
    /**
     * @param {number} alpha - Smoothing factor in (0, 1].
     *   Lower = smoother but more lag. Higher = more responsive but more jitter.
     *   Default: 0.45
     */
    constructor(alpha = 0.45) {
        if (alpha <= 0 || alpha > 1) {
            throw new RangeError(`LandmarkEMAFilter: alpha must be in (0, 1]. Got ${alpha}`);
        }
        this.alpha = alpha;
        this._prev = Object.create(null); // { [name]: NormalizedLandmark[] | null }
    }

    /**
     * Applies the EMA filter to a landmark array.
     *
     * @param {string} name - Unique key for this landmark set (e.g. 'pose', 'hand_0', 'hand_1').
     * @param {Array<{x:number, y:number, z:number}>|null} landmarks - Raw landmarks from MediaPipe.
     * @returns {Array<{x:number, y:number, z:number}>|null} Smoothed landmarks (same shape).
     */
    smooth(name, landmarks) {
        // If this set is absent this frame, reset its state so the next
        // appearance starts fresh (avoids stale ghost positions).
        if (!landmarks || landmarks.length === 0) {
            this._prev[name] = null;
            return null;
        }

        const prev = this._prev[name];

        // First detection for this set: initialize state without smoothing
        if (!prev || prev.length !== landmarks.length) {
            this._prev[name] = landmarks.map(lm => ({ x: lm.x, y: lm.y, z: lm.z }));
            return this._prev[name];
        }

        const a = this.alpha;
        const b = 1 - a;

        const smoothed = new Array(landmarks.length);
        for (let i = 0; i < landmarks.length; i++) {
            smoothed[i] = {
                x: a * landmarks[i].x + b * prev[i].x,
                y: a * landmarks[i].y + b * prev[i].y,
                z: a * landmarks[i].z + b * prev[i].z,
            };
        }

        this._prev[name] = smoothed;
        return smoothed;
    }

    /**
     * Resets the filter state for a specific landmark set or all sets.
     * Call when the camera is stopped or a new session starts.
     * @param {string} [name] - If omitted, resets all sets.
     */
    reset(name) {
        if (name) {
            this._prev[name] = null;
        } else {
            this._prev = Object.create(null);
        }
    }

    /**
     * Convenience: smooths pose + both hands in one call.
     * Matches the payload shape returned by the Web Worker.
     *
     * @param {{ pose: Array|null, hands: Array[], handedness: Array[] }} results
     * @returns {{ pose: Array|null, hands: Array[], handedness: Array[] }}
     */
    smoothResults(results) {
        return {
            pose: this.smooth('pose', results.pose),
            hands: results.hands.map((h, i) => this.smooth(`hand_${i}`, h)),
            handedness: results.handedness,
        };
    }
}
