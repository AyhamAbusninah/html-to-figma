/**
 * CaptureDocument v1: the single contract between the extension and the Figma plugin (REQUIREMENTS §2).
 *
 * Source of truth for:
 *   - capture.schema.json (published JSON Schema, draft-07)    → scripts/generate.ts
 *   - src/generated/validators.js (Ajv standalone, MV3-CSP-safe) → scripts/generate.ts
 *   - the TypeScript types exported below
 *
 * Reconstructed 2026-11-08 (R0) from the surviving generated contract. contract/capture-1.0.0.schema.json is the
 * frozen v1.0.0 baseline. Tests require this source to regenerate it exactly (see test/contract.test.ts).
 *
 * Compatibility policy (SCH-8): within major version 1, changes may only ADD optional properties or widen accepted
 * values. Every document valid under the 1.0.0 baseline must stay valid. Removing/renaming/narrowing = major bump.
 */
import { Type, type Static, type TSchema } from '@sinclair/typebox';

// ── Primitives ───────────────────────────────────────────────────────────────────────────────────────────────

const Channel = Type.Number({ minimum: 0, maximum: 1 });

export const RGBA = Type.Object(
  { r: Channel, g: Channel, b: Channel, a: Channel },
  { description: 'sRGB, channels 0–1 (SCH-4)' },
);

const NonNegative = () => Type.Number({ minimum: 0 });

export const Rect = Type.Object(
  { x: Type.Number(), y: Type.Number(), width: NonNegative(), height: NonNegative() },
  { description: 'Document coordinates in CSS px relative to the capture root (SCH-2, SCH-3)' },
);

const Size = () => Type.Object({ width: NonNegative(), height: NonNegative() });

const Literals = <T extends string>(values: readonly T[], options: { description?: string } = {}) =>
  Type.Union(
    values.map((v) => Type.Literal(v)),
    options,
  );

export const BLEND_MODES = [
  'DARKEN',
  'MULTIPLY',
  'LINEAR_BURN',
  'COLOR_BURN',
  'LIGHTEN',
  'SCREEN',
  'LINEAR_DODGE',
  'COLOR_DODGE',
  'OVERLAY',
  'SOFT_LIGHT',
  'HARD_LIGHT',
  'DIFFERENCE',
  'EXCLUSION',
  'HUE',
  'SATURATION',
  'COLOR',
  'LUMINOSITY',
] as const;

const Radii = () =>
  Type.Object({ tl: NonNegative(), tr: NonNegative(), br: NonNegative(), bl: NonNegative() });

// ── Meta & assets ────────────────────────────────────────────────────────────────────────────────────────────

export const CaptureWarning = Type.Object({
  code: Type.String({
    description: 'See WARNING_CODES; unknown codes are allowed (forward compatibility)',
  }),
  message: Type.String(),
  nodeId: Type.Optional(Type.String()),
  detail: Type.Optional(Type.String()),
});

export const Meta = Type.Object({
  sourceUrl: Type.String(),
  title: Type.String(),
  capturedAt: Type.String({
    pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}',
    description: 'ISO 8601',
  }),
  captureMode: Literals(['page', 'element']),
  lang: Type.String(),
  direction: Literals(['ltr', 'rtl']),
  viewport: Size(),
  document: Size(),
  devicePixelRatio: Type.Number({ exclusiveMinimum: 0 }),
  extractorVersion: Type.String(),
  userAgent: Type.String(),
  stats: Type.Object({
    nodeCount: Type.Integer({ minimum: 0 }),
    textCount: Type.Integer({ minimum: 0 }),
    imageCount: Type.Integer({ minimum: 0 }),
    svgCount: Type.Integer({ minimum: 0 }),
    bytes: Type.Integer({ minimum: 0 }),
  }),
  warnings: Type.Array(CaptureWarning),
});

export const ImageAsset = Type.Object({
  mime: Literals(['image/png', 'image/jpeg', 'image/gif']),
  data: Type.String({ description: 'Base64 without data: prefix (SCH-6)' }),
  width: Type.Integer({ minimum: 1, maximum: 4096 }),
  height: Type.Integer({ minimum: 1, maximum: 4096 }),
  source: Literals(['canvas', 'fetch', 'screenshot']),
  originalUrl: Type.Optional(Type.String()),
});

export const Assets = Type.Object({ images: Type.Record(Type.String(), ImageAsset) });

// ── Paints, strokes, effects ─────────────────────────────────────────────────────────────────────────────────

const GradientStops = () =>
  Type.Array(Type.Object({ position: Channel, color: RGBA }), { minItems: 2 });

export const Paint = Type.Union([
  Type.Object({ type: Type.Literal('SOLID'), color: RGBA }),
  Type.Object({
    type: Type.Literal('GRADIENT_LINEAR'),
    angleDeg: Type.Number({ description: 'CSS gradient angle: 0 = to top, 90 = to right' }),
    stops: GradientStops(),
  }),
  Type.Object({
    type: Type.Literal('GRADIENT_RADIAL'),
    center: Type.Object(
      { x: Type.Number(), y: Type.Number() },
      { description: 'Fraction of the box (0–1, may exceed)' },
    ),
    radius: Type.Object(
      { x: Type.Number({ exclusiveMinimum: 0 }), y: Type.Number({ exclusiveMinimum: 0 }) },
      { description: 'Fraction of the box width/height' },
    ),
    stops: GradientStops(),
  }),
  Type.Object({
    type: Type.Literal('IMAGE'),
    assetId: Type.String(),
    scaleMode: Type.Literal('FILL', {
      description: 'CSS backgrounds are pre-composited (EXT-I-8)',
    }),
  }),
]);

const Side = () =>
  Type.Object({
    width: NonNegative(),
    color: RGBA,
    style: Literals(['solid', 'dashed', 'dotted']),
  });

export const Border = Type.Object({ top: Side(), right: Side(), bottom: Side(), left: Side() });

export const Effect = Type.Union([
  Type.Object({
    type: Literals(['DROP_SHADOW', 'INNER_SHADOW']),
    color: RGBA,
    offset: Type.Object({ x: Type.Number(), y: Type.Number() }),
    radius: NonNegative(),
    spread: Type.Number(),
  }),
  Type.Object({ type: Literals(['LAYER_BLUR', 'BACKGROUND_BLUR']), radius: NonNegative() }),
]);

// ── Nodes ────────────────────────────────────────────────────────────────────────────────────────────────────

const baseNodeProperties = () => ({
  id: Type.String({
    description: 'Unique within the document, assigned in traversal order (NFR-2)',
  }),
  name: Type.String({ description: 'Layer name, e.g. "div#main.content" (≤ 64 chars)' }),
  domPath: Type.Optional(Type.String()),
  rect: Rect,
  opacity: Channel,
  blendMode: Type.Optional(
    Literals(BLEND_MODES, { description: 'Figma BlendMode; omitted when NORMAL' }),
  ),
});

/** FrameNode with a caller-chosen `children` item schema: a $ref (published schema) or {} (shallow validator). */
const frameNodeSchema = (childItem: TSchema) =>
  Type.Object({
    ...baseNodeProperties(),
    type: Type.Literal('FRAME'),
    fills: Type.Array(Paint, { description: 'Bottom → top' }),
    strokes: Type.Optional(Border),
    radii: Type.Optional(Radii()),
    effects: Type.Optional(Type.Array(Effect)),
    clipsContent: Type.Boolean(),
    children: Type.Array(childItem),
  });

export const TextNode = Type.Object({
  ...baseNodeProperties(),
  type: Type.Literal('TEXT'),
  characters: Type.String({
    description: 'Logical order, whitespace normalized, text-transform not applied',
  }),
  lineCount: Type.Integer({ minimum: 1 }),
  style: Type.Object({
    fontFamilies: Type.Array(Type.String(), {
      minItems: 1,
      description: 'CSS stack, unquoted, in order',
    }),
    fontWeight: Type.Integer({ minimum: 1, maximum: 1000 }),
    fontStyle: Literals(['normal', 'italic']),
    fontSize: Type.Number({ exclusiveMinimum: 0 }),
    lineHeight: Type.Union([Type.Number({ exclusiveMinimum: 0 }), Type.Literal('normal')]),
    letterSpacing: Type.Number(),
    color: RGBA,
    direction: Literals(['ltr', 'rtl']),
    textAlign: Literals(['left', 'center', 'right', 'justify'], {
      description: 'Physical; start/end already resolved (EXT-RTL-2)',
    }),
    textDecoration: Literals(['none', 'underline', 'line-through']),
    textCase: Literals(['none', 'upper', 'lower', 'title']),
  }),
});

export const ImageNode = Type.Object({
  ...baseNodeProperties(),
  type: Type.Literal('IMAGE'),
  assetId: Type.Union([Type.String(), Type.Null()], {
    description: 'null → placeholder (capture failed)',
  }),
  scaleMode: Literals(['FILL', 'FIT', 'STRETCH']),
  radii: Type.Optional(Radii()),
});

export const SvgNode = Type.Object({
  ...baseNodeProperties(),
  type: Type.Literal('SVG'),
  svg: Type.String({ description: 'Self-contained, sanitized SVG markup (EXT-S-2, EXT-S-3)' }),
  fallbackAssetId: Type.Union([Type.String(), Type.Null()]),
});

const ref = (name: string) => Type.Unsafe({ $ref: `#/definitions/${name}` });

/** Published FrameNode: children reference CaptureNode recursively. */
export const FrameNode = frameNodeSchema(ref('CaptureNode'));
/** Shallow FrameNode for the per-node validator: children are only checked to be an array. */
export const FrameNodeShallow = frameNodeSchema(Type.Unknown());

// ── Document ─────────────────────────────────────────────────────────────────────────────────────────────────

const documentProperties = (root: TSchema) => ({
  schemaVersion: Type.String({
    pattern: '^\\d+\\.\\d+\\.\\d+$',
    description: 'semver; major must be 1 (SCH-8)',
  }),
  meta: Meta,
  assets: Assets,
  root,
});

/** Shallow document for the shell validator: root is validated node-by-node afterwards. */
export const DocumentShell = Type.Object(documentProperties(Type.Unknown()));

export const SCHEMA_ID = 'https://arkantechjo.com/schemas/h2f/capture-1.schema.json';

/** The published draft-07 JSON Schema (capture.schema.json). */
export function buildPublishedSchema(): Record<string, unknown> {
  const doc = Type.Object(documentProperties(ref('FrameNode')));
  return JSON.parse(
    JSON.stringify({
      $schema: 'http://json-schema.org/draft-07/schema#',
      $id: SCHEMA_ID,
      title: 'H2F Capture Document v1',
      ...doc,
      definitions: {
        CaptureNode: Type.Union([
          ref('FrameNode'),
          ref('TextNode'),
          ref('ImageNode'),
          ref('SvgNode'),
        ]),
        FrameNode,
        TextNode,
        ImageNode,
        SvgNode,
      },
    }),
  ) as Record<string, unknown>;
}

/** Schemas compiled into standalone validators (descriptions stripped to keep the bundle small). */
export const VALIDATOR_SCHEMAS = {
  validateShell: DocumentShell,
  validateFrame: FrameNodeShallow,
  validateText: TextNode,
  validateImage: ImageNode,
  validateSvg: SvgNode,
} as const;

// ── TypeScript types ─────────────────────────────────────────────────────────────────────────────────────────

export type RGBA = Static<typeof RGBA>;
export type Rect = Static<typeof Rect>;
export type CaptureWarning = Static<typeof CaptureWarning>;
export type Meta = Static<typeof Meta>;
export type ImageAsset = Static<typeof ImageAsset>;
export type Assets = Static<typeof Assets>;
export type Paint = Static<typeof Paint>;
export type Border = Static<typeof Border>;
export type Effect = Static<typeof Effect>;
export type BlendMode = (typeof BLEND_MODES)[number];
export type TextNode = Static<typeof TextNode>;
export type ImageNode = Static<typeof ImageNode>;
export type SvgNode = Static<typeof SvgNode>;
export type FrameNode = Omit<Static<typeof FrameNodeShallow>, 'children'> & {
  children: CaptureNode[];
};
export type CaptureNode = FrameNode | TextNode | ImageNode | SvgNode;
export type CaptureDocument = Omit<Static<typeof DocumentShell>, 'root'> & { root: FrameNode };
