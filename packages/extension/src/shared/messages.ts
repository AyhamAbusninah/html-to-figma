import type { CaptureDocument, CaptureIssue } from '@h2f/schema';

/** chrome.runtime messages handled by the service worker. */
export type WorkerRequest =
  { type: 'h2f:ping' } | { type: 'h2f:fetch-asset'; url: string } | { type: 'h2f:capture-visible' };

export type WorkerResponse =
  | { ok: true; type: 'h2f:pong'; version: string }
  /** Tier 2: the fetched bytes, base64. */
  | { ok: true; type: 'h2f:asset'; mime: string; data: string }
  /** Tier 3: PNG data URL of the visible part of the tab. */
  | { ok: true; type: 'h2f:screenshot'; dataUrl: string }
  | { ok: false; error: string };

/** What `globalThis.__h2fCapture()` resolves to in the page (returned via chrome.scripting results). */
export type CaptureResult =
  | {
      ok: true;
      document: CaptureDocument;
      /** The page's line breaks of multi-line TEXT nodes, by node id (for Copy to Figma; not in the file). */
      textLines: Record<string, string[]>;
      bytes: number;
      durationMs: number;
    }
  | { ok: false; stage: 'capture' | 'validate'; message: string; issues?: CaptureIssue[] };
