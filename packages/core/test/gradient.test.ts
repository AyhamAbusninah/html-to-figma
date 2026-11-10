/** CSS background-image layers and gradients (EXT-V-3). Verification level: UNIT (Node). */
import { describe, expect, it } from 'vitest';
import { backgroundUrls, parseBackgroundLayers } from '../src/gradient.ts';

const c = (r: number, g: number, b: number, a = 1) => ({
  r: Math.round((r / 255) * 1e4) / 1e4,
  g: Math.round((g / 255) * 1e4) / 1e4,
  b: Math.round((b / 255) * 1e4) / 1e4,
  a,
});

describe('parseBackgroundLayers', () => {
  it('linear: angle, default direction, stops with and without positions', () => {
    expect(
      parseBackgroundLayers(
        'linear-gradient(135deg, rgb(99, 102, 241) 0%, rgb(236, 72, 153) 100%)',
        200,
        100,
      ),
    ).toEqual([
      {
        kind: 'paint',
        paint: {
          type: 'GRADIENT_LINEAR',
          angleDeg: 135,
          stops: [
            { position: 0, color: c(99, 102, 241) },
            { position: 1, color: c(236, 72, 153) },
          ],
        },
      },
    ]);
    const [l] = parseBackgroundLayers(
      'linear-gradient(rgb(255, 0, 0), rgb(0, 255, 0), rgb(0, 0, 255))',
      10,
      10,
    );
    expect(l).toMatchObject({
      paint: { angleDeg: 180, stops: [{ position: 0 }, { position: 0.5 }, { position: 1 }] },
    });
  });

  it('linear: side and corner keywords (corners follow the box aspect), px stops, double positions, hints', () => {
    const angle = (v: string, w = 200, h = 100) =>
      (parseBackgroundLayers(v, w, h)[0] as { paint: { angleDeg: number } }).paint.angleDeg;
    expect(angle('linear-gradient(to right, rgb(0, 0, 0), rgb(255, 255, 255))')).toBe(90);
    expect(angle('linear-gradient(to top right, rgb(0, 0, 0), rgb(255, 255, 255))', 100, 100)).toBe(
      45,
    );
    expect(
      angle('linear-gradient(to bottom left, rgb(0, 0, 0), rgb(255, 255, 255))', 100, 100),
    ).toBe(225);
    expect(
      angle('linear-gradient(to top right, rgb(0, 0, 0), rgb(255, 255, 255))', 200, 100),
    ).toBeCloseTo(26.5651, 3);
    const [l] = parseBackgroundLayers(
      'linear-gradient(to right, rgb(0, 0, 0) 50px, rgb(255, 0, 0) 20% 60%, 70%, rgba(0, 0, 0, 0))',
      200,
      100,
    );
    expect(
      (l as { paint: { stops: { position: number }[] } }).paint.stops.map((s) => s.position),
    ).toEqual([0.25, 0.25, 0.6, 1]);
  });

  it('radial: default ellipse farthest-corner, circle at a position, explicit sizes', () => {
    const [e] = parseBackgroundLayers(
      'radial-gradient(rgb(255, 255, 255), rgb(37, 99, 235))',
      200,
      100,
    );
    expect(e).toMatchObject({
      paint: {
        type: 'GRADIENT_RADIAL',
        center: { x: 0.5, y: 0.5 },
        radius: { x: 0.7071, y: 0.7071 },
      },
    });
    const [ci] = parseBackgroundLayers(
      'radial-gradient(circle at 30% 30%, rgb(255, 255, 255) 0%, rgb(37, 99, 235) 100%)',
      100,
      100,
    );
    expect(ci).toMatchObject({
      paint: { center: { x: 0.3, y: 0.3 }, radius: { x: 0.9899, y: 0.9899 } },
    });
    const [ex] = parseBackgroundLayers(
      'radial-gradient(40px 20px at left top, rgb(0, 0, 0), rgb(255, 255, 255))',
      200,
      100,
    );
    expect(ex).toMatchObject({ paint: { center: { x: 0, y: 0 }, radius: { x: 0.2, y: 0.2 } } });
  });

  it('layers top first; url layers indexed; repeating/conic fall back to their first color', () => {
    const layers = parseBackgroundLayers(
      'linear-gradient(rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.5)), url("https://x/a.jpg"), conic-gradient(rgb(255, 0, 0), rgb(0, 0, 255)), url("b.png")',
      100,
      100,
    );
    expect(layers.map((l) => l.kind)).toEqual(['paint', 'url', 'unsupported', 'url']);
    expect(layers[1]).toEqual({ kind: 'url', urlIndex: 0 });
    expect(layers[3]).toEqual({ kind: 'url', urlIndex: 1 });
    expect(layers[2]).toEqual({ kind: 'unsupported', fallback: c(255, 0, 0) });
    expect(parseBackgroundLayers('none', 1, 1)).toEqual([]);
  });

  it('backgroundUrls: the url() values in order', () => {
    expect(
      backgroundUrls(
        'url("https://x/a.jpg"), linear-gradient(rgb(0, 0, 0), rgb(1, 1, 1)), url(b.png)',
      ),
    ).toEqual([
      { url: 'https://x/a.jpg', layer: 0 },
      { url: 'b.png', layer: 2 },
    ]);
  });
});
