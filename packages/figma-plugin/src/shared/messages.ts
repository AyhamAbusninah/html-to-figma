import type { CaptureDocument } from '@h2f/schema';

/** UI iframe → main thread. */
export type UiToMain = { type: 'render'; document: CaptureDocument } | { type: 'close' };

export interface RenderReport {
  rootName: string;
  layersCreated: number;
  layersFailed: { path: string; error: string }[];
  durationMs: number;
}

/** Main thread → UI iframe. */
export type MainToUi =
  | { type: 'progress'; text: string }
  | { type: 'rendered'; report: RenderReport }
  | { type: 'error'; message: string };
