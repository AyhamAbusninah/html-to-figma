import type { CaptureDocument } from '@h2f/schema';

/** UI iframe → main thread. */
export type UiToMain = { type: 'render'; document: CaptureDocument } | { type: 'close' };

export interface FontNameLike {
  family: string;
  style: string;
}

export interface RenderReport {
  rootName: string;
  layersCreated: number;
  layersFailed: { path: string; error: string }[];
  durationMs: number;
  /** PLG-F-5. `arabicRule` = informational (PLG-F-6), not a warning. */
  fontSubstitutions?: {
    requested: string;
    weight: number;
    italic: boolean;
    used: FontNameLike;
    arabicRule: boolean;
    count: number;
  }[];
  fontsFallback?: { requested: FontNameLike; used: FontNameLike }[];
  placeholders?: number;
  unsupported?: string[];
  captureWarnings?: number;
}

/** Main thread → UI iframe. */
export type MainToUi =
  | { type: 'progress'; text: string }
  | { type: 'rendered'; report: RenderReport }
  | { type: 'error'; message: string };
