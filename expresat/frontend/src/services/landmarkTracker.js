/**
 * Experimental MediaPipe landmark tracking and visualization system.
 *
 * Responsibilities:
 *  1. Anatomical grouping for MediaPipe Pose and Hand landmarks.
 *  2. Color coding per body part and finger (pose: face, torso, arms;
 *     hands: palm/wrist, thumb, index, middle, ring, pinky).
 *  3. Motion trails over recent frames.
 *  4. Visual ID badges and halos on key joints.
 *  5. Real-time telemetry (3D coordinates, visibility, speed, normalization).
 */

// Topologies and anatomical connections

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

export class LandmarkTracker {
    /**
     * @param {object} [options]
     * @param {number} [options.maxTrailLength=8] Max historical frames kept per motion trail
     * @param {number} [options.maxTelemetryPoints=50] Max tracked keys to cap memory usage
     */
    constructor(options = {}) {
        this.maxTrailLength = options.maxTrailLength ?? 8;
        this.maxTelemetryPoints = options.maxTelemetryPoints ?? 50;

        // Per-key trail history: Map<pointKey, Array<{ px, py, time }>>
        this.pointHistory = new Map();

        this.lastTelemetry = null;
    }

    /**
     * Projects a normalized landmark into canvas pixel coordinates.
     */
    project(lm, w, h) {
        return { px: lm.x * w, py: lm.y * h };
    }

    /**
     * Updates historical tracking buffers and computes structured telemetry.
     *
     * @param {object} results - Smoothed landmarks `{ pose, hands, handedness }`
     * @param {number} width - Canvas width
     * @param {number} height - Canvas height
     * @returns {object} Telemetry snapshot with counts, coordinates, and velocities
     */
    update(results, width, height) {
        const now = performance.now();
        const activeKeys = new Set();
        const trackedPointsList = [];

        // Track pose landmarks
        let poseCount = 0;
        if (results?.pose && results.pose.length > 0) {
            results.pose.forEach((lm, idx) => {
                if (!lm) return;
                poseCount++;
                const key = `pose_${idx}`;
                activeKeys.add(key);

                const { px, py } = this.project(lm, width, height);
                this._recordPointHistory(key, px, py, now);

                // Resolve anatomical pose body region
                let partName = 'Pose';
                let partColor = '#06B6D4';
                if (idx <= 10) {
                    partName = 'Rostro';
                    partColor = POSE_SEGMENTS.face.color;
                } else if ([11, 13, 15, 17, 19, 21].includes(idx)) {
                    partName = 'Brazo Izquierdo';
                    partColor = POSE_SEGMENTS.leftArm.color;
                } else if ([12, 14, 16, 18, 20, 22].includes(idx)) {
                    partName = 'Brazo Derecho';
                    partColor = POSE_SEGMENTS.rightArm.color;
                } else if ([23, 24].includes(idx)) {
                    partName = 'Torso / Cadera';
                    partColor = POSE_SEGMENTS.torso.color;
                }

                trackedPointsList.push({
                    key,
                    id: idx,
                    type: 'pose',
                    name: LANDMARK_NAMES.pose[idx] || `Pose #${idx}`,
                    part: partName,
                    color: partColor,
                    x: lm.x,
                    y: lm.y,
                    z: lm.z ?? 0,
                    visibility: lm.visibility ?? 1,
                    speed: this._getPointSpeed(key)
                });
            });
        }

        // Track hand landmarks
        let leftHandCount = 0;
        let rightHandCount = 0;

        if (results?.hands && results.hands.length > 0) {
            results.hands.forEach((handLandmarks, handIdx) => {
                if (!handLandmarks || handLandmarks.length === 0) return;

                // MediaPipe tasks-vision handedness
                const side = results.handedness?.[handIdx]?.[0]?.categoryName ?? (handIdx === 0 ? 'Left' : 'Right');
                if (side === 'Left') leftHandCount = handLandmarks.length;
                else rightHandCount = handLandmarks.length;

                handLandmarks.forEach((lm, lmIdx) => {
                    if (!lm) return;
                    const key = `hand_${side}_${lmIdx}`;
                    activeKeys.add(key);

                    const { px, py } = this.project(lm, width, height);
                    this._recordPointHistory(key, px, py, now);

                    const { fingerName, fingerColor } = this._getHandSegmentMeta(lmIdx, side);

                    trackedPointsList.push({
                        key,
                        id: lmIdx,
                        type: `hand_${side}`,
                        handSide: side,
                        name: `${LANDMARK_NAMES.hand[lmIdx] || `Punto #${lmIdx}`} (${side === 'Right' ? 'Der' : 'Izq'})`,
                        part: fingerName,
                        color: fingerColor,
                        x: lm.x,
                        y: lm.y,
                        z: lm.z ?? 0,
                        visibility: lm.visibility ?? 1,
                        speed: this._getPointSpeed(key)
                    });
                });
            });
        }

        // Evict inactive keys and enforce maxTelemetryPoints to prevent unbounded growth
        for (const storedKey of this.pointHistory.keys()) {
            if (!activeKeys.has(storedKey)) {
                this.pointHistory.delete(storedKey);
            }
        }
        const currentPointCount = this.pointHistory.size;
        if (currentPointCount > this.maxTelemetryPoints) {
            // Drop oldest entries until within limit
            const keysToRemove = currentPointCount - this.maxTelemetryPoints;
            let removed = 0;
            for (const key of this.pointHistory.keys()) {
                if (removed >= keysToRemove) break;
                this.pointHistory.delete(key);
                removed++;
            }
        }

        // Normalization metrics matching ExpresaT shoulder-scale invariants
        let normalization = null;
        if (results?.pose && results.pose[11] && results.pose[12]) {
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

    /**
     * Renders the full landmark tracking overlay on canvas:
     *  - Motion trails.
     *  - Body/finger color-coded skeleton segments.
     *  - Landmark nodes with contrast rings and key-joint halos.
     *  - Optional numeric ID badges.
     *
     * @param {CanvasRenderingContext2D} ctx - 2D canvas context
     * @param {object} results - Smoothed landmarks
     * @param {number} width - Canvas width
     * @param {number} height - Canvas height
     * @param {object} config - Rendering options
     */
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

        // Clamp trail history length to configured bounds
        this.maxTrailLength = Math.max(2, Math.min(trailLength, 20));

        ctx.save();

        // A. Motion trails
        if (showTrails) {
            this._drawMotionTrails(ctx, results, width, height, colorByPart);
        }

        // B. Color-coded Pose skeleton
        if (results.pose && results.pose.length > 0) {
            this._drawPoseSegments(ctx, results.pose, width, height, {
                colorByPart,
                lineWidth,
                pointRadius,
                showLabels,
                showHalos
            });
        }

        // C. Color-coded Hand skeletons
        if (results.hands && results.hands.length > 0) {
            results.hands.forEach((handLandmarks, i) => {
                const side = results.handedness?.[i]?.[0]?.categoryName ?? (i === 0 ? 'Left' : 'Right');
                this._drawHandSegments(ctx, handLandmarks, side, width, height, {
                    colorByPart,
                    lineWidth,
                    pointRadius,
                    showLabels,
                    showHalos
                });
            });
        }

        ctx.restore();
    }

    /**
     * Clears tracking history buffers and last telemetry snapshot.
     */
    reset() {
        this.pointHistory.clear();
        this.lastTelemetry = null;
    }

    // Internal drawing helpers

    /**
     * Appends a new coordinate sample to a landmark's trail history.
     */
    _recordPointHistory(key, px, py, time) {
        let history = this.pointHistory.get(key);
        if (!history) {
            history = [];
            this.pointHistory.set(key, history);
        }
        history.push({ px, py, time });
        if (history.length > this.maxTrailLength) {
            history.shift();
        }
    }

    /**
     * Estimates a point's velocity in pixels per second.
     */
    _getPointSpeed(key) {
        const history = this.pointHistory.get(key);
        if (!history || history.length < 2) return 0;
        const pLatest = history[history.length - 1];
        const pPrev = history[history.length - 2];
        const dt = (pLatest.time - pPrev.time) / 1000;
        if (dt <= 0) return 0;
        const dist = Math.hypot(pLatest.px - pPrev.px, pLatest.py - pPrev.py);
        return Math.round(dist / dt);
    }

    /**
     * Returns name and color metadata for a hand landmark based on its finger segment.
     */
    _getHandSegmentMeta(lmIdx, side) {
        const sideKey = side === 'Right' ? 'Right' : 'Left';
        for (const segment of Object.values(HAND_SEGMENTS)) {
            if (segment.indices.includes(lmIdx)) {
                return {
                    fingerName: segment.name,
                    fingerColor: segment.colors[sideKey].color,
                    fingerGlow: segment.colors[sideKey].glow,
                    isTip: segment.tipIndex === lmIdx
                };
            }
        }
        return {
            fingerName: 'Mano',
            fingerColor: sideKey === 'Right' ? '#9D4EDD' : '#7B2FF7',
            fingerGlow: 'rgba(157, 78, 221, 0.4)',
            isTip: false
        };
    }

    /**
     * Renders fading motion trails for all active tracked landmarks.
     */
    _drawMotionTrails(ctx, results, width, height, colorByPart) {
        for (const [key, history] of this.pointHistory.entries()) {
            if (history.length < 2) continue;

            // Resolve trail color by tracked key
            let trailColor = '#00F3FF';
            if (colorByPart) {
                if (key.startsWith('pose_')) {
                    const idx = parseInt(key.replace('pose_', ''), 10);
                    if (idx <= 10) trailColor = POSE_SEGMENTS.face.color;
                    else if ([11, 13, 15, 17, 19, 21].includes(idx)) trailColor = POSE_SEGMENTS.leftArm.color;
                    else if ([12, 14, 16, 18, 20, 22].includes(idx)) trailColor = POSE_SEGMENTS.rightArm.color;
                    else trailColor = POSE_SEGMENTS.torso.color;
                } else if (key.startsWith('hand_')) {
                    const parts = key.split('_');
                    const side = parts[1];
                    const lmIdx = parseInt(parts[2], 10);
                    trailColor = this._getHandSegmentMeta(lmIdx, side).fingerColor;
                }
            }

            // Draw attenuated segmented trail
            ctx.beginPath();
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            for (let i = 0; i < history.length - 1; i++) {
                const ptA = history[i];
                const ptB = history[i + 1];
                const factor = (i + 1) / history.length;
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

    /**
     * Renders pose skeleton segments and landmarks grouped by body region.
     */
    _drawPoseSegments(ctx, pose, width, height, opts) {
        const { colorByPart, lineWidth, pointRadius, showLabels, showHalos } = opts;

        // 1. Segmented bone connections
        for (const segment of Object.values(POSE_SEGMENTS)) {
            const segColor = colorByPart ? segment.color : '#00F3FF';
            ctx.strokeStyle = segColor;
            ctx.lineWidth = lineWidth;
            ctx.beginPath();

            for (const [a, b] of segment.connections) {
                if (!pose[a] || !pose[b]) continue;
                if ((pose[a].visibility ?? 1) < 0.25 || (pose[b].visibility ?? 1) < 0.25) continue;
                const pa = this.project(pose[a], width, height);
                const pb = this.project(pose[b], width, height);
                ctx.moveTo(pa.px, pa.py);
                ctx.lineTo(pb.px, pb.py);
            }
            ctx.stroke();
        }

        // 2. Landmark nodes
        pose.forEach((lm, idx) => {
            if (!lm || (lm.visibility ?? 1) < 0.25) return;
            const { px, py } = this.project(lm, width, height);

            // Resolve segment color
            let nodeColor = '#06B6D4';
            let haloGlow = 'rgba(6, 182, 212, 0.45)';
            if (colorByPart) {
                if (idx <= 10) {
                    nodeColor = POSE_SEGMENTS.face.color;
                    haloGlow = POSE_SEGMENTS.face.glow;
                } else if ([11, 13, 15, 17, 19, 21].includes(idx)) {
                    nodeColor = POSE_SEGMENTS.leftArm.color;
                    haloGlow = POSE_SEGMENTS.leftArm.glow;
                } else if ([12, 14, 16, 18, 20, 22].includes(idx)) {
                    nodeColor = POSE_SEGMENTS.rightArm.color;
                    haloGlow = POSE_SEGMENTS.rightArm.glow;
                } else {
                    nodeColor = POSE_SEGMENTS.torso.color;
                    haloGlow = POSE_SEGMENTS.torso.glow;
                }
            }

            // Highlight halo on key joints (shoulders, elbows, wrists)
            const isKeyJoint = [11, 12, 13, 14, 15, 16].includes(idx);
            if (showHalos && isKeyJoint) {
                ctx.beginPath();
                ctx.arc(px, py, pointRadius + 4, 0, Math.PI * 2);
                ctx.fillStyle = haloGlow;
                ctx.fill();
            }

            // Primary landmark node
            ctx.beginPath();
            ctx.arc(px, py, isKeyJoint ? pointRadius + 1 : pointRadius, 0, Math.PI * 2);
            ctx.fillStyle = nodeColor;
            ctx.fill();
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // ID badge
            if (showLabels) {
                this._drawLabel(ctx, String(idx), px, py, nodeColor);
            }
        });
    }

    /**
     * Renders hand skeleton segments and landmarks grouped by finger and palm.
     */
    _drawHandSegments(ctx, handLandmarks, side, width, height, opts) {
        const { colorByPart, lineWidth, pointRadius, showLabels, showHalos } = opts;
        const sideKey = side === 'Right' ? 'Right' : 'Left';

        // 1. Per-finger connections
        for (const segment of Object.values(HAND_SEGMENTS)) {
            const segColor = colorByPart
                ? segment.colors[sideKey].color
                : (sideKey === 'Right' ? '#9D4EDD' : '#7B2FF7');

            ctx.strokeStyle = segColor;
            ctx.lineWidth = lineWidth + 0.5;
            ctx.beginPath();

            for (const [a, b] of segment.connections) {
                if (!handLandmarks[a] || !handLandmarks[b]) continue;
                const pa = this.project(handLandmarks[a], width, height);
                const pb = this.project(handLandmarks[b], width, height);
                ctx.moveTo(pa.px, pa.py);
                ctx.lineTo(pb.px, pb.py);
            }
            ctx.stroke();
        }

        // 2. Landmark nodes with fingertip and wrist halos
        handLandmarks.forEach((lm, idx) => {
            if (!lm) return;
            const { px, py } = this.project(lm, width, height);
            const { fingerColor, fingerGlow, isTip } = this._getHandSegmentMeta(idx, side);
            const nodeColor = colorByPart ? fingerColor : '#FFFFFF';

            // Halo on fingertips and wrist
            if (showHalos && (isTip || idx === 0)) {
                ctx.beginPath();
                ctx.arc(px, py, pointRadius + 4.5, 0, Math.PI * 2);
                ctx.fillStyle = colorByPart ? fingerGlow : 'rgba(255, 255, 255, 0.35)';
                ctx.fill();
            }

            // Primary node
            ctx.beginPath();
            ctx.arc(px, py, isTip ? pointRadius + 1.2 : pointRadius, 0, Math.PI * 2);
            ctx.fillStyle = nodeColor;
            ctx.fill();
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 1.2;
            ctx.stroke();

            // ID badge
            if (showLabels) {
                this._drawLabel(ctx, String(idx), px, py, nodeColor);
            }
        });
    }

    /**
     * Draws a small numeric ID badge next to a landmark.
     */
    _drawLabel(ctx, text, x, y, color) {
        ctx.save();
        ctx.font = 'bold 9px monospace';
        const metrics = ctx.measureText(text);
        const textW = metrics.width;
        const boxW = textW + 6;
        const boxH = 12;
        const boxX = x + 4;
        const boxY = y - 14;

        // High-contrast dark background
        ctx.fillStyle = 'rgba(10, 10, 18, 0.85)';
        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxW, boxH, 3);
        ctx.fill();

        // Part-colored border
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Text
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, boxX + boxW / 2, boxY + boxH / 2);

        ctx.restore();
    }

    /**
     * Converts a HEX color string to an `rgba(...)` string, normalizing shorthand forms.
     */
    _hexToRgba(hex, alpha) {
        // Strip leading '#' and whitespace
        let cleaned = hex.replace('#', '').trim();
        
        // Reject invalid hex strings to prevent NaN channels
        if (!/^[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{3})?$/.test(cleaned)) {
            console.warn('[landmarkTracker] _hexToRgba: Código HEX inválido, usando transparente', hex);
            return 'rgba(0, 0, 0, 0)';
        }
        
        // Expand 3-digit shorthand to 6 digits
        if (cleaned.length === 3) {
            cleaned = cleaned[0] + cleaned[0] + cleaned[1] + cleaned[1] + cleaned[2] + cleaned[2];
        }
        
        let r = 0, g = 0, b = 0;
        if (cleaned.length === 6) {
            r = parseInt(cleaned.slice(0, 2), 16);
            g = parseInt(cleaned.slice(2, 4), 16);
            b = parseInt(cleaned.slice(4, 6), 16);
        }
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
}
