/**
 * landmarkFilter.js — Exponential Moving Average (EMA) Low-Pass Filter (FEATURE_SPEC v1.4.0)
 *
 * Documentation & Vault References:
 *   - Frontend Code Guide: `Obsidian_exp/Explicacion del codigo/Frontend/Vite_React.md`
 *   - Feature Contract:    `Obsidian_exp/Especificacion_Feature_Spec_v1_4_0.md`
 *
 * Reduces jitter in MediaPipe landmark coordinates for UI rendering by smoothing
 * each (x, y, z) independently per anatomical slot (`pose`, `leftHand`, `rightHand`):
 *
 *   S_t = α · x_t + (1 - α) · S_{t−1}
 *
 * v1.4.0 guarantees:
 *   - Uses direct anatomical slots (`'Left' -> 'leftHand'`, `'Right' -> 'rightHand'`)
 *     instead of array index (`hand_0`/`hand_1`), preventing cross-hand EMA corruption
 *     whenever MediaPipe reorders detections.
 *   - Explicitly clears absent hand slots on every frame so reappearances start fresh.
 *   - NOTE: Only used for local UI/canvas smoothing; WebSocket neural batches and
 *     DevRecorder consume `frameData.raw` to avoid double EMA filtering.
 */

export class LandmarkEMAFilter {
  /**
   * @param {number} alpha - Smoothing factor in (0, 1]. Default: 0.45
   */
  constructor(alpha = 0.45) {
    if (alpha <= 0 || alpha > 1) {
      throw new RangeError(`LandmarkEMAFilter: alpha must be in (0, 1]. Got ${alpha}`);
    }
    this.alpha = alpha;
    this._prev = Object.create(null); // { [slotKey]: NormalizedLandmark[] | null }
  }

  /**
   * Applies the EMA filter to a landmark array under an anatomical slot key.
   *
   * @param {string} name - Slot key (e.g. 'pose', 'leftHand', 'rightHand').
   * @param {Array<{x:number, y:number, z:number, visibility?:number}>|null} landmarks
   * @returns {Array<{x:number, y:number, z:number, visibility?:number}>|null}
   */
  smooth(name, landmarks) {
    if (!landmarks || landmarks.length === 0) {
      this._prev[name] = null;
      return null;
    }

    const prev = this._prev[name];
    const len = landmarks.length;

    // First detection for this slot: initialize without lag
    if (!prev || prev.length !== len) {
      const init = new Array(len);
      for (let i = 0; i < len; i++) {
        const lm = landmarks[i];
        init[i] =
          lm.visibility !== undefined
            ? { x: lm.x, y: lm.y, z: lm.z ?? 0, visibility: lm.visibility }
            : { x: lm.x, y: lm.y, z: lm.z ?? 0 };
      }
      this._prev[name] = init;
      return init;
    }

    const a = this.alpha;
    const b = 1 - a;
    const smoothed = new Array(len);

    for (let i = 0; i < len; i++) {
      const lm = landmarks[i];
      const p = prev[i];
      const x = a * lm.x + b * p.x;
      const y = a * lm.y + b * p.y;
      const z = a * (lm.z ?? 0) + b * p.z;
      smoothed[i] =
        lm.visibility !== undefined
          ? { x, y, z, visibility: lm.visibility }
          : { x, y, z };
    }

    this._prev[name] = smoothed;
    return smoothed;
  }

  /**
   * Resets filter state for a specific slot or all slots.
   * @param {string} [name]
   */
  reset(name) {
    if (name) {
      this._prev[name] = null;
    } else {
      this._prev = Object.create(null);
    }
  }

  /**
   * Smooths pose and detected hands keyed by anatomical slot (`leftHand` / `rightHand`).
   * Absent slots are explicitly cleared to prevent ghost drift upon reappearance.
   *
   * @param {{ pose: Array|null, hands: Array[], handedness: Array[] }} results
   * @returns {{ pose: Array|null, hands: Array[], handedness: Array[] }}
   */
  smoothResults(results) {
    const smoothedPose = this.smooth('pose', results?.pose ?? null);
    const hands = Array.isArray(results?.hands) ? results.hands : [];
    const handedness = Array.isArray(results?.handedness) ? results.handedness : [];

    let seenLeft = false;
    let seenRight = false;
    const smoothedHands = new Array(hands.length);

    for (let i = 0; i < hands.length; i++) {
      const catItem = handedness[i]?.[0];
      const category = catItem?.categoryName ?? catItem?.label ?? null;

      let slotKey;
      if (category === 'Left' && !seenLeft) {
        slotKey = 'leftHand';
        seenLeft = true;
      } else if (category === 'Right' && !seenRight) {
        slotKey = 'rightHand';
        seenRight = true;
      } else if (!seenLeft) {
        slotKey = 'leftHand';
        seenLeft = true;
      } else if (!seenRight) {
        slotKey = 'rightHand';
        seenRight = true;
      } else {
        slotKey = `hand_${i}`;
      }

      smoothedHands[i] = this.smooth(slotKey, hands[i]);
    }

    if (!seenLeft) {
      this._prev.leftHand = null;
    }
    if (!seenRight) {
      this._prev.rightHand = null;
    }

    return {
      pose: smoothedPose,
      hands: smoothedHands,
      handedness,
    };
  }
}
