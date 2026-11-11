import { GOOGLE_FONTS } from './google-fonts.ts';

/**
 * The fonts Figma offers, as far as we can know without Figma: the whole Google Fonts library (available to every
 * Figma Web user; google-fonts.ts, generated) plus hand-checked style names for the families measured in real Figma
 * (Inter's "Semi Bold", the Arabic families). Used where the real list from `figma.listAvailableFontsAsync()` isn't
 * available: Copy to Figma, the local CaptureDocument preview and tests. Inside Figma the plugin uses the real list.
 */
const CHECKED: { family: string; style: string }[] = [
  ...[
    'Thin',
    'Extra Light',
    'Light',
    'Regular',
    'Medium',
    'Semi Bold',
    'Bold',
    'Extra Bold',
    'Black',
  ].flatMap((s) => [
    { family: 'Inter', style: s },
    { family: 'Inter', style: s === 'Regular' ? 'Italic' : `${s} Italic` },
  ]),
  ...['Regular', 'Medium', 'Bold'].map((style) => ({ family: 'Roboto', style })),
  ...['Regular', 'Bold'].map((style) => ({ family: 'Roboto Mono', style })),
  ...['Regular', 'Bold', 'Italic'].map((style) => ({ family: 'Noto Serif', style })),
  ...['Regular', 'Medium', 'SemiBold', 'Bold'].map((style) => ({
    family: 'Noto Sans Arabic',
    style,
  })),
  ...['ExtraLight', 'Light', 'Regular', 'Medium', 'Bold', 'ExtraBold', 'Black'].map((style) => ({
    family: 'Tajawal',
    style,
  })),
  ...['ExtraLight', 'Light', 'Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold', 'Black'].map(
    (style) => ({ family: 'Cairo', style }),
  ),
];

const STYLE_BY_WEIGHT = [
  'Thin',
  'ExtraLight',
  'Light',
  'Regular',
  'Medium',
  'SemiBold',
  'Bold',
  'ExtraBold',
  'Black',
];

/** Google Fonts styles by Figma's naming (PostScript suffixes: "Manrope-SemiBold", "Jost-LightItalic"). */
function googleStyles(): { family: string; style: string }[] {
  const checked = new Set(CHECKED.map((f) => f.family.toLowerCase()));
  const out: { family: string; style: string }[] = [];
  for (const [family, [normal, italic]] of Object.entries(GOOGLE_FONTS)) {
    if (checked.has(family.toLowerCase())) continue;
    STYLE_BY_WEIGHT.forEach((name, k) => {
      if (normal & (1 << k)) out.push({ family, style: name });
      if (italic & (1 << k))
        out.push({ family, style: name === 'Regular' ? 'Italic' : `${name} Italic` });
    });
  }
  return out;
}

export const KNOWN_FIGMA_FONTS: { family: string; style: string }[] = [
  ...CHECKED,
  ...googleStyles(),
];
