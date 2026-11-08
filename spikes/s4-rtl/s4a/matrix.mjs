/**
 * S4-A test matrix, read DIRECTLY from the S4 spike plugin (spikes/s4-rtl/code.js) so the strings, fonts, sizes and
 * cases can never drift from the original S4 matrix. Only the constants section (before `function progress`) is
 * evaluated, in an isolated vm context with no `figma` global.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

export const CODE_JS = fileURLToPath(new URL('../code.js', import.meta.url));
export const UI_HTML = fileURLToPath(new URL('../ui.html', import.meta.url));

export function loadMatrix() {
  const src = readFileSync(CODE_JS, 'utf8');
  const end = src.indexOf('function progress');
  if (end < 0) throw new Error('code.js layout changed: constants section not found');
  const ctx = {};
  vm.runInNewContext(
    `${src.slice(0, end)}
     globalThis.__m = { SPIKE_VERSION, FONT_SIZE, LINE_HEIGHT, BOX_W, ARABIC_FONTS, RLM, ZWNJ,
                        BIDI_CASES, SHAPING_CASES, VISUAL_CASES, isolate };`,
    ctx,
  );
  const m = ctx.__m;
  return {
    ...m,
    // Plain copies (vm objects → JSON-safe)
    BIDI_CASES: JSON.parse(JSON.stringify(m.BIDI_CASES)),
    SHAPING_CASES: JSON.parse(JSON.stringify(m.SHAPING_CASES)),
    VISUAL_CASES: JSON.parse(JSON.stringify(m.VISUAL_CASES)),
    ARABIC_FONTS: [...m.ARABIC_FONTS],
  };
}

/** Frame/file naming convention used by the kit and the classifier. */
export const fontKey = (font) => font.replace(/\s+/g, '');
export const frameName = (font, kind) => `S4A-${fontKey(font)}-${kind}`; // kind: asIs | rlm | shaping | visual

/** Rows of the shaping frame, top to bottom. */
export function shapingRows(matrix) {
  return matrix.SHAPING_CASES.flatMap((c) => [
    { caseId: c.id, form: 'joined', text: c.joined, note: c.note },
    { caseId: c.id, form: 'isolated', text: matrix.isolate(c.joined), note: c.note },
  ]);
}

/** Rows of a bidi frame, top to bottom, for a variant. */
export function bidiRows(matrix, variant) {
  return matrix.BIDI_CASES.map((c) => ({
    caseId: c.id,
    firstStrong: c.firstStrong,
    note: c.note,
    text: variant === 'rlm' ? matrix.RLM + c.text : c.text,
    referenceText: c.text,
  }));
}

export function codepoints(s) {
  return [...s].map((ch) => `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`).join(' ');
}
