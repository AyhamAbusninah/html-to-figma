/** validateCapture / parseCaptureJson behavior. Verification level: UNIT (Node). */
import { describe, expect, it } from 'vitest';
import { parseCaptureJson, validateCapture, type CaptureIssue } from '../src/index.ts';
import { kitchenSink, minimal } from './samples.ts';

function issues(input: unknown, maxErrors?: number): CaptureIssue[] {
  const r = validateCapture(input, maxErrors === undefined ? {} : { maxErrors });
  return r.ok ? [] : r.errors;
}

describe('validateCapture', () => {
  it('accepts valid documents and returns them', () => {
    const doc = kitchenSink();
    const r = validateCapture(doc);
    expect(r).toEqual({ ok: true, document: doc });
  });

  it('UNSUPPORTED_VERSION short-circuits with a clear message (E-8)', () => {
    expect(issues({ schemaVersion: '2.0.0', garbage: true })).toEqual([
      {
        code: 'UNSUPPORTED_VERSION',
        path: '/schemaVersion',
        message: 'Capture made with schema v2.0.0. This version supports v1.x. Please update.',
      },
    ]);
  });

  it('SCHEMA on the shell reports the first missing property', () => {
    const { root: _root, ...noRoot } = minimal();
    expect(issues(noRoot)).toEqual([
      { code: 'SCHEMA', path: '/', message: 'missing required property "root"' },
    ]);
    expect(issues('not an object')[0]).toMatchObject({
      code: 'SCHEMA',
      path: '/',
      message: 'must be object',
    });
  });

  it('ROOT_NOT_FRAME', () => {
    const doc = minimal() as unknown as { root: unknown };
    doc.root = { ...kitchenSink().root.children[1] };
    expect(issues(doc)).toEqual([
      { code: 'ROOT_NOT_FRAME', path: '/root', message: 'root must be a FRAME node' },
    ]);
  });

  it('SCHEMA on a nested node reports a JSON pointer into the tree', () => {
    const doc = kitchenSink();
    (
      doc.root.children[0] as { children: { style: { fontSize: number } }[] }
    ).children[0]!.style.fontSize = 0;
    expect(issues(doc)).toEqual([
      {
        code: 'SCHEMA',
        path: '/root/children/0/children/0/style/fontSize',
        message: 'must be > 0',
      },
    ]);
  });

  it('union members report the FIRST branch error (preserved 0.1.0 behavior; known UX limitation, R3)', () => {
    // An IMAGE paint with an invalid scaleMode fails every member of the Paint union. Ajv lists the SOLID branch's
    // error first, so the message is misleading. Recorded in docs/verification/R0.md (open issue R0-4).
    const doc = kitchenSink();
    (doc.root.children[0] as { fills: { scaleMode?: string }[] }).fills[3]!.scaleMode = 'FIT';
    expect(issues(doc)[0]).toEqual({
      code: 'SCHEMA',
      path: '/root/children/0/fills/3',
      message: 'missing required property "color"',
    });
  });

  it('UNKNOWN_NODE_TYPE and non-object nodes', () => {
    const doc = minimal() as unknown as { root: { children: unknown[] } };
    doc.root.children = [{ type: 'VIDEO' }, 42];
    expect(issues(doc)).toEqual([
      {
        code: 'UNKNOWN_NODE_TYPE',
        path: '/root/children/0/type',
        message: 'unknown node type "VIDEO"',
      },
      { code: 'SCHEMA', path: '/root/children/1', message: 'node must be an object' },
    ]);
  });

  it('DUPLICATE_ID', () => {
    const doc = kitchenSink();
    (doc.root.children[3] as { id: string }).id = 'n1';
    expect(issues(doc)).toEqual([
      { code: 'DUPLICATE_ID', path: '/root/children/3/id', message: 'duplicate node id "n1"' },
    ]);
  });

  it('MISSING_ASSET for image fills, image nodes, and SVG fallbacks; null assetIds are fine', () => {
    const doc = kitchenSink();
    doc.assets.images = {};
    expect(issues(doc).map((i) => i.path)).toEqual([
      '/root/children/0/fills/3/assetId',
      '/root/children/1/assetId',
      '/root/children/3/fallbackAssetId',
    ]);
    expect(issues(doc).every((i) => i.code === 'MISSING_ASSET')).toBe(true);
  });

  it('caps the number of reported issues (default 20, configurable)', () => {
    const doc = minimal() as unknown as { root: { children: unknown[] } };
    doc.root.children = Array.from({ length: 50 }, () => ({ type: 'NOPE' }));
    expect(issues(doc)).toHaveLength(20);
    expect(issues(doc, 3)).toHaveLength(3);
  });
});

describe('parseCaptureJson', () => {
  it('parses valid JSON', () => {
    expect(parseCaptureJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });

  it('reports INVALID_JSON with a truncation hint (E-7)', () => {
    const r = parseCaptureJson('{"schemaVersion": "1.0');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe('INVALID_JSON');
      expect(r.errors[0]?.message).toMatch(
        /^File is not valid JSON \(.+\)\. The file may be truncated\.$/,
      );
    }
  });
});
