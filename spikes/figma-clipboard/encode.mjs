/**
 * Route A, step 2 (ISOLATED SPIKE): RenderPlan (unchanged buildPlan output) → Figma clipboard HTML.
 * A serializer only — no layout decisions: every number comes from the plan. Field names/shapes were observed in the
 * user's own Figma copy decoded with its embedded schema (decode.mjs). No third-party schema or code.
 * Undocumented format: may break whenever Figma changes it. ToS risk: see README.md.
 */
import { deflateRawSync, zstdCompressSync } from 'node:zlib';
import { compileSchema } from 'kiwi-schema';

const SESSION = 77; // arbitrary; Figma remaps GUIDs on paste
const solid = (p) => ({
  type: 'SOLID',
  color: { r: p.color.r, g: p.color.g, b: p.color.b, a: 1 },
  opacity: p.opacity,
  visible: true,
  blendMode: 'NORMAL',
});
/** Fractional-index style sibling order keys: '!', '"', '#', … (ascending ASCII). */
const position = (i) => String.fromCharCode(0x21 + i);

const UNSUPPORTED = (n) =>
  [n.strokes && 'strokes', n.effects?.length && 'effects', n.blendMode && 'blendMode'].filter(Boolean);

/**
 * @param {import('../../packages/figma-plugin/src/plan/plan.ts').RenderPlan} plan
 * @returns {{ nodeChanges: object[], rootGuid: object, skipped: string[] }}
 */
export function planToNodeChanges(plan, textFields = 'minimal') {
  const nodeChanges = [];
  const skipped = [];
  let local = 2;
  const canvas = { sessionID: 0, localID: 1 };

  const base = (n, parent, index, type) => {
    const guid = { sessionID: SESSION, localID: local++ };
    return {
      guid,
      phase: 'CREATED',
      parentIndex: { guid: parent, position: position(index) },
      type,
      name: n.name,
      visible: true,
      opacity: n.opacity,
      size: { x: n.width, y: n.height },
      transform: { m00: 1, m01: 0, m02: n.x, m10: 0, m11: 1, m12: n.y },
    };
  };
  const radii = (r) =>
    r
      ? {
          rectangleTopLeftCornerRadius: r.tl,
          rectangleTopRightCornerRadius: r.tr,
          rectangleBottomRightCornerRadius: r.br,
          rectangleBottomLeftCornerRadius: r.bl,
          rectangleCornerRadiiIndependent: true,
        }
      : {};

  const visit = (n, parent, index) => {
    for (const u of UNSUPPORTED(n)) skipped.push(`${n.sourceId}: ${u}`);
    if (n.kind === 'frame' || n.kind === 'rect') {
      const type = n.kind === 'frame' ? 'FRAME' : 'ROUNDED_RECTANGLE';
      const nc = {
        ...base(n, parent, index, type),
        fillPaints: n.fills.map(solid),
        ...radii(n.radii),
      };
      if (type === 'FRAME') nc.frameMaskDisabled = !n.clipsContent;
      nodeChanges.push(nc);
      n.children.forEach((c, i) => visit(c, nc.guid, i));
      return nc.guid;
    }
    if (n.kind === 'text') {
      // Single-line text anchored left keeps the plan's auto-width. Right/center-anchored text gets a fixed box of the
      // captured width so the aligned edge stays exact without Figma-side measuring (the plugin adapter measures).
      const autoResize = n.autoResize === 'WIDTH_AND_HEIGHT' && n.anchor !== 'left' ? 'HEIGHT' : n.autoResize;
      nodeChanges.push({
        ...base(n, parent, index, 'TEXT'),
        fontName: { family: n.font.family, style: n.font.style, postscript: '' },
        fontSize: n.fontSize,
        lineHeight:
          n.lineHeight.unit === 'PIXELS'
            ? { value: n.lineHeight.value, units: 'PIXELS' }
            : { value: 100, units: 'PERCENT' },
        letterSpacing: { value: n.letterSpacing.value, units: 'PIXELS' },
        textAlignHorizontal: n.align,
        textAlignVertical: 'TOP',
        textAutoResize: autoResize,
        textDecoration: n.decoration === 'NONE' ? undefined : n.decoration,
        textCase: n.textCase === 'ORIGINAL' ? undefined : n.textCase,
        textData: {
          characters: n.characters,
          lines: [
            {
              lineType: 'PLAIN',
              styleId: 0,
              indentationLevel: 0,
              sourceDirectionality: 'AUTO',
              listStartOffset: 0,
              isFirstLineOfList: false,
            },
          ],
        },
        fillPaints: [solid(n.fill)],
        ...(textFields === 'observed'
          ? {
              // Flags present on text in the user's own Figma copy (decoded sample). Still NO derivedTextData
              // (pre-computed glyph layout), which only Figma's text engine (or our own shaper) could produce.
              fontVariantCommonLigatures: true,
              fontVariantContextualLigatures: true,
              fontVersion: '',
              fontVariations: [],
              textUserLayoutVersion: 5,
              textExplicitLayoutVersion: 1,
              textBidiVersion: 1,
              hasHadRTLText: n.direction === 'rtl' || /[֐-ࣿ]/.test(n.characters),
              emojiImageSet: 'APPLE',
              textDecorationSkipInk: true,
              autoRename: false,
              strokeWeight: 1,
              strokeAlign: 'OUTSIDE',
              strokeJoin: 'MITER',
            }
          : {}),
      });
      return;
    }
    // Placeholder (images/SVG are out of PoC scope): grey rectangle, like the adapter.
    nodeChanges.push({
      ...base({ ...n, name: `${n.name} — ${n.reason}` }, parent, index, 'ROUNDED_RECTANGLE'),
      fillPaints: [solid({ color: { r: 0.9, g: 0.91, b: 0.93 }, opacity: 1 })],
      ...radii(n.radii),
    });
  };

  const rootGuid = visit(plan.root, canvas, 0);
  return { nodeChanges, rootGuid, skipped };
}

/**
 * @param {{ schema: object, schemaChunk: Buffer, version: number }} fmt  from the user's own Figma copy
 * @param {object} plan RenderPlan
 * @param {{ fileKey?: string, pasteID?: number, textFields?: 'minimal' | 'observed' }} opts
 *   fileKey omitted = "no source file" mode; textFields 'observed' adds the text flags seen in a real Figma copy
 */
export function encodeClipboardHtml(fmt, plan, opts = {}) {
  const { nodeChanges, rootGuid, skipped } = planToNodeChanges(plan, opts.textFields);
  const pasteID = opts.pasteID ?? Math.floor(Math.random() * 2 ** 31);
  const canvas = { sessionID: 0, localID: 1 };
  const message = {
    type: 'NODE_CHANGES',
    sessionID: 0,
    ackID: 0,
    pasteID,
    ...(opts.fileKey ? { pasteFileKey: opts.fileKey } : {}),
    pasteIsPartiallyOutsideEnclosingFrame: false,
    pastePageId: canvas,
    isCut: false,
    pasteEditorType: 'DESIGN',
    publishedAssetGuids: [],
    clipboardSelectionRegions: [
      { parent: canvas, nodes: [rootGuid], pasteIsPartiallyOutsideEnclosingFrame: false, focusType: 'NONE' },
    ],
    pasteAssetType: 'UNKNOWN',
    nodeChangeOrder: 'GUID',
    nodeChanges: [
      {
        guid: { sessionID: 0, localID: 0 },
        phase: 'CREATED',
        type: 'DOCUMENT',
        name: 'Document',
        visible: true,
        opacity: 1,
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
      },
      {
        guid: canvas,
        phase: 'CREATED',
        parentIndex: { guid: { sessionID: 0, localID: 0 }, position: '!' },
        type: 'CANVAS',
        name: 'Page 1',
        visible: true,
        opacity: 1,
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        backgroundOpacity: 1,
        backgroundEnabled: true,
      },
      ...nodeChanges,
    ],
    blobs: [],
  };
  const data = compileSchema(fmt.schema).encodeMessage(message);
  const dataChunk = zstdCompressSync(Buffer.from(data));
  const head = Buffer.alloc(12);
  head.write('fig-kiwi', 0, 'latin1');
  head.writeUInt32LE(fmt.version, 8);
  const len = (b) => {
    const l = Buffer.alloc(4);
    l.writeUInt32LE(b.length);
    return l;
  };
  const buffer = Buffer.concat([head, len(fmt.schemaChunk), fmt.schemaChunk, len(dataChunk), dataChunk]);
  const meta = {
    ...(opts.fileKey ? { fileKey: opts.fileKey } : {}),
    pasteID,
    dataType: 'scene',
    editorType: 'design',
  };
  const b64meta = Buffer.from(JSON.stringify(meta)).toString('base64');
  const html =
    `<meta charset="utf-8"><span data-metadata="<!--(figmeta)${b64meta}(/figmeta)-->"></span>` +
    `<span data-buffer="<!--(figma)${buffer.toString('base64')}(/figma)-->"></span>`;
  return { html, bytes: html.length, bufferBytes: buffer.length, skipped, message };
}

export { deflateRawSync };
