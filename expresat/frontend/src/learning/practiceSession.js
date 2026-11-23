/**
 * State machine for the 5 Right + 5 Left (10 total) guided LSM practice protocol.
 *
 * Guarantees:
 * - Tracks real laterality (`right` vs `left` from SignEngine's `rightHand`/`leftHand`).
 * - Prevents holding a static posture from counting 5 times in a row by enforcing
 *   both a continuous release period (`releaseMs`) and a per-hand minimum `cooldownMs`.
 * - Prompts explicitly to switch hands once one hand completes 5/5 repetitions.
 * - Marks session `completed` exclusively upon reaching 5 right + 5 left (10/10).
 */

export const REPS_PER_HAND = 5;
export const DEFAULT_RELEASE_MS = 350;
export const DEFAULT_COOLDOWN_MS = 700;

/**
 * Normalizes SignEngine / MediaPipe handedness identifiers into `'right' | 'left' | null`.
 * Follows ExpresaT v1.4.0 direct anatomical laterality (`rightHand`/`Right` -> `'right'`,
 * `leftHand`/`Left` -> `'left'`).
 *
 * @param {string|null|undefined} handId
 * @returns {'right'|'left'|null}
 */
export function normalizeHandSide(handId) {
  if (typeof handId !== 'string') return null;
  const norm = handId.trim().toLowerCase();
  if (norm === 'righthand' || norm === 'right') return 'right';
  if (norm === 'lefthand' || norm === 'left') return 'left';
  return null;
}

function handLabelEs(side) {
  return side === 'right' ? 'mano derecha' : 'mano izquierda';
}

function otherHand(side) {
  return side === 'right' ? 'left' : 'right';
}

export class PracticeSessionMachine {
  /**
   * @param {Object} options
   * @param {string} options.targetLabel Canonical sign label from `SIGN_LABELS`
   * @param {number} [options.repsPerHand=5]
   * @param {number} [options.releaseMs=350] Continuous non-target duration required before re-counting
   * @param {number} [options.cooldownMs=700] Minimum interval between two counted reps on the same hand
   */
  constructor({
    targetLabel,
    repsPerHand = REPS_PER_HAND,
    releaseMs = DEFAULT_RELEASE_MS,
    cooldownMs = DEFAULT_COOLDOWN_MS,
  } = {}) {
    this.targetLabel = targetLabel;
    this.repsPerHand = Math.max(1, repsPerHand);
    this.releaseMs = Math.max(50, releaseMs);
    this.cooldownMs = Math.max(100, cooldownMs);
    this._resetInternal();
  }

  _resetInternal() {
    this.rightCount = 0;
    this.leftCount = 0;
    this.completed = false;
    this.phase = 'practicing'; // 'practicing' | 'switch_hand' | 'completed'
    this.activeHand = null;
    this.lastEvent = null;
    this.promptMessage = `Haz la seña '${this.targetLabel}' ${this.repsPerHand} veces con cada mano.`;
    this._gates = {
      right: { status: 'ready', lastCountedMs: -Infinity, releaseSinceMs: null },
      left: { status: 'ready', lastCountedMs: -Infinity, releaseSinceMs: null },
    };
  }

  /**
   * Resets counters and anti-bounce gates (optionally switching to a new target sign).
   */
  reset(newTargetLabel = this.targetLabel) {
    this.targetLabel = newTargetLabel;
    this._resetInternal();
    return this.getSnapshot();
  }

  _countFor(side) {
    return side === 'right' ? this.rightCount : this.leftCount;
  }

  _increment(side) {
    if (side === 'right') {
      this.rightCount = Math.min(this.repsPerHand, this.rightCount + 1);
      return this.rightCount;
    }
    this.leftCount = Math.min(this.repsPerHand, this.leftCount + 1);
    return this.leftCount;
  }

  _updateReleaseGates(matchingSide, nowMs) {
    for (const side of ['right', 'left']) {
      const gate = this._gates[side];
      if (gate.status !== 'waiting_release') continue;

      if (matchingSide === side) {
        // Still holding target sign on this hand -> cancel any partial flicker release
        gate.releaseSinceMs = null;
      } else if (gate.releaseSinceMs === null) {
        gate.releaseSinceMs = nowMs;
      } else if (nowMs - gate.releaseSinceMs >= this.releaseMs) {
        gate.status = 'ready';
        gate.releaseSinceMs = null;
      }
    }
  }

  /**
   * Processes one classifier frame update (`detectedLabel`, `handId`, `timestampMs`).
   *
   * @param {Object} input
   * @param {string|null} input.detectedLabel Confirmed smoothed label from `GeometricClassifier`
   * @param {string|null} input.handId Laterality from `details.handId`
   * @param {number} [input.timestampMs] Monotonic timestamp in milliseconds
   */
  update({ detectedLabel = null, handId = null, timestampMs = Date.now() } = {}) {
    if (this.completed) {
      return this.getSnapshot();
    }

    const nowMs = Number.isFinite(timestampMs) ? timestampMs : Date.now();
    const side = normalizeHandSide(handId);
    const isTargetMatch = Boolean(detectedLabel && detectedLabel === this.targetLabel && side);

    this.activeHand = side;
    this.lastEvent = null;

    // 1. Advance release timers for any hand currently latched in `waiting_release`
    this._updateReleaseGates(isTargetMatch ? side : null, nowMs);

    if (!isTargetMatch) {
      // Refresh contextual prompt if waiting for the other hand
      if (this.rightCount >= this.repsPerHand && this.leftCount < this.repsPerHand) {
        this.phase = 'switch_hand';
        this.promptMessage = `¡Excelente! Ahora repite la seña ${this.repsPerHand} veces con tu otra mano (mano izquierda).`;
      } else if (this.leftCount >= this.repsPerHand && this.rightCount < this.repsPerHand) {
        this.phase = 'switch_hand';
        this.promptMessage = `¡Excelente! Ahora repite la seña ${this.repsPerHand} veces con tu otra mano (mano derecha).`;
      } else if (this._gates.right.status === 'ready' && this._gates.left.status === 'ready') {
        this.phase = 'practicing';
      }
      return this.getSnapshot();
    }

    // 2. Target sign matched with a known anatomical hand (`right` or `left`)
    const currentCount = this._countFor(side);
    const gate = this._gates[side];

    // If this hand already completed its 5 reps, remind user to switch to the other hand
    if (currentCount >= this.repsPerHand) {
      const remainingSide = otherHand(side);
      this.phase = 'switch_hand';
      this.lastEvent = {
        type: 'hand_already_done',
        hand: side,
        nextHand: remainingSide,
      };
      this.promptMessage = `¡Ya completaste las ${this.repsPerHand} con tu ${handLabelEs(side)}! Ahora repite la seña con tu ${handLabelEs(remainingSide)}.`;
      return this.getSnapshot();
    }

    // Anti-bounce: still waiting for user to lower/relax hand after previous rep
    if (gate.status === 'waiting_release') {
      this.lastEvent = {
        type: 'need_release',
        hand: side,
        count: currentCount,
      };
      this.promptMessage = `Repetición ${currentCount}/${this.repsPerHand} registrada. Baja o relaja tu ${handLabelEs(side)} un instante para la siguiente.`;
      return this.getSnapshot();
    }

    // Cooldown protection even after a very quick release
    if (nowMs - gate.lastCountedMs < this.cooldownMs) {
      return this.getSnapshot();
    }

    // 3. Count valid repetition and latch `waiting_release`
    const nextCount = this._increment(side);
    gate.status = 'waiting_release';
    gate.lastCountedMs = nowMs;
    gate.releaseSinceMs = null;

    if (this.rightCount >= this.repsPerHand && this.leftCount >= this.repsPerHand) {
      this.completed = true;
      this.phase = 'completed';
      this.lastEvent = {
        type: 'session_completed',
        hand: side,
        rightCount: this.rightCount,
        leftCount: this.leftCount,
      };
      this.promptMessage = `¡Felicidades! Completaste '${this.targetLabel}' (${this.repsPerHand} con derecha y ${this.repsPerHand} con izquierda).`;
    } else if (nextCount >= this.repsPerHand) {
      const nextSide = otherHand(side);
      this.phase = 'switch_hand';
      this.lastEvent = {
        type: 'hand_completed',
        hand: side,
        nextHand: nextSide,
        count: nextCount,
      };
      this.promptMessage = `¡Excelente! Ahora repite la seña ${this.repsPerHand} veces con tu otra mano (${handLabelEs(nextSide)}).`;
    } else {
      this.phase = 'practicing';
      this.lastEvent = {
        type: 'rep_counted',
        hand: side,
        count: nextCount,
      };
      this.promptMessage = `¡Bien hecho! ${handLabelEs(side).replace(/^m/, 'M')}: ${nextCount}/${this.repsPerHand}. Relaja tu mano brevemente para la siguiente repetición.`;
    }

    return this.getSnapshot();
  }

  getSnapshot() {
    const awaitingRelease =
      this._gates.right.status === 'waiting_release' ||
      this._gates.left.status === 'waiting_release';

    let nextRecommendedHand = null;
    if (!this.completed) {
      if (this.rightCount >= this.repsPerHand) {
        nextRecommendedHand = 'left';
      } else if (this.leftCount >= this.repsPerHand) {
        nextRecommendedHand = 'right';
      }
    }

    return {
      targetLabel: this.targetLabel,
      repsPerHand: this.repsPerHand,
      totalTarget: this.repsPerHand * 2,
      rightCount: this.rightCount,
      leftCount: this.leftCount,
      totalCount: this.rightCount + this.leftCount,
      completed: this.completed,
      phase: this.phase,
      awaitingRelease,
      rightWaitingRelease: this._gates.right.status === 'waiting_release',
      leftWaitingRelease: this._gates.left.status === 'waiting_release',
      activeHand: this.activeHand,
      nextRecommendedHand,
      promptMessage: this.promptMessage,
      lastEvent: this.lastEvent,
    };
  }
}
