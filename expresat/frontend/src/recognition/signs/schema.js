/**
 * src/recognition/signs/schema.js — Esquema declarativo del catálogo de señas de LSM
 *
 * Cada seña del catálogo es un objeto declarativo con:
 * - `id`: identificador único canónico (p. ej. 'NUM_1', 'LETRA_A', 'BASE_MANO_ABIERTA')
 * - `label`: etiqueta mostrada en la UI (p. ej. '1', 'A', 'Mano Abierta')
 * - `categoria`: 'numero' | 'letra' | 'basica'
 * - `tipo`: 'estatica' | 'dinamica'
 * - `fuente`: referencia verificable ('imagenes_abecedario/a.png', '[CONAPRED-LSM]', etc.)
 * - `grupoConfundible`: uno de CONFUSABLE_GROUPS ('G1_PUNO_CERRADO' .. 'G7_MENIQUE_PULGAR')
 * - `orientacion`: { directions?: Array<'UP'|'DOWN'|'HORIZONTAL'|'OBLIQUE'|'ANY'>, palmFacing?: Array<'FRONT'|'BACK'|'SIDE'|'ANY'>, weight?: number }
 * - `dedos`: estado objetivo por dedo ('EXTENDED' | 'HOOKED' | 'CURLED' | 'NOT_EXTENDED' | 'ANY') y rangos opcionales de ángulos
 * - `contactos`: restricciones de distancia normalizada entre puntas/falanges
 * - `trayectoria`: especificación temporal en milisegundos para señas dinámicas
 * - `pesos`: pesos relativos de los componentes del score
 * - `aliases`: etiquetas equivalentes en otras categorías
 */

export const SIGN_CATEGORIES = Object.freeze({
  NUMERO: 'numero',
  LETRA: 'letra',
  BASICA: 'basica',
});

export const SIGN_TYPES = Object.freeze({
  ESTATICA: 'estatica',
  DINAMICA: 'dinamica',
});

export const CONFUSABLE_GROUPS = Object.freeze({
  G1_PUNO_CERRADO: 'G1_PUNO_CERRADO',
  G2_INDICE_SOLO: 'G2_INDICE_SOLO',
  G3_PULGAR_INDICE: 'G3_PULGAR_INDICE',
  G4_DOS_DEDOS: 'G4_DOS_DEDOS',
  G5_TRES_DEDOS: 'G5_TRES_DEDOS',
  G6_CUATRO_CINCO: 'G6_CUATRO_CINCO',
  G7_MENIQUE_PULGAR: 'G7_MENIQUE_PULGAR',
});

/**
 * Valida que una entrada del catálogo declarativo tenga todos los campos obligatorios.
 * @param {Object} entry
 * @returns {boolean}
 */
export function isValidSignEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (typeof entry.id !== 'string' || !entry.id.trim()) return false;
  if (typeof entry.label !== 'string' || !entry.label.trim()) return false;
  if (!Object.values(SIGN_CATEGORIES).includes(entry.categoria)) return false;
  if (!Object.values(SIGN_TYPES).includes(entry.tipo)) return false;
  if (typeof entry.fuente !== 'string' || !entry.fuente.trim()) return false;
  if (!Object.values(CONFUSABLE_GROUPS).includes(entry.grupoConfundible)) return false;
  if (!entry.dedos || typeof entry.dedos !== 'object') return false;
  return true;
}
