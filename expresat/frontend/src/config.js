/**
 * src/config.js — Configuración centralizada y validada de ExpresaT Frontend
 *
 * ÚNICO punto de lectura de `import.meta.env.VITE_*`.
 * Valida las variables al arrancar, aplica valores por defecto seguros para el modo demo,
 * y expone qué variables opcionales faltan sin revelar secretos en consola ni UI.
 */

const rawEnv = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {};

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function parseNumber(value, defaultValue, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return defaultValue;
  return Math.min(max, Math.max(min, num));
}

function isPlaceholder(val) {
  if (!val || typeof val !== 'string') return true;
  const trimmed = val.trim();
  return (
    trimmed === '' ||
    trimmed.includes('your-project.supabase.co') ||
    trimmed.includes('your-anon-key') ||
    trimmed.includes('api.expresat.cloud')
  );
}

/**
 * Construye el objeto de configuración inmutable a partir de un entorno dado (útil para tests).
 * @param {Record<string, any>} env
 */
export function buildConfig(env = rawEnv) {
  const isProdBuild = Boolean(env.PROD);

  const apiUrlLocal = (env.VITE_API_URL_LOCAL || 'http://127.0.0.1:8000').trim();
  const apiUrlProd = isPlaceholder(env.VITE_API_URL)
    ? 'https://expresat.onrender.com'
    : env.VITE_API_URL.trim();

  const wsUrlLocal = isPlaceholder(env.VITE_WS_URL_LOCAL)
    ? 'ws://127.0.0.1:8000/ws/translate'
    : env.VITE_WS_URL_LOCAL.trim();

  const wsUrlProd = isPlaceholder(env.VITE_WS_URL_PROD)
    ? 'wss://expresat.onrender.com/ws/translate'
    : env.VITE_WS_URL_PROD.trim();

  const supabaseUrl = isPlaceholder(env.VITE_SUPABASE_URL) ? '' : env.VITE_SUPABASE_URL.trim();
  const supabaseAnonKey = isPlaceholder(env.VITE_SUPABASE_ANON_KEY)
    ? ''
    : env.VITE_SUPABASE_ANON_KEY.trim();

  const demoMode = parseBoolean(env.VITE_DEMO_MODE, true);
  const targetFps = parseNumber(env.VITE_TARGET_FPS, 20, 10, 30);
  const modelComplexity = parseNumber(env.VITE_MODEL_COMPLEXITY, 0, 0, 1);
  const enablePose = parseBoolean(env.VITE_ENABLE_POSE, false);
  const mediapipeBackend = ['tasks', 'legacy'].includes(env.VITE_MEDIAPIPE_BACKEND)
    ? env.VITE_MEDIAPIPE_BACKEND
    : 'tasks';

  const wasmPath = (env.VITE_WASM_PATH || '/wasm').trim();
  const handModelPath = (
    env.VITE_HAND_MODEL_PATH ||
    '/models/hand_landmarker.task'
  ).trim();
  const handModelFallbackUrl =
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

  const missingOptional = [];
  const warnings = [];

  if (!supabaseUrl) missingOptional.push('VITE_SUPABASE_URL');
  if (!supabaseAnonKey) missingOptional.push('VITE_SUPABASE_ANON_KEY');
  if (isPlaceholder(env.VITE_WS_URL_PROD)) {
    missingOptional.push('VITE_WS_URL_PROD');
    warnings.push(
      'VITE_WS_URL_PROD no definido o con dominio placeholder; usando fallback wss://expresat.onrender.com/ws/translate'
    );
  }
  if (isPlaceholder(env.VITE_API_URL)) {
    missingOptional.push('VITE_API_URL');
  }

  const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

  return Object.freeze({
    isProdBuild,
    demoMode,
    apiUrlLocal,
    apiUrlProd,
    wsUrlLocal,
    wsUrlProd,
    supabaseUrl,
    supabaseAnonKey,
    supabaseConfigured,
    targetFps,
    modelComplexity,
    enablePose,
    mediapipeBackend,
    wasmPath,
    handModelPath,
    handModelFallbackUrl,
    validation: Object.freeze({
      valid: true,
      missingOptional: Object.freeze(missingOptional),
      warnings: Object.freeze(warnings),
      summary:
        missingOptional.length === 0
          ? 'Configuración completa.'
          : `Modo demo navegador activo (variables opcionales sin definir: ${missingOptional.join(', ')})`,
    }),
  });
}

/**
 * Valida la configuración actual o del entorno suministrado sin exponer secretos.
 * @param {Record<string, any>} [env]
 */
export function validateConfig(env = rawEnv) {
  return buildConfig(env).validation;
}

export const CONFIG = buildConfig(rawEnv);

/**
 * Obtiene las URLs activas de API y WebSocket según el selector de entorno ('Local' | 'Cloud').
 * @param {'Local'|'Cloud'} [selectedEnv]
 */
export function getActiveEndpoints(selectedEnv) {
  let envMode = selectedEnv;
  if (!envMode && typeof window !== 'undefined' && window.localStorage) {
    try {
      envMode =
        window.localStorage.getItem('apiEnv') || window.localStorage.getItem('expresat_env');
    } catch (storageErr) {
      // Ignorar SecurityError si localStorage está bloqueado en navegación privada / iframe
      console.warn('[config] No se pudo leer localStorage para apiEnv:', storageErr);
      envMode = null;
    }
  }
  if (!envMode && typeof window !== 'undefined' && window.location) {
    const isLocalHost =
      window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    envMode = isLocalHost ? 'Local' : 'Cloud';
  }
  const useCloud = envMode ? envMode === 'Cloud' : CONFIG.isProdBuild;
  return {
    envMode: useCloud ? 'Cloud' : 'Local',
    apiUrl: useCloud ? CONFIG.apiUrlProd : CONFIG.apiUrlLocal,
    wsUrl: useCloud ? CONFIG.wsUrlProd : CONFIG.wsUrlLocal,
  };
}

export default CONFIG;
