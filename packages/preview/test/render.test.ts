/** Preview renderer (plugin RenderPlan → HTML). Verification level: UNIT (Node). Not a Figma rendering. */
import { describe, expect, it } from 'vitest';
import { buildPlan } from '@h2f/figma-plugin/plan';
import { KNOWN_FIGMA_FONTS } from '@h2f/figma-plugin/known-figma-fonts';
import { kitchenSink, minimal } from '../../schema/test/samples.ts';
import { fontStylesheets, planCounts, renderPlanHtml, rgba } from '../src/render.ts';

const plan = buildPlan(kitchenSink(), KNOWN_FIGMA_FONTS);
const html = renderPlanHtml(plan);
const count = (re: RegExp) => (html.match(re) ?? []).length;

describe('renderPlanHtml', () => {
  it('renders exactly the layers of the plugin plan (same plan the Figma adapter executes)', () => {
    expect(planCounts(plan)).toEqual({
      frame: 2,
      rect: 0,
      text: 1,
      placeholder: 1,
      image: 1,
      svg: 1,
    });
    expect(count(/class="n /g)).toBe(6);
    expect(count(/data-kind="text"/g)).toBe(1);
    expect(count(/data-kind="placeholder"/g)).toBe(1);
  });

  it('captured images and SVGs are drawn as <img> (pixels with object-fit and radii; SVG as a data URL)', () => {
    expect(html).toMatch(
      /<img class="n media" data-kind="image" data-id="n3"[^>]*src="data:image\/jpeg;base64,\/9j\/" style="[^"]*border-radius:32px 32px 32px 32px;object-fit:contain;"/,
    );
    expect(html).toMatch(
      /data-kind="svg" data-id="n5"[^>]*src="data:image\/svg\+xml;charset=utf-8,%3Csvg%20xmlns/,
    );
  });

  it('uses parent-relative coordinates and sizes from the plan', () => {
    expect(html).toMatch(/data-id="n1"[^>]*style="left:10px;top:20px;width:300px;height:200px;/);
    expect(html).toMatch(/data-id="n2"[^>]*style="left:10px;top:10px;width:200px;/);
  });

  it('box styles: fills, per-side borders, radii, shadows back in CSS order, blur, opacity, blend, clipping', () => {
    const card = /data-id="n1"[^>]*style="([^"]*)"/.exec(html)![1]!;
    // Fills bottom → top become CSS layers top first: image, radial, linear, then the solid color.
    expect(card).toContain(
      'background:url(data:image/png;base64,iVBORw0KGgo=) 0 0/100% 100% no-repeat,radial-gradient(50% 25% at 50% 120%,',
    );
    expect(card).toContain('linear-gradient(rgba(26,51,77,0.4),rgba(26,51,77,0.4));');
    expect(card).toContain('border-radius:8px 8px 0px 100px;');
    // Strokes are an overlay (no layout effect), not a CSS border on the box itself.
    expect(card).not.toContain('border-width');
    expect(html).toMatch(
      /data-id="n1"[^>]*><div class="stroke" style="border-style:dashed;border-color:rgba\(0,0,0,1\);border-width:1px 2px 0px 1.5px;"><\/div>/,
    );
    expect(card).toContain(
      'box-shadow:0px 4px 12px -2px rgba(0,0,0,1),inset 1px 1px 0px 0px rgba(0,0,0,1);',
    );
    expect(card).toContain('filter:blur(2px);');
    expect(card).toContain('opacity:0.5;');
    expect(card).toContain('mix-blend-mode:multiply;');
    expect(card).not.toContain('overflow:hidden');
  });

  it('text keeps its RTL direction, font choice, alignment and single-line behavior', () => {
    const t = /<div class="n text"([^>]*)>([^<]*)</.exec(html)!;
    expect(t[1]).toContain('dir="rtl"');
    expect(t[1]).toContain("font-family:'Tajawal',sans-serif;font-weight:700;");
    expect(t[1]).toContain('text-align:right;');
    expect(t[1]).toContain('white-space:pre;');
    expect(t[2]).toBe('فاتورة INV-2026-00042');
  });

  it('placeholders show the reason; markup is escaped', () => {
    expect(html).toContain('image not captured</span>');
    const doc = minimal();
    doc.root.children = [
      { ...kitchenSink().root.children[3]!, name: '<script>x</script>' } as never,
    ];
    expect(renderPlanHtml(buildPlan(doc, KNOWN_FIGMA_FONTS))).not.toContain('<script>');
  });
});

describe('helpers', () => {
  it('rgba() converts 0–1 channels', () => {
    expect(rgba({ color: { r: 1, g: 0.5, b: 0 }, opacity: 0.25 })).toBe('rgba(255,128,0,0.25)');
  });
  it('fontStylesheets(): one Google Fonts URL per family with the needed weights', () => {
    expect(fontStylesheets(plan)).toEqual([
      'https://fonts.googleapis.com/css2?family=Tajawal:ital,wght@0,700&display=swap',
    ]);
  });
});
