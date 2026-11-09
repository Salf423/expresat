/**
 * src/recognition/confusionMatrix.js — Evaluador de Matriz de Confusión Sintética y Real
 *
 * Evalúa un conjunto de muestras `{ expectedLabel, mode, frames }` contra `GeometricClassifier`,
 * contabilizando aciertos exactos, aciertos por alias homomorfo, rechazos (`LOW_CONFIDENCE`)
 * y confusiones cruzadas entre señas.
 */

import { GeometricClassifier } from './classifier.js';
import { SYNTHETIC_PRESETS, SYNTHETIC_NUMBERS, SYNTHETIC_LETTERS } from './syntheticHand.js';

/**
 * Añade jitter gaussiano/uniforme acotado a un arreglo de 21 landmarks para simular ruido real de webcam.
 *
 * @param {Array<{x:number,y:number,z:number}>} landmarks
 * @param {number} [sigma=0.002] Amplitud máxima en coordenadas normalizadas de imagen
 * @param {number} [seed=1] Semilla determinista
 */
export function addLandmarkJitter(landmarks, sigma = 0.0018, seed = 1) {
  let s = seed >>> 0;
  function nextRand() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 0xffffffff) * 2 - 1;
  }

  const out = landmarks.map((pt, idx) => {
    // Mantener WRIST y MCP con menor jitter que las falanges distales
    const factor = idx === 0 ? 0.25 : idx % 4 === 1 ? 0.35 : 0.75;
    return {
      x: Number((pt.x + nextRand() * sigma * factor).toFixed(6)),
      y: Number((pt.y + nextRand() * sigma * factor).toFixed(6)),
      z: Number(((pt.z ?? 0) + nextRand() * sigma * factor).toFixed(6)),
    };
  });

  if (landmarks.handedness) {
    Object.defineProperty(out, 'handedness', {
      value: landmarks.handedness,
      enumerable: false,
      configurable: true,
    });
  }
  if (typeof landmarks.timestampMs === 'number') {
    Object.defineProperty(out, 'timestampMs', {
      value: landmarks.timestampMs,
      enumerable: false,
      configurable: true,
    });
  }

  return out;
}

/**
 * Evalúa una lista de muestras `{ id, expectedLabel, mode, input }` y construye la matriz de confusión.
 *
 * @param {Array<{ id?: string, expectedLabel: string, mode?: string, input: any }>} samples
 * @returns {{
 *   total: number,
 *   correct: number,
 *   rejected: number,
 *   confused: number,
 *   accuracy: number,
 *   matrix: Object<string, Object<string, number>>,
 *   confusions: Array<{ expected: string, predicted: string|null, confidence: number, reason: string }>
 * }}
 */
export function evaluateConfusionMatrix(samples) {
  const matrix = {};
  const confusions = [];
  let correct = 0;
  let rejected = 0;
  let confused = 0;

  for (const sample of samples) {
    const expected = sample.expectedLabel;
    const mode = sample.mode || 'all';
    if (!matrix[expected]) matrix[expected] = {};

    const clf = new GeometricClassifier({ mode, windowMs: 750, smoothingWindow: 1, minVotes: 1 });
    let input = sample.input;
    if (!input && Array.isArray(sample.frames)) {
      input = sample.frames.map((frameObj) => {
        if (Array.isArray(frameObj)) return frameObj;
        const pts = (frameObj.landmarks || []).map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 }));
        if (frameObj.handedness) {
          Object.defineProperty(pts, 'handedness', {
            value: frameObj.handedness,
            enumerable: false,
            configurable: true,
          });
        }
        if (typeof frameObj.timestampMs === 'number') {
          Object.defineProperty(pts, 'timestampMs', {
            value: frameObj.timestampMs,
            enumerable: false,
            configurable: true,
          });
        }
        return pts;
      });
      if (input.length === 1) input = input[0];
    }
    const res = clf.predict(input);
    const predicted = res.label;
    const aliases = res.details?.aliases || [];

    const isMatch = predicted === expected || aliases.includes(expected);
    const recordedKey = isMatch ? expected : predicted || 'LOW_CONFIDENCE';
    matrix[expected][recordedKey] = (matrix[expected][recordedKey] || 0) + 1;

    if (isMatch) {
      correct++;
    } else if (!predicted) {
      rejected++;
      confusions.push({
        expected,
        predicted: null,
        confidence: res.confidence,
        reason: res.details?.reason || 'LOW_CONFIDENCE',
      });
    } else {
      confused++;
      confusions.push({
        expected,
        predicted,
        confidence: res.confidence,
        reason: res.details?.reason || 'MISMATCH',
      });
    }
  }

  const total = samples.length;
  return {
    total,
    correct,
    rejected,
    confused,
    accuracy: total > 0 ? Number((correct / total).toFixed(4)) : 0,
    matrix,
    confusions,
  };
}

/**
 * Genera el banco completo de muestras sintéticas (49 clases: 9 base + 11 números + 29 letras/dígrafos).
 */
export function buildFullSyntheticBenchmark() {
  const samples = [];

  // 1. 9 Señas base
  const baseMap = [
    ['Mano Abierta', SYNTHETIC_PRESETS.MANO_ABIERTA()],
    ['Puño', SYNTHETIC_PRESETS.PUNO()],
    ['Uno', SYNTHETIC_PRESETS.UNO()],
    ['Dos', SYNTHETIC_PRESETS.DOS()],
    ['OK / Pinza', SYNTHETIC_PRESETS.OK()],
    ['Bien', SYNTHETIC_PRESETS.BIEN()],
    ['Te Quiero', SYNTHETIC_PRESETS.TE_QUIERO()],
    ['Lunes', SYNTHETIC_PRESETS.LUNES()],
  ];
  for (const [label, input] of baseMap) {
    samples.push({ expectedLabel: label, mode: 'legacy', input });
  }
  // Hola dinámico
  const holaFrames = Array.from({ length: 12 }, (_, i) =>
    SYNTHETIC_PRESETS.MANO_ABIERTA({
      offsetX: 0.5 + 0.08 * Math.sin((i / 11) * Math.PI * 2.5),
      timestampMs: i * 40,
    })
  );
  samples.push({ expectedLabel: 'Hola', mode: 'legacy', input: holaFrames });

  // 2. 11 Números (0 a 10)
  for (const num of ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10']) {
    samples.push({
      expectedLabel: num,
      mode: 'numbers',
      input: SYNTHETIC_NUMBERS[num](),
    });
  }

  // 3. 29 Letras y dígrafos del alfabeto LSM (21 estáticas + 8 dinámicas)
  const allLetters = [
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J',
    'K', 'L', 'LL', 'M', 'N', 'Ñ', 'O', 'P', 'Q', 'R',
    'RR', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
  ];
  for (const letter of allLetters) {
    samples.push({
      expectedLabel: letter,
      mode: 'alphabet',
      input: SYNTHETIC_LETTERS[letter](),
    });
  }

  return samples;
}
