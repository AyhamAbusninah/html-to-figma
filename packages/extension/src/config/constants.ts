/**
 * Extension configuration constants (SYS-5 constants module). No site-specific selectors or URL rules here
 * except Chrome's own restricted schemes and stores, which extensions are not allowed to script (EXT-P-6).
 */

/** Global the content script exposes for the popup to call after injection. */
export const CAPTURE_GLOBAL = '__h2fCapture';

/** Pages Chrome forbids extensions to script (EXT-P-6, E-1). */
export const RESTRICTED_URL_PATTERNS: readonly RegExp[] = [
  /^chrome:\/\//i,
  /^chrome-extension:\/\//i,
  /^chrome-untrusted:\/\//i,
  /^devtools:\/\//i,
  /^edge:\/\//i,
  /^view-source:/i,
  /^about:/i,
  /^https:\/\/chromewebstore\.google\.com\//i,
  /^https:\/\/chrome\.google\.com\/webstore/i,
  /^https:\/\/microsoftedge\.microsoft\.com\/addons/i,
];

/** Size and count limits (OQ-12, EXT-O-3/4). */
export const LIMITS = {
  maxNodes: 10_000,
  clipboardMaxBytes: 5 * 1024 * 1024,
  warnBytes: 25 * 1024 * 1024,
  failBytes: 200 * 1024 * 1024,
  maxImageSide: 4096,
  maxSvgBytes: 512 * 1024,
  maxPseudoElements: 5_000,
} as const;
