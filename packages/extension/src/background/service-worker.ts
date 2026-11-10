/**
 * MV3 service worker: message router for the content script's asset phase (R4).
 * - h2f:fetch-asset (EXT-I-3, Tier 2): fetch an image the page can't read (cross-origin without CORS). Works for
 *   origins the extension has host access to: the install allow-list, or every site once the user granted the
 *   optional permission. Cookies for that site are sent (credentials: include), like the page's own request.
 * - h2f:capture-visible (EXT-I-4, Tier 3): screenshot of the visible part of the sender's tab (activeTab), at most
 *   two per second (Chrome's limit).
 * Nothing is sent anywhere else; responses go back to the content script that asked.
 */
import { EXTENSION_VERSION } from '../config/version.ts';
import type { WorkerRequest, WorkerResponse } from '../shared/messages.ts';

const MAX_FETCH_BYTES = 25 * 1024 * 1024;
const CAPTURE_SPACING_MS = 600;

chrome.runtime.onInstalled.addListener((details) => {
  console.info(`[h2f] installed (${details.reason}), version ${EXTENSION_VERSION}`);
});

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function fetchAsset(url: string): Promise<WorkerResponse> {
  if (!/^https?:/i.test(url)) return { ok: false, error: 'only http(s) URLs' };
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_FETCH_BYTES) return { ok: false, error: 'too large' };
  const mime = res.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream';
  return { ok: true, type: 'h2f:asset', mime, data: base64(bytes) };
}

let lastCapture = 0;
let captureQueue: Promise<unknown> = Promise.resolve();

/** Serialized and spaced: captureVisibleTab allows at most 2 calls per second. */
function captureVisible(windowId: number): Promise<WorkerResponse> {
  const run = async (): Promise<WorkerResponse> => {
    const wait = lastCapture + CAPTURE_SPACING_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCapture = Date.now();
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    return { ok: true, type: 'h2f:screenshot', dataUrl };
  };
  const p = captureQueue.then(run, run);
  captureQueue = p.catch(() => undefined);
  return p;
}

chrome.runtime.onMessage.addListener(
  (message: WorkerRequest, sender, sendResponse: (r: WorkerResponse) => void) => {
    const fail = (e: unknown) =>
      sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
    switch (message.type) {
      case 'h2f:ping':
        sendResponse({ ok: true, type: 'h2f:pong', version: EXTENSION_VERSION });
        return false;
      case 'h2f:fetch-asset':
        fetchAsset(message.url).then(sendResponse, fail);
        return true; // async response
      case 'h2f:capture-visible':
        if (sender.tab?.windowId === undefined) {
          sendResponse({ ok: false, error: 'no sender tab' });
          return false;
        }
        captureVisible(sender.tab.windowId).then(sendResponse, fail);
        return true;
      default:
        return false;
    }
  },
);
