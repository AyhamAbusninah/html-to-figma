/**
 * Content script, injected on demand by the popup (EXT-P-5) and built as a single IIFE.
 * Exposes `globalThis.__h2fCapture()`, which the popup calls via chrome.scripting.executeScript.
 *
 * R2 slice 1: full traversal (collector) → conversion (@h2f/core) → validation.
 */
import { buildCapture } from '@h2f/core';
import { validateCapture } from '@h2f/schema';
import { CAPTURE_GLOBAL } from '../config/constants.ts';
import { EXTENSION_VERSION } from '../config/version.ts';
import type { CaptureResult } from '../shared/messages.ts';
import { resolveAssets } from './assets.ts';
import { collectPage } from './collect.ts';
import { settle } from './settle.ts';

/**
 * The page is captured as it looks scrolled to the top (EXT-T-9, AC-EXT-7): fixed and sticky elements (headers, "back to
 * top" bars, sticky section titles) are read where they sit at the top instead of where the user had scrolled, and
 * overlays that only appear after scrolling are not shown. Waits for the page's scroll handlers and the transitions
 * they start (≤ 1 s). Returns the function that scrolls back to where the user was.
 */
async function scrollToTop(): Promise<() => void> {
  const x = window.scrollX;
  const y = window.scrollY;
  if (y === 0) return () => {};
  window.scrollTo({ left: x, top: 0, behavior: 'instant' });
  await settle(1000);
  return () => window.scrollTo({ left: x, top: y, behavior: 'instant' });
}

async function capture(): Promise<CaptureResult> {
  const started = performance.now();
  let document;
  let textLines: Record<string, string[]>;
  let restoreScroll = () => {};
  try {
    await window.document.fonts.ready;
    restoreScroll = await scrollToTop();
    const { snapshot, jobs, pinned } = await collectPage(window);
    await resolveAssets(snapshot, jobs, pinned);
    ({ document, textLines } = buildCapture(snapshot, {
      extractorVersion: EXTENSION_VERSION,
      capturedAt: new Date().toISOString(),
    }));
  } catch (e) {
    return { ok: false, stage: 'capture', message: e instanceof Error ? e.message : String(e) };
  } finally {
    restoreScroll();
  }

  const result = validateCapture(document);
  if (!result.ok) {
    return {
      ok: false,
      stage: 'validate',
      message: 'Capture failed schema validation',
      issues: result.errors,
    };
  }
  document.meta.stats.bytes = new TextEncoder().encode(JSON.stringify(document)).length;
  return {
    ok: true,
    document,
    textLines,
    bytes: document.meta.stats.bytes,
    durationMs: Math.round(performance.now() - started),
  };
}

(globalThis as unknown as Record<string, unknown>)[CAPTURE_GLOBAL] = capture;
