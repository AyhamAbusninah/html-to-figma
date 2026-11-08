/**
 * Font configuration (SYS-5 constants module): every font *name* the plugin knows lives here, never inline in logic.
 * PLG-F-2..6. Values are organization-configurable.
 */

/** Family aliases applied before lookup (PLG-F-3). Keys lower-case. */
export const FONT_ALIASES: Record<string, string> = {
  intervariable: 'Inter',
  'inter var': 'Inter',
  'inter variable': 'Inter',
};

/** Generic / system families → Figma family, for text WITHOUT Arabic script (PLG-F-3). Keys lower-case. */
export const GENERIC_FAMILY_MAP: Record<string, string> = {
  'sans-serif': 'Inter',
  'system-ui': 'Inter',
  '-apple-system': 'Inter',
  blinkmacsystemfont: 'Inter',
  'segoe ui': 'Inter',
  'ui-sans-serif': 'Inter',
  helvetica: 'Inter',
  'helvetica neue': 'Inter',
  arial: 'Inter',
  serif: 'Noto Serif',
  'ui-serif': 'Noto Serif',
  monospace: 'Roboto Mono',
  'ui-monospace': 'Roboto Mono',
};

/** Families known to contain Arabic glyphs (PLG-F-6). Lower-case. */
export const ARABIC_CAPABLE = new Set([
  'tajawal',
  'cairo',
  'noto sans arabic',
  'noto kufi arabic',
  'noto naskh arabic',
  'ibm plex sans arabic',
  'almarai',
  'readex pro',
  'amiri',
]);

/** Organization preference for Arabic text when the page stack has no Arabic-capable family (PLG-F-6 steps 2–3). */
export const ARABIC_PREFERRED_DEFAULTS = ['Tajawal', 'Cairo'];

export const LAST_RESORT_LATIN = 'Inter';
export const LAST_RESORT_ARABIC = 'Noto Sans Arabic';

/** Weight → style-name variants seen in font libraries (normalized: lower-case, no spaces/hyphens). */
export const WEIGHT_STYLE_NAMES: Record<number, string[]> = {
  100: ['thin', 'hairline'],
  200: ['extralight', 'ultralight'],
  300: ['light'],
  400: ['regular', 'normal', 'book', 'roman'],
  500: ['medium'],
  600: ['semibold', 'demibold'],
  700: ['bold'],
  800: ['extrabold', 'ultrabold'],
  900: ['black', 'heavy'],
};
