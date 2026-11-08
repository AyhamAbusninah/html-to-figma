import type { CaptureDocument, CaptureIssue } from '@h2f/schema';

/** chrome.runtime messages handled by the service worker. */
export type WorkerRequest = { type: 'h2f:ping' } | { type: 'h2f:fetch-asset'; url: string };

export type WorkerResponse =
  { ok: true; type: 'h2f:pong'; version: string } | { ok: false; error: string };

/** What `globalThis.__h2fCapture()` resolves to in the page (returned via chrome.scripting results). */
export type CaptureResult =
  | { ok: true; document: CaptureDocument; bytes: number; durationMs: number }
  | { ok: false; stage: 'capture' | 'validate'; message: string; issues?: CaptureIssue[] };
