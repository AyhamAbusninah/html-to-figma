/**
 * Route A, step 1: decode a Figma clipboard sample saved by inspector.html.
 * Uses only Node zlib + kiwi-schema (evanw/kiwi, MIT). No third-party schema files.
 * STOP RULE: if the payload carries no embedded schema, report and stop (exit code 3).
 *
 * Usage: node decode.mjs <sample.json> [out.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync, zstdDecompressSync } from 'node:zlib';
import { compileSchema, decodeBinarySchema } from 'kiwi-schema';

export function extractBuffer(html) {
  const m = html.match(/\(figma\)([\s\S]*?)\(\/figma\)/);
  return m ? Buffer.from(m[1], 'base64') : null;
}

export function extractMeta(html) {
  const m = html.match(/\(figmeta\)([\s\S]*?)\(\/figmeta\)/);
  return m ? JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')) : null;
}

const isZstd = (b) => b.length > 4 && b[0] === 0x28 && b[1] === 0xb5 && b[2] === 0x2f && b[3] === 0xfd;

export function decompress(b) {
  if (isZstd(b)) return { codec: 'zstd', data: zstdDecompressSync(b) };
  try {
    return { codec: 'deflate-raw', data: inflateRawSync(b) };
  } catch {
    return { codec: 'none', data: b };
  }
}

/** fig-kiwi container: 8-byte prelude, u32 LE version, then [u32 LE length][bytes] chunks. */
export function parseContainer(buf) {
  const prelude = buf.subarray(0, 8).toString('latin1');
  const version = buf.readUInt32LE(8);
  const chunks = [];
  let off = 12;
  while (off + 4 <= buf.length) {
    const len = buf.readUInt32LE(off);
    off += 4;
    if (off + len > buf.length) throw new Error(`chunk at ${off - 4} overruns buffer (${len} B)`);
    chunks.push(buf.subarray(off, off + len));
    off += len;
  }
  return { prelude, version, chunks };
}

export function decodeSample(html) {
  const buf = extractBuffer(html);
  if (!buf) return { stop: 'no (figma) buffer in clipboard HTML' };
  const c = parseContainer(buf);
  const parts = c.chunks.map(decompress);
  const report = {
    prelude: c.prelude,
    version: c.version,
    bufferBytes: buf.length,
    chunks: parts.map((p, i) => ({ i, compressed: c.chunks[i].length, codec: p.codec, bytes: p.data.length })),
  };
  if (parts.length < 2) return { ...report, stop: 'only one chunk: no embedded schema (stop rule)' };
  let schema;
  try {
    schema = decodeBinarySchema(new Uint8Array(parts[0].data));
  } catch (e) {
    return { ...report, stop: `chunk 0 is not a kiwi binary schema (${e.message}) (stop rule)` };
  }
  const compiled = compileSchema(schema);
  const message = compiled.decodeMessage(new Uint8Array(parts[1].data));
  return { ...report, schema, schemaDefinitions: schema.definitions.length, message };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , input, output] = process.argv;
  if (!input) {
    console.error('usage: node decode.mjs <sample.json> [out.json]');
    process.exit(2);
  }
  const sample = JSON.parse(readFileSync(input, 'utf8'));
  const meta = extractMeta(sample.html);
  const r = decodeSample(sample.html);
  const replacer = (_k, v) => (typeof v === 'bigint' ? v.toString() : v instanceof Uint8Array ? `<${v.length} bytes>` : v);
  console.log(JSON.stringify({ meta, ...r, schema: undefined, message: undefined }, replacer, 2));
  if (r.stop) {
    console.error(`STOP: ${r.stop}`);
    process.exit(3);
  }
  const nodes = (r.message.nodeChanges ?? []).map((n) => ({
    guid: n.guid,
    parentIndex: n.parentIndex,
    type: n.type,
    name: n.name,
    size: n.size,
    transform: n.transform,
    fields: Object.keys(n).sort(),
  }));
  console.log(JSON.stringify({ messageType: r.message.type, nodeCount: nodes.length, nodes }, replacer, 2));
  if (output) writeFileSync(output, JSON.stringify({ meta, ...r }, replacer, 2));
}
