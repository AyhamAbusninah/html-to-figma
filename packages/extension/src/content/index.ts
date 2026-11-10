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

async function capture(): Promise<CaptureResult> {
  const started = performance.now();
  let document;
  let textLines: Record<string, string[]>;
  try {
    await window.document.fonts.ready;
    const { snapshot, jobs } = collectPage(window);
    await resolveAssets(snapshot, jobs);
    ({ document, textLines } = buildCapture(snapshot, {
      extractorVersion: EXTENSION_VERSION,
      capturedAt: new Date().toISOString(),
    }));
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
    textLines,
    bytes: document.meta.stats.bytes,
    durationMs: Math.round(performance.now() - started),
  };
}

(globalThis as unknown as Record<string, unknown>)[CAPTURE_GLOBAL] = capture;
