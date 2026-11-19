/**
 * Experimental MediaPipe landmark tracking and visualization system.
 *
 * Hot-path optimized:
 *  - Precomputed O(1) lookup tables (`POSE_META_BY_INDEX`, `HAND_META_BY_SIDE`)
 *  - Zero per-frame `Set` allocation (`_tickId` tagging for eviction)
 *  - Trail node recycling and quantized RGBA color cache
 *  - Optional `{ includeTelemetry, trackHistory }` fast-path skipping unused work
 */

/** Pose connections grouped by body region */
export const POSE_SEGMENTS = {
    face: {
        name: 'Rostro / Cabeza',
        color: '#FACC15',
        glow: 'rgba(250, 204, 21, 0.45)',
        indices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        connections: [
            [0, 1], [1, 2], [2, 3], [3, 7],
            [0, 4], [4, 5], [5, 6], [6, 8],
            [9, 10]
        ]
    },
    torso: {
        name: 'Torso / Pecho',
        color: '#06B6D4',
        glow: 'rgba(6, 182, 212, 0.45)',
        indices: [11, 12, 23, 24],
        connections: [
            [11, 12], [11, 23], [12, 24], [23, 24]
        ]
    },
    leftArm: {
        name: 'Brazo Izquierdo',
        color: '#10B981',
        glow: 'rgba(16, 185, 129, 0.45)',
        indices: [11, 13, 15, 17, 19, 21],
        connections: [
            [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19]
        ]
    },
    rightArm: {
        name: 'Brazo Derecho',
        color: '#3B82F6',
        glow: 'rgba(59, 130, 246, 0.45)',
        indices: [12, 14, 16, 18, 20, 22],
        connections: [
            [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20]
        ]
    }
};

/** Hand connections and colors grouped by finger and palm */
export const HAND_SEGMENTS = {
    palm: {
        name: 'Palma / Muñeca',
        indices: [0],
        connections: [
            [0, 1], [0, 5], [5, 9], [9, 13], [13, 17], [0, 17]
        ],
        colors: {
            Left:  { color: '#EC4899', glow: 'rgba(236, 72, 153, 0.45)' },
            Right: { color: '#D946EF', glow: 'rgba(217, 70, 239, 0.45)' }
        }
    },
    thumb: {
        name: 'Pulgar',
        indices: [1, 2, 3, 4],
        tipIndex: 4,
        connections: [[1, 2], [2, 3], [3, 4]],
        colors: {
            Left:  { color: '#EF4444', glow: 'rgba(239, 68, 68, 0.45)' },
            Right: { color: '#FF5722', glow: 'rgba(255, 87, 34, 0.45)' }
        }
    },
    index: {
        name: 'Índice',
        indices: [5, 6, 7, 8],
        tipIndex: 8,
        connections: [[5, 6], [6, 7], [7, 8]],
        colors: {
            Left:  { color: '#F59E0B', glow: 'rgba(245, 158, 11, 0.45)' },
            Right: { color: '#EAB308', glow: 'rgba(234, 179, 8, 0.45)' }
        }
    },
    middle: {
        name: 'Medio',
        indices: [9, 10, 11, 12],
        tipIndex: 12,
        connections: [[9, 10], [10, 11], [11, 12]],
        colors: {
            Left:  { color: '#10B981', glow: 'rgba(16, 185, 129, 0.45)' },
            Right: { color: '#00E676', glow: 'rgba(0, 230, 118, 0.45)' }
        }
    },
    ring: {
        name: 'Anular',
        indices: [13, 14, 15, 16],
        tipIndex: 16,
        connections: [[13, 14], [14, 15], [15, 16]],
        colors: {
            Left:  { color: '#0EA5E9', glow: 'rgba(14, 165, 233, 0.45)' },
            Right: { color: '#38BDF8', glow: 'rgba(56, 189, 248, 0.45)' }
        }
    },
    pinky: {
        name: 'Meñique',
        indices: [17, 18, 19, 20],
        tipIndex: 20,
        connections: [[17, 18], [18, 19], [19, 20]],
        colors: {
            Left:  { color: '#8B5CF6', glow: 'rgba(139, 92, 246, 0.45)' },
            Right: { color: '#A855F7', glow: 'rgba(168, 85, 247, 0.45)' }
        }
    }
};

/** Human-readable anatomical landmark labels for the overlay UI */
export const LANDMARK_NAMES = {
    pose: {
        0: 'Nariz',
        1: 'Ojo Izq (Int)', 2: 'Ojo Izq', 3: 'Ojo Izq (Ext)',
        4: 'Ojo Der (Int)', 5: 'Ojo Der', 6: 'Ojo Der (Ext)',
        7: 'Oreja Izq', 8: 'Oreja Der',
        9: 'Boca Izq', 10: 'Boca Der',
        11: 'Hombro Izq', 12: 'Hombro Der',
        13: 'Codo Izq', 14: 'Codo Der',
        15: 'Muñeca Izq', 16: 'Muñeca Der',
        17: 'Meñique Izq (Pose)', 18: 'Meñique Der (Pose)',
        19: 'Índice Izq (Pose)', 20: 'Índice Der (Pose)',
        21: 'Pulgar Izq (Pose)', 22: 'Pulgar Der (Pose)',
        23: 'Cadera Izq', 24: 'Cadera Der'
    },
    hand: {
        0: 'Muñeca',
        1: 'Pulgar CMC', 2: 'Pulgar MCP', 3: 'Pulgar IP', 4: 'Punta Pulgar',
        5: 'Índice MCP', 6: 'Índice PIP', 7: 'Índice DIP', 8: 'Punta Índice',
        9: 'Medio MCP', 10: 'Medio PIP', 11: 'Medio DIP', 12: 'Punta Medio',
        13: 'Anular MCP', 14: 'Anular PIP', 15: 'Anular DIP', 16: 'Punta Anular',
        17: 'Meñique MCP', 18: 'Meñique PIP', 19: 'Meñique DIP', 20: 'Punta Meñique'
    }
};

/** Color legend items rendered in the UI */
export const COLOR_LEGEND_ITEMS = [
    { label: 'Rostro', color: '#FACC15', group: 'Pose' },
    { label: 'Torso', color: '#06B6D4', group: 'Pose' },
    { label: 'Brazo Izq', color: '#10B981', group: 'Pose' },
    { label: 'Brazo Der', color: '#3B82F6', group: 'Pose' },
    { label: 'Muñeca/Palma', color: '#EC4899', group: 'Mano' },
    { label: 'Pulgar', color: '#EF4444', group: 'Mano' },
    { label: 'Índice', color: '#F59E0B', group: 'Mano' },
    { label: 'Medio', color: '#10B981', group: 'Mano' },
    { label: 'Anular', color: '#0EA5E9', group: 'Mano' },
    { label: 'Meñique', color: '#8B5CF6', group: 'Mano' }
];

// Precomputed O(1) lookup tables (zero per-frame allocations)
const POSE_SEGMENT_LIST = Object.values(POSE_SEGMENTS);
const HAND_SEGMENT_LIST = Object.values(HAND_SEGMENTS);
const EMPTY_POINTS = Object.freeze([]);

const POSE_META_BY_INDEX = Array.from({ length: 33 }, (_, idx) => {
    let partName = 'Pose';
    let color = '#06B6D4';
    let glow = 'rgba(6, 182, 212, 0.45)';
    if (idx <= 10) {
        partName = 'Rostro';
        color = POSE_SEGMENTS.face.color;
        glow = POSE_SEGMENTS.face.glow;
    } else if (idx === 11 || idx === 13 || idx === 15 || idx === 17 || idx === 19 || idx === 21) {
        partName = 'Brazo Izquierdo';
        color = POSE_SEGMENTS.leftArm.color;
        glow = POSE_SEGMENTS.leftArm.glow;
    } else if (idx === 12 || idx === 14 || idx === 16 || idx === 18 || idx === 20 || idx === 22) {
        partName = 'Brazo Derecho';
        color = POSE_SEGMENTS.rightArm.color;
        glow = POSE_SEGMENTS.rightArm.glow;
    } else if (idx === 23 || idx === 24) {
        partName = 'Torso / Cadera';
        color = POSE_SEGMENTS.torso.color;
        glow = POSE_SEGMENTS.torso.glow;
    }
    return {
        partName,
        color,
        glow,
        isKeyJoint: idx >= 11 && idx <= 16,
        name: LANDMARK_NAMES.pose[idx] || `Pose #${idx}`,
    };
});

function buildHandSideMeta(sideKey) {
    return Array.from({ length: 21 }, (_, lmIdx) => {
        for (const segment of HAND_SEGMENT_LIST) {
            if (segment.indices.includes(lmIdx)) {
                return {
                    fingerName: segment.name,
                    fingerColor: segment.colors[sideKey].color,
                    fingerGlow: segment.colors[sideKey].glow,
                    isTip: segment.tipIndex === lmIdx,
                    displayLabel: `${LANDMARK_NAMES.hand[lmIdx] || `Punto #${lmIdx}`} (${sideKey === 'Right' ? 'Der' : 'Izq'})`,
                };
            }
        }
        return {
            fingerName: 'Mano',
            fingerColor: sideKey === 'Right' ? '#9D4EDD' : '#7B2FF7',
            fingerGlow: 'rgba(157, 78, 221, 0.4)',
            isTip: false,
            displayLabel: `${LANDMARK_NAMES.hand[lmIdx] || `Punto #${lmIdx}`} (${sideKey === 'Right' ? 'Der' : 'Izq'})`,
        };
    });
}

const HAND_META_BY_SIDE = {
    Left: buildHandSideMeta('Left'),
    Right: buildHandSideMeta('Right'),
};

const TRAIL_RGBA_CACHE = new Map();

export class LandmarkTracker {
    /**
     * @param {object} [options]
     * @param {number} [options.maxTrailLength=8] Max historical frames kept per motion trail
     * @param {number} [options.maxTelemetryPoints=50] Max tracked keys to cap memory usage
     */
    constructor(options = {}) {
        this.maxTrailLength = options.maxTrailLength ?? 8;
        this.maxTelemetryPoints = options.maxTelemetryPoints ?? 50;

        this.pointHistory = new Map();
        this._tickId = 0;
        this.lastTelemetry = null;
    }

    project(lm, w, h) {
        return { px: lm.x * w, py: lm.y * h };
    }

    /**
     * Updates historical tracking buffers and computes structured telemetry.
     *
     * @param {object} results - Smoothed landmarks `{ pose, hands, handedness }`
     * @param {number} width - Canvas width
     * @param {number} height - Canvas height
     * @param {object} [options] - `{ includeTelemetry, trackHistory }` to skip unused work
     * @returns {object} Telemetry snapshot
     */
    update(results, width, height, options = {}) {
        const { includeTelemetry = true, trackHistory = true } = options;
        const now = performance.now();

        let poseCount = Array.isArray(results?.pose) ? results.pose.length : 0;
        let leftHandCount = 0;
        let rightHandCount = 0;

        const handsArr = results?.hands;
        const handednessArr = results?.handedness;

        if (!trackHistory && !includeTelemetry) {
            if (Array.isArray(handsArr)) {
                for (let hIdx = 0; hIdx < handsArr.length; hIdx++) {
                    const hl = handsArr[hIdx];
                    if (!hl || hl.length === 0) continue;
                    const side = handednessArr?.[hIdx]?.[0]?.categoryName ?? (hIdx === 0 ? 'Left' : 'Right');
                    if (side === 'Left') leftHandCount = hl.length;
                    else rightHandCount = hl.length;
                }
            }
            if (this.pointHistory.size > 0) {
                this.pointHistory.clear();
            }
            this.lastTelemetry = {
                timestamp: now,
                counts: {
                    pose: poseCount,
                    leftHand: leftHandCount,
                    rightHand: rightHandCount,
                    totalActive: poseCount + leftHandCount + rightHandCount,
                },
                normalization: null,
                points: EMPTY_POINTS,
            };
            return this.lastTelemetry;
        }

        const tickId = ++this._tickId;
        const trackedPointsList = includeTelemetry ? [] : EMPTY_POINTS;

        // Track pose landmarks
        poseCount = 0;
        if (results?.pose && results.pose.length > 0) {
            const pose = results.pose;
            for (let idx = 0; idx < pose.length; idx++) {
                const lm = pose[idx];
                if (!lm) continue;
                poseCount++;
                const meta = POSE_META_BY_INDEX[idx] || {
                    partName: 'Pose',
                    color: '#06B6D4',
                    name: `Pose #${idx}`,
                };
                const key = `pose_${idx}`;
                const px = lm.x * width;
                const py = lm.y * height;
                const history = this._recordPointHistory(key, px, py, now, tickId, meta.color);

                if (includeTelemetry) {
                    trackedPointsList.push({
                        key,
                        id: idx,
                        type: 'pose',
                        name: meta.name,
                        part: meta.partName,
                        color: meta.color,
                        x: lm.x,
                        y: lm.y,
                        z: lm.z ?? 0,
                        visibility: lm.visibility ?? 1,
                        speed: this._getSpeedFromHistory(history),
                    });
                }
            }
        }

        // Track hand landmarks
        if (Array.isArray(handsArr) && handsArr.length > 0) {
            for (let handIdx = 0; handIdx < handsArr.length; handIdx++) {
                const handLandmarks = handsArr[handIdx];
                if (!handLandmarks || handLandmarks.length === 0) continue;

                const side = handednessArr?.[handIdx]?.[0]?.categoryName ?? (handIdx === 0 ? 'Left' : 'Right');
                const sideKey = side === 'Right' ? 'Right' : 'Left';
                if (side === 'Left') leftHandCount = handLandmarks.length;
                else rightHandCount = handLandmarks.length;

                const sideMeta = HAND_META_BY_SIDE[sideKey];
                const typeTag = `hand_${side}`;
                for (let lmIdx = 0; lmIdx < handLandmarks.length; lmIdx++) {
                    const lm = handLandmarks[lmIdx];
                    if (!lm) continue;
                    const key = `hand_${side}_${lmIdx}`;
                    const meta = sideMeta[lmIdx] || this._getHandSegmentMeta(lmIdx, sideKey);
                    const px = lm.x * width;
                    const py = lm.y * height;
                    const history = this._recordPointHistory(key, px, py, now, tickId, meta.fingerColor);

                    if (includeTelemetry) {
                        trackedPointsList.push({
                            key,
                            id: lmIdx,
                            type: typeTag,
                            handSide: side,
                            name:
                                meta.displayLabel ||
                                `${LANDMARK_NAMES.hand[lmIdx] || `Punto #${lmIdx}`} (${side === 'Right' ? 'Der' : 'Izq'})`,
                            part: meta.fingerName,
                            color: meta.fingerColor,
                            x: lm.x,
                            y: lm.y,
                            z: lm.z ?? 0,
                            visibility: lm.visibility ?? 1,
                            speed: this._getSpeedFromHistory(history),
                        });
                    }
                }
            }
        }

        // Evict inactive keys by tickId without allocating a Set per frame
        for (const [storedKey, history] of this.pointHistory.entries()) {
            if (history._tickId !== tickId) {
                this.pointHistory.delete(storedKey);
            }
        }
        const currentPointCount = this.pointHistory.size;
        if (currentPointCount > this.maxTelemetryPoints) {
            const keysToRemove = currentPointCount - this.maxTelemetryPoints;
            let removed = 0;
            for (const key of this.pointHistory.keys()) {
                if (removed >= keysToRemove) break;
                this.pointHistory.delete(key);
                removed++;
            }
        }

        // Normalization metrics only when telemetry drawer is open
        let normalization = null;
        if (includeTelemetry && results?.pose && results.pose[11] && results.pose[12]) {
            const p11 = results.pose[11];
            const p12 = results.pose[12];
            const shoulderMid = {
                x: (p11.x + p12.x) / 2,
                y: (p11.y + p12.y) / 2,
                z: ((p11.z ?? 0) + (p12.z ?? 0)) / 2
            };
            const shoulderWidth = Math.hypot(p12.x - p11.x, p12.y - p11.y);
            normalization = {
                shoulderMid,
                shoulderWidth: Math.max(shoulderWidth, 1e-6),
                valid: shoulderWidth > 0.05
            };
        }

        this.lastTelemetry = {
            timestamp: now,
            counts: {
                pose: poseCount,
                leftHand: leftHandCount,
                rightHand: rightHandCount,
                totalActive: poseCount + leftHandCount + rightHandCount
            },
            normalization,
            points: trackedPointsList
        };

        return this.lastTelemetry;
    }

    render(ctx, results, width, height, config = {}) {
        if (!results) return;

        const {
            showTrails = true,
            showLabels = false,
            showHalos = true,
            colorByPart = true,
            trailLength = 8,
            pointRadius = 3.5,
            lineWidth = 2.5
        } = config;

        this.maxTrailLength = Math.max(2, Math.min(trailLength, 20));

        ctx.save();

        if (showTrails) {
            this._drawMotionTrails(ctx, results, width, height, colorByPart);
        }

        if (results.pose && results.pose.length > 0) {
            this._drawPoseSegments(ctx, results.pose, width, height, {
                colorByPart,
                lineWidth,
                pointRadius,
                showLabels,
                showHalos
            });
        }

        if (results.hands && results.hands.length > 0) {
            for (let i = 0; i < results.hands.length; i++) {
                const handLandmarks = results.hands[i];
                const side = results.handedness?.[i]?.[0]?.categoryName ?? (i === 0 ? 'Left' : 'Right');
                this._drawHandSegments(ctx, handLandmarks, side, width, height, {
                    colorByPart,
                    lineWidth,
                    pointRadius,
                    showLabels,
                    showHalos
                });
            }
        }

        ctx.restore();
    }

    reset() {
        this.pointHistory.clear();
        this.lastTelemetry = null;
    }

    _recordPointHistory(key, px, py, time, tickId = this._tickId, color = '#00F3FF') {
        let history = this.pointHistory.get(key);
        if (!history) {
            history = [];
            this.pointHistory.set(key, history);
        }
        history._tickId = tickId;
        history._color = color;
        if (history.length >= this.maxTrailLength) {
            const recycled = history.shift();
            recycled.px = px;
            recycled.py = py;
            recycled.time = time;
            history.push(recycled);
        } else {
            history.push({ px, py, time });
        }
        return history;
    }

    _getSpeedFromHistory(history) {
        if (!history || history.length < 2) return 0;
        const pLatest = history[history.length - 1];
        const pPrev = history[history.length - 2];
        const dt = (pLatest.time - pPrev.time) / 1000;
        if (dt <= 0) return 0;
        const dist = Math.hypot(pLatest.px - pPrev.px, pLatest.py - pPrev.py);
        return Math.round(dist / dt);
    }

    _getPointSpeed(key) {
        return this._getSpeedFromHistory(this.pointHistory.get(key));
    }

    _getHandSegmentMeta(lmIdx, side) {
        const sideKey = side === 'Right' ? 'Right' : 'Left';
        const cached = HAND_META_BY_SIDE[sideKey]?.[lmIdx];
        if (cached) return cached;
        return {
            fingerName: 'Mano',
            fingerColor: sideKey === 'Right' ? '#9D4EDD' : '#7B2FF7',
            fingerGlow: 'rgba(157, 78, 221, 0.4)',
            isTip: false
        };
    }

    _drawMotionTrails(ctx, _results, _width, _height, colorByPart) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        for (const history of this.pointHistory.values()) {
            const hLen = history.length;
            if (hLen < 2) continue;

            const trailColor = colorByPart && history._color ? history._color : '#00F3FF';

            for (let i = 0; i < hLen - 1; i++) {
                const ptA = history[i];
                const ptB = history[i + 1];
                const factor = (i + 1) / hLen;
                const alpha = Math.max(0.1, factor * 0.7);

                ctx.strokeStyle = this._hexToRgba(trailColor, alpha);
                ctx.lineWidth = Math.max(1, factor * 3.5);

                ctx.beginPath();
                ctx.moveTo(ptA.px, ptA.py);
                ctx.lineTo(ptB.px, ptB.py);
                ctx.stroke();
            }
        }
    }

    _drawPoseSegments(ctx, pose, width, height, opts) {
        const { colorByPart, lineWidth, pointRadius, showLabels, showHalos } = opts;

        for (let sIdx = 0; sIdx < POSE_SEGMENT_LIST.length; sIdx++) {
            const segment = POSE_SEGMENT_LIST[sIdx];
            ctx.strokeStyle = colorByPart ? segment.color : '#00F3FF';
            ctx.lineWidth = lineWidth;
            ctx.beginPath();

            const conns = segment.connections;
            for (let cIdx = 0; cIdx < conns.length; cIdx++) {
                const lmA = pose[conns[cIdx][0]];
                const lmB = pose[conns[cIdx][1]];
                if (!lmA || !lmB) continue;
                if ((lmA.visibility ?? 1) < 0.25 || (lmB.visibility ?? 1) < 0.25) continue;
                ctx.moveTo(lmA.x * width, lmA.y * height);
                ctx.lineTo(lmB.x * width, lmB.y * height);
            }
            ctx.stroke();
        }

        const twoPi = Math.PI * 2;
        for (let idx = 0; idx < pose.length; idx++) {
            const lm = pose[idx];
            if (!lm || (lm.visibility ?? 1) < 0.25) continue;
            const px = lm.x * width;
            const py = lm.y * height;

            const meta = POSE_META_BY_INDEX[idx];
            const nodeColor = colorByPart && meta ? meta.color : '#06B6D4';
            const haloGlow = colorByPart && meta ? meta.glow : 'rgba(6, 182, 212, 0.45)';
            const isKeyJoint = meta ? meta.isKeyJoint : false;

            if (showHalos && isKeyJoint) {
                ctx.beginPath();
                ctx.arc(px, py, pointRadius + 4, 0, twoPi);
                ctx.fillStyle = haloGlow;
                ctx.fill();
            }

            ctx.beginPath();
            ctx.arc(px, py, isKeyJoint ? pointRadius + 1 : pointRadius, 0, twoPi);
            ctx.fillStyle = nodeColor;
            ctx.fill();
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            if (showLabels) {
                this._drawLabel(ctx, String(idx), px, py, nodeColor);
            }
        }
    }

    _drawHandSegments(ctx, handLandmarks, side, width, height, opts) {
        const { colorByPart, lineWidth, pointRadius, showLabels, showHalos } = opts;
        const sideKey = side === 'Right' ? 'Right' : 'Left';
        const fallbackColor = sideKey === 'Right' ? '#9D4EDD' : '#7B2FF7';

        for (let sIdx = 0; sIdx < HAND_SEGMENT_LIST.length; sIdx++) {
            const segment = HAND_SEGMENT_LIST[sIdx];
            ctx.strokeStyle = colorByPart ? segment.colors[sideKey].color : fallbackColor;
            ctx.lineWidth = lineWidth + 0.5;
            ctx.beginPath();

            const conns = segment.connections;
            for (let cIdx = 0; cIdx < conns.length; cIdx++) {
                const lmA = handLandmarks[conns[cIdx][0]];
                const lmB = handLandmarks[conns[cIdx][1]];
                if (!lmA || !lmB) continue;
                ctx.moveTo(lmA.x * width, lmA.y * height);
                ctx.lineTo(lmB.x * width, lmB.y * height);
            }
            ctx.stroke();
        }

        const sideMeta = HAND_META_BY_SIDE[sideKey];
        const twoPi = Math.PI * 2;
        for (let idx = 0; idx < handLandmarks.length; idx++) {
            const lm = handLandmarks[idx];
            if (!lm) continue;
            const px = lm.x * width;
            const py = lm.y * height;
            const meta = sideMeta[idx] || this._getHandSegmentMeta(idx, sideKey);
            const nodeColor = colorByPart ? meta.fingerColor : '#FFFFFF';

            if (showHalos && (meta.isTip || idx === 0)) {
                ctx.beginPath();
                ctx.arc(px, py, pointRadius + 4.5, 0, twoPi);
                ctx.fillStyle = colorByPart ? meta.fingerGlow : 'rgba(255, 255, 255, 0.35)';
                ctx.fill();
            }

            ctx.beginPath();
            ctx.arc(px, py, meta.isTip ? pointRadius + 1.2 : pointRadius, 0, twoPi);
            ctx.fillStyle = nodeColor;
            ctx.fill();
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 1.2;
            ctx.stroke();

            if (showLabels) {
                this._drawLabel(ctx, String(idx), px, py, nodeColor);
            }
        }
    }

    _drawLabel(ctx, text, x, y, color) {
        ctx.save();
        ctx.font = 'bold 9px monospace';
        const metrics = ctx.measureText(text);
        const textW = metrics.width;
        const boxW = textW + 6;
        const boxH = 12;
        const boxX = x + 4;
        const boxY = y - 14;

        ctx.fillStyle = 'rgba(10, 10, 18, 0.85)';
        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxW, boxH, 3);
        ctx.fill();

        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, boxX + boxW / 2, boxY + boxH / 2);

        ctx.restore();
    }

    _hexToRgba(hex, alpha) {
        const quantized = Math.round(alpha * 20) / 20;
        const cacheKey = `${hex}_${quantized}`;
        const cached = TRAIL_RGBA_CACHE.get(cacheKey);
        if (cached !== undefined) return cached;

        let cleaned = hex.replace('#', '').trim();
        if (!/^[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{3})?$/.test(cleaned)) {
            console.warn('[landmarkTracker] _hexToRgba: Código HEX inválido, usando transparente', hex);
            return 'rgba(0, 0, 0, 0)';
        }
        if (cleaned.length === 3) {
            cleaned = cleaned[0] + cleaned[0] + cleaned[1] + cleaned[1] + cleaned[2] + cleaned[2];
        }
        const r = parseInt(cleaned.slice(0, 2), 16);
        const g = parseInt(cleaned.slice(2, 4), 16);
        const b = parseInt(cleaned.slice(4, 6), 16);
        const res = `rgba(${r}, ${g}, ${b}, ${quantized})`;
        TRAIL_RGBA_CACHE.set(cacheKey, res);
        return res;
    }
}
