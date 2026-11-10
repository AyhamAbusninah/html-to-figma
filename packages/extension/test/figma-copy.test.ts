/** Copy to Figma (EXT-O-7) in the popup. Verification level: UNIT (Node). */
import { describe, expect, it } from 'vitest';
import { minimal } from '../../schema/test/samples.ts';
import { figmaCopyNote, figmaSvg } from '../src/shared/figma-copy.ts';

describe('Copy to Figma', () => {
  it('turns a CaptureDocument into one SVG with a named background', () => {
    const r = figmaSvg(minimal(), {});
    expect(r.svg).toMatch(
      /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="1280" height="2000"/,
    );
    expect(r.svg).toContain('<rect id="Background"');
    expect(r.stats).toEqual({ boxes: 0, texts: 0, placeholders: 0, lines: 0 });
  });

  it('note: how to paste, a large-page hint, and what was approximated', () => {
    expect(figmaCopyNote(1000, [], '1000 B')).toBe(
      'Copied for Figma (1000 B). In Figma: click the canvas, press Esc, then Ctrl+V.',
    );
    expect(figmaCopyNote(20 * 1024 * 1024, ['inner shadows'], '20.0 MB')).toBe(
      'Copied for Figma (20.0 MB). In Figma: click the canvas, press Esc, then Ctrl+V. Large page: the paste may take a while. Approximated: inner shadows.',
    );
  });
});
