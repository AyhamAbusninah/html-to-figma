import type { RawPageSnapshot } from '@h2f/core';

/**
 * Collector: reads the live page into a RawPageSnapshot. Only browser reads happen here. Every interpretation of
 * those values lives in @h2f/core (plan §3).
 */
export function collectPageSnapshot(win: Window): RawPageSnapshot {
  const doc = win.document;
  const scroller = doc.scrollingElement ?? doc.documentElement;
  const backgroundColors = [doc.documentElement, doc.body]
    .filter((el): el is HTMLElement => Boolean(el))
    .map((el) => win.getComputedStyle(el).backgroundColor);
  return {
    url: win.location.href,
    title: doc.title,
    lang: doc.documentElement.lang ?? '',
    computedDirection: win.getComputedStyle(doc.documentElement).direction,
    viewport: { width: win.innerWidth, height: win.innerHeight },
    scroll: { width: scroller.scrollWidth, height: scroller.scrollHeight },
    devicePixelRatio: win.devicePixelRatio,
    userAgent: win.navigator.userAgent,
    backgroundColors,
  };
}
