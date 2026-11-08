/**
 * Contract preservation and compatibility (data-integrity requirement).
 * Verification level: UNIT (Node). Covers the schema contract only, no browser or Figma behavior.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv } from 'ajv';
import { describe, expect, it } from 'vitest';
import { buildPublishedSchema, validateCapture } from '../src/index.ts';
import { kitchenSink, minimal } from './samples.ts';

const pkg = join(import.meta.dirname, '..');
const baselineText = readFileSync(join(pkg, 'contract/capture-1.0.0.schema.json'), 'utf8');
const baseline = JSON.parse(baselineText) as Record<string, unknown>;

/** Full recursive validation with the PUBLISHED schema (independent of the shallow walker in validate.ts). */
function fullSchemaValidator(schema: Record<string, unknown>) {
  const ajv = new Ajv({ allErrors: false, strict: false });
  return ajv.compile(schema);
}

describe('schema contract v1.0.0 is preserved', () => {
  it('reconstructed TypeBox source regenerates the surviving baseline exactly (semantic)', () => {
    expect(buildPublishedSchema()).toEqual(baseline);
  });

  it('...and byte-for-byte, including key order and formatting', () => {
    expect(`${JSON.stringify(buildPublishedSchema(), null, 2)}\n`).toBe(baselineText);
  });

  it('committed capture.schema.json equals the frozen baseline (v1.0.0 has not changed)', () => {
    expect(readFileSync(join(pkg, 'capture.schema.json'), 'utf8')).toBe(baselineText);
  });
});

describe('compatibility policy (SCH-8)', () => {
  const baselineValidate = fullSchemaValidator(baseline);
  const currentValidate = fullSchemaValidator(buildPublishedSchema());

  const validDocs: [string, unknown][] = [
    ['minimal', minimal()],
    ['kitchen sink (every node type, paint, effect, optional field)', kitchenSink()],
  ];

  it.each(validDocs)(
    '%s: valid under the 1.0.0 baseline, the current schema, and validateCapture',
    (_name, doc) => {
      expect(baselineValidate(doc), JSON.stringify(baselineValidate.errors)).toBe(true);
      expect(currentValidate(doc), JSON.stringify(currentValidate.errors)).toBe(true);
      expect(validateCapture(doc).ok).toBe(true);
    },
  );

  it('accepts any 1.x.y version and rejects other majors', () => {
    for (const v of ['1.0.0', '1.7.3', '1.0.99'])
      expect(validateCapture({ ...minimal(), schemaVersion: v }).ok).toBe(true);
    for (const v of ['2.0.0', '0.9.0']) {
      const r = validateCapture({ ...minimal(), schemaVersion: v });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0]?.code).toBe('UNSUPPORTED_VERSION');
    }
  });
});

describe('shallow walker agrees with the full published schema', () => {
  const full = fullSchemaValidator(buildPublishedSchema());

  const mutations: [string, (d: ReturnType<typeof kitchenSink>) => void][] = [
    [
      'negative rect width deep in tree',
      (d) => ((d.root.children[0] as { rect: { width: number } }).rect.width = -1),
    ],
    ['opacity > 1', (d) => (d.root.opacity = 2)],
    [
      'unknown blend mode',
      (d) => ((d.root.children[0] as { blendMode: string }).blendMode = 'PLUS_LIGHTER'),
    ],
    [
      'text lineCount 0',
      (d) =>
        ((d.root.children[0] as { children: { lineCount: number }[] }).children[0]!.lineCount = 0),
    ],
    [
      'gradient with one stop',
      (d) => {
        const fill = (d.root.children[0] as { fills: { stops?: unknown[] }[] }).fills[1]!;
        fill.stops = fill.stops!.slice(0, 1);
      },
    ],
    ['image asset too wide', (d) => (d.assets.images.a2!.width = 4097)],
    ['missing meta field', (d) => delete (d.meta as Partial<typeof d.meta>).userAgent],
    ['capturedAt not ISO', (d) => (d.meta.capturedAt = 'yesterday')],
    [
      'image scaleMode invalid',
      (d) => ((d.root.children[1] as { scaleMode: string }).scaleMode = 'TILE'),
    ],
    [
      'svg fallback wrong type',
      (d) => ((d.root.children[3] as { fallbackAssetId: unknown }).fallbackAssetId = 5),
    ],
  ];

  it.each(mutations)('%s → rejected by both', (_name, mutate) => {
    const doc = kitchenSink();
    mutate(doc);
    expect(full(doc)).toBe(false);
    const r = validateCapture(doc);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe('SCHEMA');
  });
});
