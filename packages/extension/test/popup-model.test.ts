/** Verification level: UNIT (Node). The popup DOM wiring is covered by e2e/extension.spec.ts (browser). */
import { describe, expect, it } from 'vitest';
import { kitchenSink } from '../../schema/test/samples.ts';
import {
  captureFilename,
  copyState,
  formatBytes,
  isRestrictedUrl,
  statsRows,
} from '../src/shared/popup-model.ts';

describe('isRestrictedUrl (EXT-P-6)', () => {
  it.each([
    'chrome://extensions',
    'chrome-extension://abc/popup.html',
    'devtools://devtools/bundled/x.html',
    'edge://settings',
    'view-source:https://a.example',
    'about:blank',
    'https://chromewebstore.google.com/detail/x',
    'https://chrome.google.com/webstore/detail/x',
    'https://microsoftedge.microsoft.com/addons/detail/x',
    '',
    undefined,
  ])('restricted: %j', (url) => expect(isRestrictedUrl(url)).toBe(true));

  it.each([
    'https://www.arkantechjo.com/',
    'http://localhost:4173/pages/boxes.html',
    'file:///tmp/x.html',
  ])('allowed: %j', (url) => expect(isRestrictedUrl(url)).toBe(false));
});

describe('captureFilename (EXT-O-2)', () => {
  const at = new Date(2026, 10, 8, 9, 5, 7); // local time
  it('uses the hostname and a local timestamp', () => {
    expect(captureFilename('https://erp.arkantechjo.com/app/home', at)).toBe(
      'figma-capture_erp.arkantechjo.com_20261108-090507.json',
    );
  });
  it('sanitizes and falls back', () => {
    // hostname "[::1]" → each of "[", ":", ":", "]" becomes "_"
    expect(captureFilename('http://[::1]:8080/', at)).toBe(
      'figma-capture____1__20261108-090507.json',
    );
    expect(captureFilename('not a url', at)).toBe('figma-capture_page_20261108-090507.json');
  });
});

describe('formatBytes / copyState (EXT-O-3, E-4)', () => {
  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(6.8 * 1024 * 1024)).toBe('6.8 MB');
  });
  it('disables copy above 5 MB and warns above 25 MB', () => {
    expect(copyState(5 * 1024 * 1024)).toEqual({ disabled: false, title: '', note: '' });
    expect(copyState(5 * 1024 * 1024 + 1)).toMatchObject({
      disabled: true,
      title: 'Too large to paste. Use Download.',
    });
    expect(copyState(26 * 1024 * 1024).note).toBe('Large capture: Figma import may be slow.');
  });
});

describe('statsRows (EXT-O-5)', () => {
  it('summarizes a capture', () => {
    expect(statsRows(kitchenSink(), 2048, 37)).toEqual([
      ['Size', '2.0 KB'],
      ['Document', '1280 × 2000'],
      ['Direction', 'RTL · ar'],
      ['Nodes', '6'],
      ['Warnings', '2'],
      ['Time', '37 ms'],
    ]);
  });
});

describe('restrictedMessage / friendlyError / warningSummary (popup UX)', async () => {
  const { friendlyError, restrictedMessage, warningSummary } =
    await import('../src/shared/popup-model.ts');
  it('explains restricted pages; unknown URL covers chrome pages and local files', () => {
    expect(restrictedMessage('chrome://version')).toBe(
      "Chrome doesn't allow extensions to capture this page.",
    );
    expect(restrictedMessage(undefined)).toContain('Allow access to file URLs');
  });
  it('maps raw errors to actionable messages and keeps the raw text as detail', () => {
    expect(
      friendlyError('Cannot access contents of url "file:///x.html".', 'file:///x.html').title,
    ).toContain('Allow access to file URLs');
    expect(friendlyError('Cannot access a chrome:// URL', 'chrome://x').title).toBe(
      "Chrome doesn't allow extensions to capture this page.",
    );
    expect(friendlyError('Frame with ID 0 was removed.', 'https://a.example').title).toContain(
      'Reload it',
    );
    expect(
      friendlyError(
        'Page has more than 10000 visible elements. Capture a section instead.',
        'https://a.example',
      ),
    ).toEqual({
      title: 'Page has more than 10000 visible elements. Capture a section instead.',
      detail: '',
    });
    expect(friendlyError('boom', 'https://a.example')).toEqual({
      title: 'Capture failed.',
      detail: 'boom',
    });
  });
  it('summarizes warnings by count, most frequent first, with readable labels', () => {
    expect(
      warningSummary([
        { code: 'SVG_NOT_CAPTURED', message: 'x' },
        {
          code: 'PSEUDO_ELEMENT_NOT_CAPTURED',
          message: '::before/::after content is not captured yet. (14×)',
        },
        { code: 'SVG_NOT_CAPTURED', message: 'x' },
        { code: 'SOMETHING_NEW', message: 'y' },
      ]),
    ).toEqual([
      '14 × ::before/::after decorations',
      '2 × SVG icons/graphics (placeholders)',
      '1 × SOMETHING_NEW',
    ]);
  });
});
