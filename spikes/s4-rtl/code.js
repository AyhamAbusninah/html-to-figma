// H2F Spike S4: Arabic shaping, bidi ordering and base direction of Figma text created via the Plugin API.
// Resolves OPEN_QUESTIONS R-5. Standalone, no build step. Main-thread (sandbox) code.
// Kept to conservative syntax (no optional chaining / nullish coalescing / object spread) for the plugin sandbox.
//
// Flow: main sends test cases to the UI → the UI renders Chromium reference images with the same Google Fonts →
// main creates Figma text nodes, exports them as PNG, and lays out a visual comparison frame → the UI classifies
// each export against the references and shows a JSON report to copy back.

var SPIKE_VERSION = '1.0.0';
var FONT_SIZE = 28;
var LINE_HEIGHT = 48;
var BOX_W = 560;
var ARABIC_FONTS = ['Tajawal', 'Cairo', 'Noto Sans Arabic'];
var LABEL_FONT = { family: 'Inter', style: 'Regular' };
var RLM = '‏';
var ZWNJ = '‌';

// firstStrong: the bidi class of the first strong character (L = Latin, R = Arabic). Digits are weak.
var BIDI_CASES = [
  { id: 'B1', text: 'مرحبا بالعالم', firstStrong: 'R', note: 'Pure Arabic, single RTL run (direction not distinguishable, tests shaping/bidi only)' },
  { id: 'B2', text: 'فاتورة INV-2026-00042', firstStrong: 'R', note: 'Arabic then Latin+digits' },
  { id: 'B3', text: 'Figma يدعم العربية', firstStrong: 'L', note: 'Latin-first paragraph in RTL context' },
  { id: 'B4', text: '2026 عام التحويل', firstStrong: 'R', note: 'Digits-first (weak) then Arabic' },
  { id: 'B5', text: 'INV-0042: فاتورة مدفوعة', firstStrong: 'L', note: 'Latin code + colon first' },
  { id: 'B6', text: 'يدعم (Auto Layout) لاحقاً', firstStrong: 'R', note: 'Parenthesized English inside Arabic (bracket mirroring)' },
  { id: 'B7', text: 'المجموع: ١٢٣٬٤٥٦ د.أ', firstStrong: 'R', note: 'Arabic-Indic digits + abbreviation' },
  { id: 'B8', text: 'مرحبا Arkan', firstStrong: 'R', note: 'Arabic with trailing Latin word' },
  { id: 'B9', text: 'Dashboard لوحة التحكم الرئيسية', firstStrong: 'L', note: 'Latin UI term first, long Arabic tail' },
  { id: 'B10', text: 'Version 2 الإصدار الجديد', firstStrong: 'L', note: 'Latin word + number first' },
];

function isolate(word) {
  return word.split('').join(ZWNJ);
}

// Joined vs ZWNJ-isolated glyph forms. If Figma shapes Arabic, joined forms are noticeably narrower.
var SHAPING_CASES = [
  { id: 'S1', joined: 'ببببب', note: 'Beh x5: initial/medial/final forms vs isolated' },
  { id: 'S2', joined: 'لا', note: 'Lam-alef ligature' },
  { id: 'S3', joined: 'سلام', note: 'Common word' },
];

var VISUAL_CASES = [
  {
    id: 'V1',
    note: 'Multi-line RTL paragraph, fixed width 360, right-aligned: compare wrapping with fixtures/pages/rtl-arabic.html',
    text: 'هذه فقرة عربية طويلة تلتف على عدة أسطر لاختبار التفاف النص ومحاذاته إلى اليمين داخل Figma مع رقم الفاتورة INV-2026-00042 والتاريخ 08/11/2026.',
    width: 360,
  },
  { id: 'V2', note: 'letter-spacing 4px on Arabic: does tracking break joining? (EXT-RTL-5)', text: 'مرحبا بالعالم', letterSpacing: 4 },
  { id: 'V3', note: 'Mixed weights: Regular vs Bold style name for each Arabic font', text: 'خط عريض Bold', bold: true },
];

function progress(text) {
  figma.ui.postMessage({ type: 'progress', text: text });
}

function errText(e) {
  return String((e && e.message) || e);
}

function makeText(chars, family, opts) {
  opts = opts || {};
  var t = figma.createText();
  t.fontName = { family: family, style: opts.style || 'Regular' };
  t.fontSize = opts.fontSize || FONT_SIZE;
  t.lineHeight = { value: opts.lineHeight || LINE_HEIGHT, unit: 'PIXELS' };
  if (opts.letterSpacing) t.letterSpacing = { value: opts.letterSpacing, unit: 'PIXELS' };
  t.characters = chars;
  if (opts.width) {
    t.textAutoResize = 'HEIGHT';
    t.resize(opts.width, t.height);
    t.textAlignHorizontal = opts.align || 'RIGHT';
  } else {
    t.textAutoResize = 'WIDTH_AND_HEIGHT';
  }
  return t;
}

function label(frame, chars, x, y, size) {
  var t = figma.createText();
  t.fontName = LABEL_FONT;
  t.fontSize = size || 11;
  t.characters = chars;
  t.fills = [{ type: 'SOLID', color: { r: 0.35, g: 0.38, b: 0.42 } }];
  frame.appendChild(t);
  t.x = x;
  t.y = y;
  return t;
}

/** Looks for any direction-related property on TextNode (we know of none in the public API). */
function probeDirectionApi(node) {
  var found = [];
  var candidates = ['textDirection', 'direction', 'paragraphDirection', 'bidi', 'textAlignDirection', 'writingDirection'];
  for (var i = 0; i < candidates.length; i++) {
    try {
      if (candidates[i] in node) found.push(candidates[i]);
    } catch (e) {
      /* ignore */
    }
  }
  var protoMatches = [];
  try {
    var proto = Object.getPrototypeOf(node);
    var guard = 0;
    while (proto && guard++ < 10) {
      var names = Object.getOwnPropertyNames(proto);
      for (var j = 0; j < names.length; j++) {
        if (/dir|bidi|rtl/i.test(names[j]) && protoMatches.indexOf(names[j]) < 0) protoMatches.push(names[j]);
      }
      proto = Object.getPrototypeOf(proto);
    }
  } catch (e) {
    protoMatches.push('introspection failed: ' + errText(e));
  }
  return { inOperatorHits: found, prototypeNameMatches: protoMatches };
}

async function run(msg) {
  var report = {
    spike: 'S4-rtl-arabic',
    spikeVersion: SPIKE_VERSION,
    apiVersion: figma.apiVersion,
    editorType: figma.editorType,
    startedAt: new Date().toISOString(),
    params: { fontSize: FONT_SIZE, lineHeight: LINE_HEIGHT, boxWidth: BOX_W },
    fonts: {},
    shaping: [],
    wrapped: [],
    apiProbe: null,
    visualCases: VISUAL_CASES.map(function (v) {
      return { id: v.id, note: v.note };
    }),
    errors: [],
  };

  // 1. Font availability, including exact style names (feeds PLG-F-2 weight/style-name normalization).
  progress('Checking font availability…');
  var families = ARABIC_FONTS.concat(['Inter']);
  for (var f = 0; f < families.length; f++) report.fonts[families[f]] = { available: false, styles: [] };
  var all = await figma.listAvailableFontsAsync();
  for (var a = 0; a < all.length; a++) {
    var entry = report.fonts[all[a].fontName.family];
    if (entry) {
      entry.available = true;
      entry.styles.push(all[a].fontName.style);
    }
  }

  await figma.loadFontAsync(LABEL_FONT);
  var usable = [];
  for (var u = 0; u < ARABIC_FONTS.length; u++) {
    var fam = ARABIC_FONTS[u];
    try {
      await figma.loadFontAsync({ family: fam, style: 'Regular' });
      report.fonts[fam].loadedRegular = true;
      usable.push(fam);
    } catch (e) {
      report.fonts[fam].loadedRegular = false;
      report.errors.push('loadFontAsync ' + fam + ' Regular: ' + errText(e));
    }
    try {
      await figma.loadFontAsync({ family: fam, style: 'Bold' });
      report.fonts[fam].loadedBold = true;
    } catch (e) {
      report.fonts[fam].loadedBold = false;
    }
  }
  if (usable.length === 0) throw new Error('None of ' + ARABIC_FONTS.join(', ') + ' could be loaded in Figma.');

  // 2. Direction API probe.
  var probeNode = makeText('اختبار', usable[0]);
  report.apiProbe = probeDirectionApi(probeNode);
  probeNode.remove();

  // 3. Shaping: width of joined vs isolated forms (auto-width text nodes, measured then removed).
  progress('Measuring Arabic shaping…');
  for (var s = 0; s < usable.length; s++) {
    for (var c = 0; c < SHAPING_CASES.length; c++) {
      var sc = SHAPING_CASES[c];
      var j = makeText(sc.joined, usable[s]);
      var iso = makeText(isolate(sc.joined), usable[s]);
      report.shaping.push({
        font: usable[s],
        caseId: sc.id,
        note: sc.note,
        joinedWidth: Math.round(j.width * 100) / 100,
        isolatedWidth: Math.round(iso.width * 100) / 100,
        ratio: Math.round((j.width / iso.width) * 1000) / 1000,
      });
      j.remove();
      iso.remove();
    }
  }

  // 4. Comparison frame: [label | Figma text node | Chromium reference image].
  progress('Building comparison frame…');
  var frame = figma.createFrame();
  frame.name = 'H2F Spike S4 — RTL/Arabic (' + report.startedAt.slice(0, 16).replace('T', ' ') + ')';
  frame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  frame.clipsContent = false;
  var maxX = 0;
  var pageChildren = figma.currentPage.children;
  var hadChildren = pageChildren.length > 0;
  for (var p = 0; p < pageChildren.length; p++) maxX = Math.max(maxX, pageChildren[p].x + pageChildren[p].width);
  figma.currentPage.appendChild(frame);
  frame.x = hadChildren ? maxX + 200 : 0;
  frame.y = 0;

  var COL_LABEL = 24;
  var COL_FIGMA = 320;
  var COL_REF = COL_FIGMA + BOX_W + 40;
  var ROW_H = LINE_HEIGHT + 20;
  var y = 24;
  label(frame, 'H2F Spike S4: RTL / Arabic text via Figma Plugin API', COL_LABEL, y, 18);
  y += 36;
  label(frame, 'Case · variant · font', COL_LABEL, y, 12);
  label(frame, 'Figma TextNode (fixed width ' + BOX_W + ', RIGHT aligned)', COL_FIGMA, y, 12);
  label(frame, 'Chromium reference (correct RTL rendering)', COL_REF, y, 12);
  y += 28;

  var exportsOut = [];
  for (var fi = 0; fi < usable.length; fi++) {
    var font = usable[fi];
    for (var ci = 0; ci < BIDI_CASES.length; ci++) {
      var bc = BIDI_CASES[ci];
      var variants = [
        ['asIs', bc.text],
        ['rlm', RLM + bc.text],
      ];
      for (var vi = 0; vi < variants.length; vi++) {
        var variant = variants[vi][0];
        var key = bc.id + '|' + font + '|' + variant;
        try {
          label(frame, bc.id + ' · ' + variant + ' · ' + font + '  (first strong: ' + bc.firstStrong + ')', COL_LABEL, y + 16);
          var guide = figma.createRectangle();
          guide.resize(BOX_W, LINE_HEIGHT);
          guide.fills = [{ type: 'SOLID', color: { r: 0.96, g: 0.97, b: 0.98 } }];
          frame.appendChild(guide);
          guide.x = COL_FIGMA;
          guide.y = y;

          var t = makeText(variants[vi][1], font, { width: BOX_W, align: 'RIGHT' });
          t.name = key;
          frame.appendChild(t);
          t.x = COL_FIGMA;
          t.y = y;
          if (t.height > LINE_HEIGHT * 1.5) report.wrapped.push(key);

          var refBytes = msg.refs && msg.refs[bc.id + '|' + font];
          if (refBytes) {
            var img = figma.createImage(refBytes);
            var r = figma.createRectangle();
            r.resize(BOX_W, LINE_HEIGHT);
            r.fills = [{ type: 'IMAGE', imageHash: img.hash, scaleMode: 'FILL' }];
            r.name = 'reference ' + bc.id + '|' + font;
            frame.appendChild(r);
            r.x = COL_REF;
            r.y = y;
          }

          var png = await t.exportAsync({
            format: 'PNG',
            constraint: { type: 'SCALE', value: 2 },
            useAbsoluteBounds: true,
          });
          exportsOut.push({ key: key, caseId: bc.id, font: font, variant: variant, png: png, height: t.height });
        } catch (e) {
          report.errors.push(key + ': ' + errText(e));
        }
        y += ROW_H;
      }
    }
    progress('Exported ' + font);
  }

  // 5. Visual-only cases.
  y += 24;
  label(frame, 'Visual-only cases (inspect by eye; compare with fixtures/pages/rtl-arabic.html in Chrome)', COL_LABEL, y, 14);
  y += 32;
  for (var vc = 0; vc < VISUAL_CASES.length; vc++) {
    var v = VISUAL_CASES[vc];
    for (var vf = 0; vf < usable.length; vf++) {
      try {
        if (v.bold && !report.fonts[usable[vf]].loadedBold) continue;
        label(frame, v.id + ' · ' + usable[vf] + ': ' + v.note, COL_LABEL, y);
        var vt = makeText(v.text, usable[vf], {
          width: v.width || BOX_W,
          letterSpacing: v.letterSpacing,
          style: v.bold ? 'Bold' : 'Regular',
        });
        vt.name = v.id + '|' + usable[vf];
        frame.appendChild(vt);
        vt.x = COL_FIGMA;
        vt.y = y + 18;
        y += vt.height + 40;
      } catch (e) {
        report.errors.push(v.id + '|' + usable[vf] + ': ' + errText(e));
      }
    }
  }

  frame.resize(COL_REF + BOX_W + 24, y + 24);
  figma.viewport.scrollAndZoomIntoView([frame]);
  report.finishedAt = new Date().toISOString();
  figma.ui.postMessage({ type: 'results', report: report, exports: exportsOut });
  figma.notify('S4 spike finished. Copy the report from the plugin window.');
}

figma.showUI(__html__, { width: 620, height: 760, title: 'H2F Spike S4 — RTL/Arabic' });
figma.ui.postMessage({
  type: 'init',
  spikeVersion: SPIKE_VERSION,
  fonts: ARABIC_FONTS,
  cases: BIDI_CASES,
  box: { w: BOX_W, h: LINE_HEIGHT, fontSize: FONT_SIZE },
});

figma.ui.onmessage = function (msg) {
  if (msg.type === 'references') {
    run(msg).catch(function (e) {
      figma.ui.postMessage({ type: 'fatal', message: String((e && e.stack) || e) });
    });
  } else if (msg.type === 'close') {
    figma.closePlugin();
  }
};
