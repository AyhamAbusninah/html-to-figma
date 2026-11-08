/**
 * CaptureDocument validation used by BOTH the extension (before export) and the plugin (on import).
 *
 * JSON Schema checks run per node with shallow validators (children are walked here, not by Ajv), which gives
 * precise error paths and avoids recursion in generated code. Semantic checks the schema can't express: major
 * version gate, root is a FRAME, unique node ids, and every referenced asset exists.
 */
import type { CaptureDocument } from './schema.ts';
import { majorOf, SUPPORTED_MAJOR } from './version.ts';
import {
  validateFrame,
  validateImage,
  validateShell,
  validateSvg,
  validateText,
  type AjvError,
  type StandaloneValidator,
} from './generated/validators.js';

export type CaptureIssueCode =
  | 'INVALID_JSON'
  | 'UNSUPPORTED_VERSION'
  | 'SCHEMA'
  | 'ROOT_NOT_FRAME'
  | 'UNKNOWN_NODE_TYPE'
  | 'DUPLICATE_ID'
  | 'MISSING_ASSET';

export interface CaptureIssue {
  code: CaptureIssueCode;
  /** JSON Pointer to the offending value. */
  path: string;
  message: string;
}

export type ValidationResult =
  { ok: true; document: CaptureDocument } | { ok: false; errors: CaptureIssue[] };

export interface ValidateOptions {
  /** Stop collecting after this many issues (default 20). */
  maxErrors?: number;
}

const NODE_VALIDATORS: Record<string, StandaloneValidator> = {
  FRAME: validateFrame,
  TEXT: validateText,
  IMAGE: validateImage,
  SVG: validateSvg,
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function describe(e: AjvError): string {
  switch (e.keyword) {
    case 'required':
      return `missing required property "${String(e.params.missingProperty)}"`;
    case 'const':
      return `must be ${JSON.stringify(e.params.allowedValue)}`;
    case 'anyOf':
      return 'does not match any allowed shape';
    default:
      return e.message ?? `failed "${e.keyword}"`;
  }
}

function schemaIssue(basePath: string, validator: StandaloneValidator): CaptureIssue {
  const first = validator.errors?.[0];
  if (!first) return { code: 'SCHEMA', path: basePath || '/', message: 'invalid value' };
  return { code: 'SCHEMA', path: basePath + first.instancePath || '/', message: describe(first) };
}

/** Parses JSON text; failures are reported as an INVALID_JSON issue (E-7). */
export function parseCaptureJson(
  text: string,
): { ok: true; value: unknown } | { ok: false; errors: CaptureIssue[] } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      errors: [
        {
          code: 'INVALID_JSON',
          path: '/',
          message: `File is not valid JSON (${reason}). The file may be truncated.`,
        },
      ],
    };
  }
}

export function validateCapture(input: unknown, options: ValidateOptions = {}): ValidationResult {
  const maxErrors = options.maxErrors ?? 20;
  const errors: CaptureIssue[] = [];
  const report = (issue: CaptureIssue) => {
    if (errors.length < maxErrors) errors.push(issue);
  };

  // Version gate first, so a v2 file gets a clear message instead of a pile of schema errors (E-8).
  if (
    isObject(input) &&
    typeof input.schemaVersion === 'string' &&
    majorOf(input.schemaVersion) !== SUPPORTED_MAJOR
  ) {
    return {
      ok: false,
      errors: [
        {
          code: 'UNSUPPORTED_VERSION',
          path: '/schemaVersion',
          message: `Capture made with schema v${input.schemaVersion}. This version supports v${SUPPORTED_MAJOR}.x. Please update.`,
        },
      ],
    };
  }

  if (!validateShell(input)) return { ok: false, errors: [schemaIssue('', validateShell)] };
  const doc = input as CaptureDocument;

  if (!isObject(doc.root) || doc.root.type !== 'FRAME') {
    report({ code: 'ROOT_NOT_FRAME', path: '/root', message: 'root must be a FRAME node' });
    return { ok: false, errors };
  }

  const seenIds = new Set<string>();
  const assetRefs: { id: string; path: string }[] = [];
  const stack: { node: unknown; path: string }[] = [{ node: doc.root, path: '/root' }];

  while (stack.length > 0 && errors.length < maxErrors) {
    const { node, path } = stack.pop()!;
    if (!isObject(node)) {
      report({ code: 'SCHEMA', path, message: 'node must be an object' });
      continue;
    }
    const validator = NODE_VALIDATORS[String(node.type)];
    if (!validator) {
      report({
        code: 'UNKNOWN_NODE_TYPE',
        path: `${path}/type`,
        message: `unknown node type ${JSON.stringify(node.type)}`,
      });
      continue;
    }
    if (!validator(node)) {
      report(schemaIssue(path, validator));
      continue;
    }

    const typed = node as unknown as
      CaptureDocument['root'] | { type: 'TEXT' | 'IMAGE' | 'SVG'; id: string };
    const id = typed.id;
    if (seenIds.has(id))
      report({ code: 'DUPLICATE_ID', path: `${path}/id`, message: `duplicate node id "${id}"` });
    seenIds.add(id);

    const n = node as Record<string, unknown>;
    switch (n.type) {
      case 'FRAME': {
        const frame = node as unknown as CaptureDocument['root'];
        frame.fills.forEach((paint, i) => {
          if (paint.type === 'IMAGE')
            assetRefs.push({ id: paint.assetId, path: `${path}/fills/${i}/assetId` });
        });
        // Push in reverse so children are visited in document order (stable error ordering).
        const children = frame.children as unknown[];
        for (let i = children.length - 1; i >= 0; i--)
          stack.push({ node: children[i], path: `${path}/children/${i}` });
        break;
      }
      case 'IMAGE':
        if (n.assetId !== null)
          assetRefs.push({ id: n.assetId as string, path: `${path}/assetId` });
        break;
      case 'SVG':
        if (n.fallbackAssetId !== null)
          assetRefs.push({ id: n.fallbackAssetId as string, path: `${path}/fallbackAssetId` });
        break;
    }
  }

  for (const ref of assetRefs) {
    if (!Object.prototype.hasOwnProperty.call(doc.assets.images, ref.id)) {
      report({
        code: 'MISSING_ASSET',
        path: ref.path,
        message: `asset "${ref.id}" is not in assets.images`,
      });
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, document: doc };
}
