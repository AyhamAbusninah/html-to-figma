/** Pure font resolution (PLG-F-1..6). Input: the families Figma reports as available. No figma.* access. */
import {
  ARABIC_CAPABLE,
  ARABIC_PREFERRED_DEFAULTS,
  FONT_ALIASES,
  GENERIC_FAMILY_MAP,
  LAST_RESORT_ARABIC,
  LAST_RESORT_LATIN,
  WEIGHT_STYLE_NAMES,
} from '../config/fonts.ts';

export interface FontName {
  family: string;
  style: string;
}

export interface FontRequest {
  families: string[];
  weight: number;
  italic: boolean;
  arabic: boolean;
}

export interface ResolvedFont {
  font: FontName;
  /** First family the page asked for (after alias normalization). */
  requested: string;
  substituted: boolean;
  /** Arabic text mapped to an Arabic-capable family by PLG-F-6 rule (1)–(3): informational, not a warning. */
  arabicRule: boolean;
}

const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '');

/** Parses a style name ("Semi Bold Italic") into weight + italic. Unknown names → null. */
export function parseStyleName(style: string): { weight: number; italic: boolean } | null {
  const n = norm(style);
  const italic = /italic|oblique/.test(n);
  const base = n.replace(/italic|oblique/g, '') || 'regular';
  for (const [w, names] of Object.entries(WEIGHT_STYLE_NAMES))
    if (names.includes(base)) return { weight: Number(w), italic };
  return null;
}

export class FontResolver {
  private readonly byFamily = new Map<
    string,
    { family: string; styles: { style: string; weight: number; italic: boolean }[] }
  >();
  private readonly cache = new Map<string, ResolvedFont>();
  private readonly documentLang: string;

  constructor(available: readonly FontName[], documentLang = '') {
    this.documentLang = documentLang;
    for (const f of available) {
      const parsed = parseStyleName(f.style);
      if (!parsed) continue;
      const key = f.family.toLowerCase();
      const entry = this.byFamily.get(key) ?? { family: f.family, styles: [] };
      entry.styles.push({ style: f.style, ...parsed });
      this.byFamily.set(key, entry);
    }
  }

  private pickStyle(familyKey: string, weight: number, italic: boolean): FontName | null {
    const entry = this.byFamily.get(familyKey);
    if (!entry || entry.styles.length === 0) return null;
    const score = (s: { weight: number; italic: boolean }) => {
      const d = Math.abs(s.weight - weight);
      // Ties: bolder for requested >= 500, lighter otherwise (PLG-F-2); italic mismatch costs more than 1 step.
      const tie = s.weight > weight === weight >= 500 ? 0 : 0.5;
      return d + tie + (s.italic === italic ? 0 : 1000);
    };
    const best = [...entry.styles].sort((a, b) => score(a) - score(b))[0]!;
    return { family: entry.family, style: best.style };
  }

  resolve(req: FontRequest): ResolvedFont {
    const cacheKey = `${req.families.join('|')}|${req.weight}|${req.italic}|${req.arabic}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const families = req.families.map((f) => FONT_ALIASES[f.toLowerCase()] ?? f);
    const requested = families[0] ?? LAST_RESORT_LATIN;
    const candidates: { name: string; arabicRule: boolean }[] = [];
    if (req.arabic) {
      // PLG-F-6: never apply a Latin-only family to Arabic text.
      for (const f of families)
        if (ARABIC_CAPABLE.has(f.toLowerCase())) candidates.push({ name: f, arabicRule: true });
      const inStack = new Set(families.map((f) => f.toLowerCase()));
      for (const f of ARABIC_PREFERRED_DEFAULTS) {
        if (inStack.has(f.toLowerCase()) || this.documentLang.toLowerCase().startsWith('ar')) {
          candidates.push({ name: f, arabicRule: true });
        }
      }
      candidates.push({ name: LAST_RESORT_ARABIC, arabicRule: true });
    } else {
      for (const f of families)
        candidates.push({ name: GENERIC_FAMILY_MAP[f.toLowerCase()] ?? f, arabicRule: false });
      candidates.push({ name: LAST_RESORT_LATIN, arabicRule: false });
    }

    let result: ResolvedFont | null = null;
    for (const c of candidates) {
      const font = this.pickStyle(c.name.toLowerCase(), req.weight, req.italic);
      if (font) {
        result = {
          font,
          requested,
          substituted: font.family.toLowerCase() !== requested.toLowerCase(),
          arabicRule: c.arabicRule,
        };
        break;
      }
    }
    result ??= {
      font: { family: LAST_RESORT_LATIN, style: 'Regular' },
      requested,
      substituted: true,
      arabicRule: false,
    };
    this.cache.set(cacheKey, result);
    return result;
  }
}
