/** Pure popup logic (no chrome.* / DOM), unit-tested in Node. */
import type { CaptureDocument } from '@h2f/schema';
import { LIMITS, RESTRICTED_URL_PATTERNS } from '../config/constants.ts';

export function isRestrictedUrl(url: string | undefined): boolean {
  return !url || RESTRICTED_URL_PATTERNS.some((re) => re.test(url));
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
