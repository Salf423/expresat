/**
 * src/ui/drawLandmarks.js — Renderizado rápido en Canvas 2D del video y landmarks de manos/pose
 *
 * [CONTRATO DE ENTRADA Y TRANSFORMACIÓN DE COORDENADAS]
 * - El detector `HandLandmarker.detectForVideo(video, timestamp)` recibe DIRECTAMENTE el elemento
 *   HTMLVideoElement (imagen nativa del sensor, sin transformaciones ni espejo).
 * - En cámara frontal (selfie), la mano derecha física del firmante aparece a la izquierda de la
 *   imagen capturada por el sensor, por lo que MediaPipe le asigna `categoryName: 'Left'`.
 * - El espejo horizontal se realiza EXCLUSIVAMENTE en este canvas de renderizado mediante
 *   `ctx.translate(w, 0); ctx.scale(-1, 1)` para que el usuario se vea reflejado naturalmente.
 * - Los diagnósticos de texto (Punto 5) se renderizan en espacio de pantalla des-espejado
 *   para garantizar perfecta legibilidad visual.
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
  [20, 21],
]);

export const UPPER_POSE_CONNECTIONS = Object.freeze([
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
]);

/**
 * Dibuja un badge de texto diagnóstico legible (Punto 5).
 */
function drawDiagnosticBadge(ctx, text, x, y, bgColor = 'rgba(15, 23, 42, 0.90)', borderColor = '#38bdf8') {
  ctx.save();
  ctx.font = 'bold 11px monospace, system-ui, sans-serif';
  const metrics = ctx.measureText(text);
  const padX = 6;
  const bw = metrics.width + padX * 2;
  const bh = 18;
  const bx = Math.max(4, Math.min(x - bw / 2, ctx.canvas.width - bw - 4));
  const by = Math.max(4, y - bh - 6);

  ctx.fillStyle = bgColor;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(bx, by, bw, bh, 4);
  } else {
    ctx.rect(bx, by, bw, bh);
  }
  ctx.fill();

  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, bx + padX, by + bh / 2);
  ctx.restore();
}

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
  const ctx =
    canvas.__expresatCtx2d ||
    (canvas.__expresatCtx2d =
      canvas.getContext('2d', { alpha: false, desynchronized: true }) ||
      canvas.getContext('2d'));
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  const hasVideo = Boolean(video && video.readyState >= 2);

  ctx.save();
  if (!hasVideo) {
    ctx.fillStyle = '#07090f';
    ctx.fillRect(0, 0, w, h);
  }

  // Espejar horizontalmente para el usuario (modo selfie)
  ctx.translate(w, 0);
  ctx.scale(-1, 1);

  if (hasVideo) {
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

  // Restaurar el contexto espejado para dibujar los textos diagnósticos sin invertir
  ctx.restore();

  // ─── Superposición de Diagnóstico Visual (Punto 5) ────────────────────────
  // Se proyecta a espacio de pantalla: x_screen = (1 - x_norm) * w
  if (frameData) {
    // 1. Rótulos de muñecas de pose P15 y P16
    if (Array.isArray(frameData.pose) && frameData.pose.length > 16) {
      const p15 = frameData.pose[15];
      const p16 = frameData.pose[16];
      if (p15 && (p15.visibility ?? 1) > 0.3) {
        const sx = (1.0 - p15.x) * w;
        const sy = p15.y * h;
        drawDiagnosticBadge(ctx, 'P15 (Muñeca Izq)', sx, sy, 'rgba(16, 185, 129, 0.90)', '#10B981');
      }
      if (p16 && (p16.visibility ?? 1) > 0.3) {
        const sx = (1.0 - p16.x) * w;
        const sy = p16.y * h;
        drawDiagnosticBadge(ctx, 'P16 (Muñeca Der)', sx, sy, 'rgba(59, 130, 246, 0.90)', '#3B82F6');
      }
    }

    // 2. Rótulos de manos: categoryName y bloque anatómico asignado
    if (Array.isArray(frameData.hands)) {
      for (let hIdx = 0; hIdx < frameData.hands.length; hIdx++) {
        const hand = frameData.hands[hIdx];
        if (!Array.isArray(hand) || hand.length < 21) continue;
        const wrist = hand[0];
        if (!wrist) continue;

        const catItem = frameData.handedness?.[hIdx]?.[0] || frameData.raw?.handedness?.[hIdx]?.[0];
        const catName = catItem?.categoryName || catItem?.label || 'Unknown';
        const assignedSlot =
          catName === 'Left'
            ? 'Der [115..177]'
            : catName === 'Right'
            ? 'Izq [52..114]'
            : 'Pendiente';

        const sx = (1.0 - wrist.x) * w;
        const sy = wrist.y * h;
        const borderColor = catName === 'Left' ? '#F59E0B' : '#EC4899';
        drawDiagnosticBadge(
          ctx,
          `MP: ${catName} ➔ Slot: ${assignedSlot}`,
          sx,
          sy,
          'rgba(15, 23, 42, 0.90)',
          borderColor
        );
      }
    }
  }
}
