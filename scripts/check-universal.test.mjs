/** Verification level: UNIT (Node). */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scanRepo, scanSource } from './check-universal.mjs';

describe('check-universal (SYS-6)', () => {
  it('flags benchmark-specific tokens', () => {
    const v = scanSource(
      'x.ts',
      "if (window.frappe) {}\nconst ok = 1;\nconst cls = 'awesomplete';\nlabel('Desk view');",
    );
    expect(v.map((x) => x.line)).toEqual([1, 3, 4]);
  });

  it('does not flag words merely containing "desk" (e.g. desktop)', () => {
    expect(scanSource('x.ts', "const ua = 'desktop';")).toEqual([]);
  });

  it('flags class/id selector literals in query APIs, not tag or attribute selectors', () => {
    const src = [
      "el.querySelector('.indicator-pill')",
      'el.querySelectorAll("#sidebar a")',
      'el.closest(`.list-row`)',
      "el.matches('#x')",
      "el.querySelectorAll('svg use')",
      "el.querySelector('[data-testid]')",
      "document.getElementById('capture')",
    ].join('\n');
    expect(scanSource('x.ts', src).map((x) => x.line)).toEqual([1, 2, 3, 4]);
  });

  it('honors the exemption comment on the same or previous line', () => {
    const src = [
      '// h2f-universal-exempt: overlay UI we own',
      "root.querySelector('.h2f-overlay')",
      "root.querySelector('.h2f-badge') // h2f-universal-exempt: our own panel",
      "root.querySelector('.not-exempt')",
    ].join('\n');
    expect(scanSource('x.ts', src).map((x) => x.line)).toEqual([4]);
  });

  it('the repository engine sources are currently clean', () => {
    const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
    const { files, violations } = scanRepo(root);
    expect(files).toBeGreaterThan(10);
    expect(violations).toEqual([]);
  });
});
