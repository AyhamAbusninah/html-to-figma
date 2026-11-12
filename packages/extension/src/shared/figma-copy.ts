/**
 * Copy to Figma (EXT-O-7): CaptureDocument → the plugin's render plan (same planner, same font list as the local
 * preview) → SVG that Figma Web imports as editable layers on Ctrl+V. Pure; runs in the popup.
 */
import type { CaptureDocument } from '@h2f/schema';
import { buildPlan } from '@h2f/figma-plugin/plan';
import { KNOWN_FIGMA_FONTS } from '@h2f/figma-plugin/known-figma-fonts';
import { planToSvg, type SvgResult } from '@h2f/figma-plugin/svg';
import { stylesBoardSvg, type StylesBoardResult } from '@h2f/figma-plugin/styles';

export function figmaSvg(
  doc: CaptureDocument,
  textLines: Record<string, string[]>,
  matchLetterSpacing = false,
): SvgResult {
  const plan = buildPlan(doc, KNOWN_FIGMA_FONTS);
  return planToSvg(plan, { lines: (id) => textLines[id], matchLetterSpacing });
}

/** The page's colors and text styles as a board to paste next to the page (Phase 2). */
export function figmaStylesSvg(doc: CaptureDocument): StylesBoardResult {
  return stylesBoardSvg(buildPlan(doc, KNOWN_FIGMA_FONTS), doc.meta.title || doc.meta.sourceUrl);
}

/** Message after a successful copy: how to paste, plus what the SVG route can't carry. */
export function figmaCopyNote(
  bytes: number,
  skipped: readonly string[],
  formatted: string,
): string {
  const how = `Copied for Figma (${formatted}). In Figma: click the canvas, press Esc, then Ctrl+V.`;
  const slow = bytes > 10 * 1024 * 1024 ? ' Large page: the paste may take a while.' : '';
  return `${how}${slow}${skipped.length ? ` Approximated: ${skipped.join(', ')}.` : ''}`;
}
