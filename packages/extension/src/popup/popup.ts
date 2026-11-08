/** Popup: Idle → Busy → Done | Error (EXT-O-1). Pure logic lives in ../shared/popup-model.ts. */
import type { CaptureDocument } from '@h2f/schema';
import { CAPTURE_GLOBAL, LIMITS } from '../config/constants.ts';
import type { CaptureResult } from '../shared/messages.ts';
import {
  captureFilename,
  copyState,
  formatBytes,
  friendlyError,
  isRestrictedUrl,
  restrictedMessage,
  statsRows,
  warningSummary,
} from '../shared/popup-model.ts';

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const STATES = ['idle', 'busy', 'done', 'error'] as const;

function show(state: (typeof STATES)[number]) {
  for (const s of STATES) $(s).hidden = s !== state;
}

let tab: chrome.tabs.Tab | undefined;
let json = '';
let captured: CaptureDocument | undefined;

async function init() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  $('page').textContent = tab?.title ? `${tab.title}` : (tab?.url ?? 'Unknown page');
  const restricted = isRestrictedUrl(tab?.url);
  ($('capture') as HTMLButtonElement).disabled = restricted;
  $('restricted').textContent = restrictedMessage(tab?.url);
  $('restricted').hidden = !restricted;
}

async function capture() {
  if (!tab?.id) return;
  show('busy');
  $('busyText').textContent = 'Capturing page…';
  try {
    const target = { tabId: tab.id };
    await chrome.scripting.executeScript({ target, files: ['content.js'] });
    const [injection] = await chrome.scripting.executeScript({
      target,
      func: (name: string) =>
        (globalThis as unknown as Record<string, () => Promise<unknown>>)[name]!(),
      args: [CAPTURE_GLOBAL],
    });
    const result = injection?.result as CaptureResult | undefined;
    if (!result) throw new Error('The page did not return a capture.');
    if (!result.ok) {
      const details = result.issues?.map((i) => `${i.path}: ${i.message}`).join('\n') ?? '';
      throw new Error(`${result.message}${details ? `\n${details}` : ''}`);
    }
    if (result.bytes > LIMITS.failBytes) {
      throw new Error(
        `Capture is ${formatBytes(result.bytes)}, above the ${formatBytes(LIMITS.failBytes)} limit.`,
      );
    }
    captured = result.document;
    json = JSON.stringify(result.document);
    showDone(result.document, result.bytes, result.durationMs);
  } catch (e) {
    const err = friendlyError(e instanceof Error ? e.message : String(e), tab?.url);
    $('errorText').textContent = err.title;
    $('errorDetails').textContent = err.detail;
    $('errorDetailsBox').hidden = !err.detail;
    show('error');
  }
}

function showDone(doc: CaptureDocument, bytes: number, durationMs: number) {
  $('stats').replaceChildren(
    ...statsRows(doc, bytes, durationMs).flatMap(([label, value]) => {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      return [dt, dd];
    }),
  );
  const summary = warningSummary(doc.meta.warnings);
  $('notCapturedList').replaceChildren(
    ...summary.map((line) => {
      const li = document.createElement('li');
      li.textContent = line;
      return li;
    }),
  );
  $('notCaptured').hidden = summary.length === 0;
  $('downloadNote').textContent = '';
  const copy = copyState(bytes);
  const copyButton = $('copy') as HTMLButtonElement;
  copyButton.disabled = copy.disabled;
  copyButton.title = copy.title;
  $('copyNote').textContent = copy.note;
  show('done');
}

async function download() {
  if (!captured) return;
  const note = $('downloadNote');
  const filename = captureFilename(captured.meta.sourceUrl, new Date());
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  note.textContent = 'Saving…';
  try {
    const id = await chrome.downloads.download({ url, filename, saveAs: false });
    // Confirm only once Chrome reports the file as written (or explain why not).
    for (let i = 0; i < 50; i++) {
      const [item] = await chrome.downloads.search({ id });
      if (item?.state === 'complete') {
        note.textContent = `Saved to your Downloads folder as ${filename}`;
        return;
      }
      if (item?.state === 'interrupted') {
        note.textContent = `Download failed (${item.error ?? 'interrupted'}). Try again or use Copy.`;
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    note.textContent = `Download started: ${filename}`;
  } catch (e) {
    note.textContent = `Download failed: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

async function copyToClipboard() {
  try {
    // Never leave the user without feedback if the clipboard API stalls (seen in headless test browsers).
    await Promise.race([
      navigator.clipboard.writeText(json),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), 4000)),
    ]);
    $('copyNote').textContent =
      `Copied ${formatBytes(json.length)}. Paste it into the Figma plugin.`;
  } catch (e) {
    $('copyNote').textContent =
      `Copy failed: ${e instanceof Error ? e.message : String(e)}. Use Download instead.`;
  }
}

$('capture').addEventListener('click', () => void capture());
$('retry').addEventListener('click', () => show('idle'));
$('download').addEventListener('click', () => void download());
$('copy').addEventListener('click', () => void copyToClipboard());
void init();
