/**
 * Known `meta.warnings[].code` values (REQUIREMENTS §3). The schema accepts any string so producers can add codes
 * without a major version bump. Consumers must render unknown codes generically.
 */
export const WARNING_CODES = {
  IMAGE_FETCH_FAILED: 'All image tiers failed; rendered as placeholder (EXT-I-5)',
  IFRAME_CROSS_ORIGIN: 'Cross-origin iframe replaced by a placeholder (EXT-T-7)',
  TRANSFORM_UNSUPPORTED: 'Non-translation transform captured as its bounding box (EXT-G-3)',
  DOM_MUTATED_DURING_CAPTURE: 'The page changed while it was being read (EXT-C-3)',
  GRADIENT_UNSUPPORTED: 'Repeating/conic gradient replaced by its first stop (EXT-V-3)',
  FILTER_UNSUPPORTED: 'CSS filter other than blur ignored (EXT-V-9)',
  CLIP_MASK_RASTERIZED: 'clip-path/mask element rasterized (EXT-V-10)',
  CLIP_MASK_UNSUPPORTED: 'clip-path/mask ignored (EXT-V-10)',
  SVG_TOO_LARGE: 'SVG above the size limit emitted as raster (EXT-S-6)',
  SCROLL_AREAS_EXPANDED: 'Inner scroll areas were expanded for capture (EXT-C-6)',
  PSEUDO_LIMIT: 'Pseudo-element limit reached; remaining ones skipped (EXT-T-11)',
  ARABIC_LETTER_SPACING_IGNORED: 'letter-spacing set to 0 on Arabic text (EXT-RTL-5)',
  // R2 MVP slice: features explicitly not captured yet (rendered as placeholders or approximated)
  IMAGE_NOT_CAPTURED:
    '<img>/<canvas>/<video>/<object>/<embed> content not captured yet; placeholder (R4)',
  SVG_NOT_CAPTURED: 'Inline <svg> not captured yet; placeholder (R4)',
  IFRAME_NOT_CAPTURED: '<iframe> content not captured; placeholder',
  BACKGROUND_IMAGE_NOT_CAPTURED: 'CSS background images not captured yet (R4)',
  GRADIENT_NOT_CAPTURED: 'CSS gradients not captured yet',
  PSEUDO_ELEMENT_NOT_CAPTURED: '::before/::after content not captured yet',
  NATIVE_CONTROL_APPROXIMATED: 'Native checkbox/radio/range/etc. approximated by box styles',
  BORDER_STYLE_DEGRADED: 'double/groove/ridge/inset/outset borders rendered as solid',
  BLEND_MODE_UNSUPPORTED: 'Unmappable mix-blend-mode ignored',
  BLEND_MODE_RASTERIZED:
    'Element with mix-blend-mode captured as a picture of how it looks (EXT-V-10)',
  TEXT_ELLIPSIS_NOT_APPLIED:
    'text-overflow: ellipsis not reproduced; text clipped without "…" (EXT-X-8)',
} as const;

export type WarningCode = keyof typeof WARNING_CODES;
