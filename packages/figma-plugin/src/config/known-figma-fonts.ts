/**
 * An ASSUMED subset of the fonts Figma offers (Google Fonts are available to every Figma user). Used where the real
 * list from `figma.listAvailableFontsAsync()` isn't available: the Figma mock in tests and the local CaptureDocument
 * preview. Inside Figma the plugin always uses the real list.
 */
export const KNOWN_FIGMA_FONTS: { family: string; style: string }[] = [
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
