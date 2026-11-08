/** MV3 service worker: message router. Tier-2 privileged asset fetch (EXT-I-3) arrives in R4. */
import { EXTENSION_VERSION } from '../config/version.ts';
import type { WorkerRequest, WorkerResponse } from '../shared/messages.ts';

chrome.runtime.onInstalled.addListener((details) => {
  console.info(`[h2f] installed (${details.reason}), version ${EXTENSION_VERSION}`);
});

chrome.runtime.onMessage.addListener(
  (message: WorkerRequest, _sender, sendResponse: (r: WorkerResponse) => void) => {
    switch (message.type) {
      case 'h2f:ping':
        sendResponse({ ok: true, type: 'h2f:pong', version: EXTENSION_VERSION });
        return false;
      case 'h2f:fetch-asset':
        sendResponse({ ok: false, error: 'Tier-2 asset fetch is not implemented yet (P4)' });
        return false;
      default:
        return false;
    }
  },
);
