/**
 * Waiting for the page to settle after the capture scrolls it (EXT-T-9, AC-EXT-7, EXT-I-4): sites react to scrolling with
 * scroll handlers, sticky headers that change style, and "reveal" animations that slide or zoom sections in as they
 * enter the window. Reading or screenshotting in the middle of those gives shifted, scaled content.
 */
export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Two frames and a short pause (scroll handlers, IntersectionObserver callbacks), then the finite animations and
 * transitions that are running (≤ maxWaitMs; endless ones such as tickers and spinners are not waited for).
 */
export async function settle(maxWaitMs: number): Promise<void> {
  await nextFrame();
  await nextFrame();
  await sleep(100);
  const running = document
    .getAnimations()
    .filter(
      (a) => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming().endTime),
    );
  if (!running.length) return;
  await Promise.race([
    Promise.all(running.map((a) => a.finished.catch(() => undefined))),
    sleep(maxWaitMs),
  ]);
  await nextFrame();
}
