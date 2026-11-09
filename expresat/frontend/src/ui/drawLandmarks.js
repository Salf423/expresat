/**
 * src/ui/drawLandmarks.js — Renderizado rápido en Canvas 2D del video y landmarks de manos/pose
 *
 * Diseñado para ser ligero en CPU/iGPU (Ryzen 3 7320U).
 */

export const HAND_CONNECTIONS = Object.freeze([
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
]);

export const UPPER_POSE_CONNECTIONS = Object.freeze([
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
]);

/**
 * Dibuja el frame de video espejado horizontalmente y superpone los landmarks o el LandmarkTracker.
 *
 * @param {Object} params
 * @param {HTMLCanvasElement} params.canvas
 * @param {HTMLVideoElement} params.video
 * @param {Object|null} params.frameData `{ hands, handedness, pose }`
 * @param {Object|null} params.tracker Instancia opcional de LandmarkTracker
 * @param {Object|null} params.trackingConfig Configuración visual opcional
 */
export function renderCanvasFrame({
  canvas,
  video,
  frameData,
  tracker = null,
  trackingConfig = null,
}) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;

  ctx.save();
  ctx.clearRect(0, 0, w, h);

  // Espejar horizontalmente (modo selfie)
  ctx.translate(w, 0);
  ctx.scale(-1, 1);

  if (video && video.readyState >= 2) {
    ctx.drawImage(video, 0, 0, w, h);
  }

  if (frameData) {
    if (trackingConfig?.enabled && tracker) {
      tracker.render(ctx, frameData, w, h, trackingConfig);
    } else {
      // Renderizado directo ultraligero de manos y pose superior
      if (Array.isArray(frameData.pose) && frameData.pose.length > 16) {
        ctx.strokeStyle = '#06B6D4';
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (const [i, j] of UPPER_POSE_CONNECTIONS) {
          const a = frameData.pose[i];
          const b = frameData.pose[j];
          if (a && b && (a.visibility ?? 1) > 0.3 && (b.visibility ?? 1) > 0.3) {
            ctx.moveTo(a.x * w, a.y * h);
            ctx.lineTo(b.x * w, b.y * h);
          }
        }
        ctx.stroke();
      }

      if (Array.isArray(frameData.hands)) {
        for (let hIdx = 0; hIdx < frameData.hands.length; hIdx++) {
          const hand = frameData.hands[hIdx];
          if (!Array.isArray(hand) || hand.length < 21) continue;

          ctx.strokeStyle = hIdx === 0 ? '#A855F7' : '#EC4899';
          ctx.lineWidth = 3;
          ctx.beginPath();
          for (const [aIdx, bIdx] of HAND_CONNECTIONS) {
            const a = hand[aIdx];
            const b = hand[bIdx];
            if (a && b) {
              ctx.moveTo(a.x * w, a.y * h);
              ctx.lineTo(b.x * w, b.y * h);
            }
          }
          ctx.stroke();

          ctx.fillStyle = '#FFFFFF';
          for (let i = 0; i < 21; i++) {
            const pt = hand[i];
            if (!pt) continue;
            ctx.beginPath();
            ctx.arc(pt.x * w, pt.y * h, i % 4 === 0 ? 4.5 : 3, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
  }

  ctx.restore();
}
