/**
 * Content script, injected on demand by the popup (EXT-P-5) and built as a single IIFE.
 * Exposes `globalThis.__h2fCapture()`, which the popup calls via chrome.scripting.executeScript.
 *
 * R0: walking skeleton (meta + root frame). Traversal arrives in R2.
 */
import { buildCaptureDocument } from '@h2f/core';
import { validateCapture } from '@h2f/schema';
import { CAPTURE_GLOBAL } from '../config/constants.ts';
import { EXTENSION_VERSION } from '../config/version.ts';
import type { CaptureResult } from '../shared/messages.ts';
import { collectPageSnapshot } from './collect.ts';

async function capture(): Promise<CaptureResult> {
  const started = performance.now();
  let document;
  try {
    await window.document.fonts.ready;
    document = buildCaptureDocument(collectPageSnapshot(window), {
      extractorVersion: EXTENSION_VERSION,
      capturedAt: new Date().toISOString(),
    });
  } catch (e) {
    return { ok: false, stage: 'capture', message: e instanceof Error ? e.message : String(e) };
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
    bytes: document.meta.stats.bytes,
    durationMs: Math.round(performance.now() - started),
  };
}

(globalThis as unknown as Record<string, unknown>)[CAPTURE_GLOBAL] = capture;
