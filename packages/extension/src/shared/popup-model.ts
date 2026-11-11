/** Pure popup logic (no chrome.* / DOM), unit-tested in Node. */
import type { CaptureDocument } from '@h2f/schema';
import { LIMITS, RESTRICTED_URL_PATTERNS } from '../config/constants.ts';

export function isRestrictedUrl(url: string | undefined): boolean {
  return !url || RESTRICTED_URL_PATTERNS.some((re) => re.test(url));
}

/**
 * Explanation for a page that can't be captured. Chrome hides the URL of tabs the extension may not access
 * (chrome:// pages, the Web Store, PDF viewer, local files without file access), so an unknown URL covers both cases.
 */
export function restrictedMessage(url: string | undefined): string {
  if (url) return "Chrome doesn't allow extensions to capture this page.";
  return (
    "This page can't be captured. Chrome blocks extensions on its own pages (chrome://, Web Store, PDF viewer). " +
    'For a local file, open chrome://extensions → HTML to Figma → Details and turn on "Allow access to file URLs".'
  );
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** `figma-capture_<hostname>_<YYYYMMDD-HHmmss>.json` in local time (EXT-O-2). */
export function captureFilename(sourceUrl: string, now: Date): string {
  let host = 'page';
  try {
    host = new URL(sourceUrl).hostname || 'page';
  } catch {
    /* keep fallback */
  }
  const safeHost = host.replace(/[^a-z0-9.-]/gi, '_');
  const stamp =
    `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}` +
    `-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
  return `figma-capture_${safeHost}_${stamp}.json`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Rows of the Done screen summary (EXT-O-5). */
export function statsRows(
  document: CaptureDocument,
  bytes: number,
  durationMs: number,
): [string, string][] {
  const { meta } = document;
  return [
    ['Size', formatBytes(bytes)],
    ['Document', `${meta.document.width} × ${meta.document.height}`],
    ['Direction', `${meta.direction.toUpperCase()}${meta.lang ? ` · ${meta.lang}` : ''}`],
    ['Nodes', String(meta.stats.nodeCount)],
    ['Warnings', String(meta.warnings.length)],
    ['Time', `${durationMs} ms`],
  ];
}

export interface CopyState {
  disabled: boolean;
  title: string;
  note: string;
}

/** Clipboard only up to 5 MB (EXT-O-3); warn above 25 MB (E-4). */
export function copyState(bytes: number): CopyState {
  const tooLarge = bytes > LIMITS.clipboardMaxBytes;
  return {
    disabled: tooLarge,
    title: tooLarge ? 'Too large to paste. Use Download.' : '',
    note: bytes > LIMITS.warnBytes ? 'Large capture: Figma import may be slow.' : '',
  };
}

export interface FriendlyError {
  title: string;
  detail: string;
}

/** Maps raw capture errors to actionable messages; the raw message stays available as detail. */
export function friendlyError(raw: string, url: string | undefined): FriendlyError {
  if (/^file:/i.test(url ?? '') || /Cannot access contents of url "file:/i.test(raw)) {
    return {
      title:
        'Chrome blocks extensions on local files. Open chrome://extensions → HTML to Figma → Details, turn on "Allow access to file URLs", then try again.',
      detail: raw,
    };
  }
  if (
    /Cannot access a chrome|cannot be scripted|Cannot access contents of (the page|url)|chrome-extension:/i.test(
      raw,
    )
  ) {
    return { title: "Chrome doesn't allow extensions to capture this page.", detail: raw };
  }
  if (/Frame with ID .* was removed|No tab with id|Tab was closed/i.test(raw)) {
    return {
      title: 'The page changed or was closed during capture. Reload it and try again.',
      detail: raw,
    };
  }
  if (/visible elements/i.test(raw)) return { title: raw, detail: '' };
  if (/schema validation/i.test(raw)) {
    return {
      title:
        'The capture produced an invalid file (internal error). Please report it with the details below.',
      detail: raw,
    };
  }
  return { title: 'Capture failed.', detail: raw };
}

const NOT_CAPTURED_LABELS: Record<string, string> = {
  IMAGE_NOT_CAPTURED: 'images (placeholders)',
  SVG_NOT_CAPTURED: 'SVG icons/graphics (placeholders)',
  IFRAME_NOT_CAPTURED: 'embedded frames (placeholders)',
  IMAGE_FETCH_FAILED: 'images from other sites (placeholders)',
  SVG_TOO_LARGE: 'very large SVG graphics (placeholders)',
  BACKGROUND_IMAGE_NOT_CAPTURED: 'background images',
  GRADIENT_NOT_CAPTURED: 'gradients',
  PSEUDO_ELEMENT_NOT_CAPTURED: '::before/::after decorations',
  TEXT_ELLIPSIS_NOT_APPLIED: '"…" truncation',
  NATIVE_CONTROL_APPROXIMATED: 'native checkboxes/radios (approximated)',
  TRANSFORM_UNSUPPORTED: 'rotated/scaled elements (bounding box)',
  BLEND_MODE_RASTERIZED: 'blend-mode effects (captured as pictures)',
  CLIP_MASK_UNSUPPORTED: 'clip-path shapes (shown unclipped)',
};

/** Short "not captured yet" lines for the Done screen, most frequent first (EXT-O-5). */
export function warningSummary(warnings: readonly { code: string; message: string }[]): string[] {
  const counts = new Map<string, number>();
  for (const w of warnings) {
    const n = Number(/\((\d+)×\)$/.exec(w.message)?.[1] ?? 1);
    counts.set(w.code, (counts.get(w.code) ?? 0) + n);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([code, n]) => `${n} × ${NOT_CAPTURED_LABELS[code] ?? code}`);
}

/** All-sites host access for full-quality images (EXT-P-4b). */
export const ALL_SITES: chrome.permissions.Permissions = { origins: ['<all_urls>'] };

/**
 * Done-screen offer to allow images from other sites (EXT-P-4b): only when some images came from screenshots
 * (lower quality) or are missing, and the permission isn't granted yet. '' = don't show.
 */
export function imagesNote(screenshots: number, missing: number, granted: boolean): string {
  if (granted || (screenshots === 0 && missing === 0)) return '';
  const parts = [
    screenshots
      ? `${screenshots} image${screenshots === 1 ? '' : 's'} came from screenshots (lower quality)`
      : '',
    missing ? `${missing} image${missing === 1 ? ' is' : 's are'} missing` : '',
  ].filter(Boolean);
  return `${parts.join(' and ')}. Allow the extension to read images on all sites for full quality (Chrome asks once); it then captures again.`;
}
