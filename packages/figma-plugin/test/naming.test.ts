/** Verification level: UNIT (Node). */
import { describe, expect, it } from 'vitest';
import { hostnameOf, placementX, rootFrameName, solidPaint } from '../src/shared/naming.ts';

describe('hostnameOf', () => {
  it.each([
    ['https://erp.arkantechjo.com/app/home', 'erp.arkantechjo.com'],
    ['http://user:pw@LOCALHOST:8085/x', 'localhost'],
    ['http://[::1]:4173/', '[::1]'],
    ['  https://a.example?q  ', 'a.example'],
    ['file:///tmp/x.html', ''],
    ['not a url', ''],
  ])('%s → %j', (url, host) => expect(hostnameOf(url)).toBe(host));
});

describe('rootFrameName (PLG-R-1)', () => {
  it('formats title — host — local date', () => {
    const capturedAt = new Date(2026, 10, 8, 14, 32).toISOString();
    expect(
      rootFrameName({
        title: '  Sales Invoice ',
        sourceUrl: 'https://erp.example/app',
        capturedAt,
      }),
    ).toBe('Sales Invoice — erp.example — 2026-11-08 14:32');
  });
  it('falls back for empty title, missing host, invalid date', () => {
    expect(rootFrameName({ title: '', sourceUrl: 'file:///x.html', capturedAt: 'garbage' })).toBe(
      'Untitled page — garbage',
    );
  });
});

describe('placementX', () => {
  it('places 100 px right of the right-most node, or at 0', () => {
    expect(placementX([])).toBe(0);
    expect(
      placementX([
        { x: 0, width: 500 },
        { x: 1000, width: 200 },
        { x: -50, width: 10 },
      ]),
    ).toBe(1300);
    expect(placementX([{ x: 10, width: 10 }], 20)).toBe(40);
  });
});

describe('solidPaint', () => {
  it('moves alpha to paint opacity', () => {
    expect(solidPaint({ r: 0.1, g: 0.2, b: 0.3, a: 0.4 })).toEqual({
      type: 'SOLID',
      color: { r: 0.1, g: 0.2, b: 0.3 },
      opacity: 0.4,
    });
  });
});
