#!/usr/bin/env node
/**
 * SYS-6 guard: the engine must stay universal (SYS-5). Fails if engine sources contain
 *   1. benchmark/site-specific tokens (frappe, erpnext, desk, awesomplete, …), or
 *   2. querySelector / querySelectorAll / closest / matches with a class or id literal selector.
 * Scope: packages/{core,extension,figma-plugin}/src, excluding src/config/** (the documented constants module).
 * Exemption: a line containing `h2f-universal-exempt: <reason>` (on the same or the previous line) + code review.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ENGINE_DIRS = [
  'packages/core/src',
  'packages/extension/src',
  'packages/figma-plugin/src',
];
export const DENYLIST = [/frappe/i, /erpnext/i, /\bdesk\b/i, /awesomplete/i];
const SELECTOR_LITERAL =
  /\b(?:querySelector(?:All)?|closest|matches)\s*\(\s*(['"`])\s*[.#][^'"`]*\1/;
const EXEMPT = /h2f-universal-exempt:\s*\S/;
/** A comment-only line (so a trailing exemption on a code line never leaks onto the next line). */
const COMMENT_ONLY = /^\s*(?:\/\/|\/\*|\*|<!--)/;
const EXTENSIONS = /\.(?:[cm]?[jt]sx?|html|css)$/;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (EXTENSIONS.test(name)) yield path;
  }
}

/** @returns {{ file: string, line: number, rule: string, text: string }[]} */
export function scanSource(file, source) {
  const violations = [];
  const lines = source.split('\n');
  lines.forEach((text, i) => {
    const prev = i > 0 ? lines[i - 1] : '';
    if (EXEMPT.test(text) || (COMMENT_ONLY.test(prev) && EXEMPT.test(prev))) return;
    for (const re of DENYLIST) {
      if (re.test(text))
        violations.push({
          file,
          line: i + 1,
          rule: `benchmark-specific token ${re}`,
          text: text.trim(),
        });
    }
    if (SELECTOR_LITERAL.test(text)) {
      violations.push({ file, line: i + 1, rule: 'class/id selector literal', text: text.trim() });
    }
  });
  return violations;
}

export function scanRepo(root) {
  const violations = [];
  let files = 0;
  for (const dir of ENGINE_DIRS) {
    for (const path of walk(join(root, dir))) {
      const rel = relative(root, path);
      if (rel.split(sep).includes('config')) continue; // SYS-5 constants module
      files++;
      violations.push(...scanSource(rel, readFileSync(path, 'utf8')));
    }
  }
  return { files, violations };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
  const { files, violations } = scanRepo(root);
  for (const v of violations) console.error(`${v.file}:${v.line}  [${v.rule}]  ${v.text}`);
  if (violations.length) {
    console.error(
      `\ncheck-universal: ${violations.length} violation(s) in engine sources (SYS-5/6).`,
    );
    process.exit(1);
  }
  console.log(`check-universal: ${files} engine source files clean (SYS-5/6).`);
}
