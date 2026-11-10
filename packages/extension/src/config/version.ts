/**
 * Must match public/manifest.json `version` and package.json `version` (asserted by tests).
 * Kept in its own module so the service worker bundles it inline instead of sharing a chunk with the popup.
 */
export const EXTENSION_VERSION = '0.3.0';
