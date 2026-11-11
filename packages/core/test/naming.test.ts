/** Readable layer names (Phase 2, easier editing). Verification level: UNIT (Node). */
import { describe, expect, it } from 'vitest';
import {
  humanize,
  RAW_STYLE_KEYS,
  readableClass,
  semanticName,
  type RawElement,
  type RawNode,
  type RawStyle,
} from '../src/index.ts';

const STYLE = Object.fromEntries(RAW_STYLE_KEYS.map((k) => [k, ''])) as RawStyle;
Object.assign(STYLE, { display: 'block', visibility: 'visible' });

const el = (
  tag: string,
  extra: Partial<RawElement> = {},
  children: RawNode[] = [],
): RawElement => ({
  kind: 'element',
  tag,
  idAttr: '',
  classes: [],
  rect: { x: 0, y: 0, width: 200, height: 40 },
  style: STYLE,
  children,
  ...extra,
});
const text = (t: string): RawNode => ({ kind: 'text', text: t, rects: [] });

describe('semanticName', () => {
  it('landmarks by tag or role, with an explicit label only', () => {
    expect(semanticName(el('header', {}, [text('Shop  Bags  Shoes')]))).toBe('Header');
    expect(semanticName(el('nav', { attrs: { ariaLabel: 'Main menu' } }))).toBe('Nav · Main menu');
    expect(semanticName(el('div', { attrs: { role: 'navigation' } }))).toBe('Nav');
    expect(semanticName(el('footer'))).toBe('Footer');
    expect(semanticName(el('section', { classes: ['hero'] }))).toBe('Section · Hero');
    expect(semanticName(el('div', { attrs: { role: 'dialog', ariaLabel: 'Sign in' } }))).toBe(
      'Dialog · Sign in',
    );
  });

  it('buttons, links, headings and labels carry their text', () => {
    expect(semanticName(el('button', {}, [text('  Add to\n cart ')]))).toBe('Button · Add to cart');
    expect(semanticName(el('div', { attrs: { role: 'button', ariaLabel: 'Close' } }))).toBe(
      'Button · Close',
    );
    expect(semanticName(el('a', {}, [el('span', {}, [text('Pricing')])]))).toBe('Link · Pricing');
    expect(semanticName(el('h2', {}, [text('New arrivals')]))).toBe('Heading 2 · New arrivals');
    expect(semanticName(el('div', { attrs: { role: 'heading' } }, [text('Bags')]))).toBe(
      'Heading · Bags',
    );
    expect(semanticName(el('button', {}, [text('أضف إلى السلة')]))).toBe('Button · أضف إلى السلة');
    expect(
      semanticName(el('a', {}, [text('Discover handcrafted leather bags made for everyday use')])),
    ).toBe('Link · Discover handcrafted leather…');
  });

  it('images: alt, else a readable file name, else just "Image"', () => {
    expect(semanticName(el('img', { attrs: { alt: 'Leather tote' } }))).toBe(
      'Image · Leather tote',
    );
    expect(
      semanticName(
        el('img', { attrs: { src: 'https://cdn.x/up/2026/01/leather-tote-800x600.jpg?v=2' } }),
      ),
    ).toBe('Image · Leather tote');
    expect(semanticName(el('img', { attrs: { src: 'https://cdn.x/a8f3e2b19c4d.png' } }))).toBe(
      'Image',
    );
  });

  it('form controls: label or placeholder; submit inputs are buttons', () => {
    const control = (
      kind: 'text' | 'other',
      inputType: string,
      t: string,
      isPlaceholder: boolean,
    ) => ({
      kind,
      inputType,
      text: t,
      isPlaceholder,
      placeholderColor: '',
    });
    expect(
      semanticName(el('input', { control: control('text', 'email', 'Email address', true) })),
    ).toBe('Input · Email address');
    expect(
      semanticName(el('input', { control: control('text', 'email', 'me@x.com', false) })),
    ).toBe('Input'); // the typed value is not used as a name
    expect(
      semanticName(el('input', { control: control('text', 'submit', 'Sign in', false) })),
    ).toBe('Button · Sign in');
    expect(semanticName(el('input', { control: control('other', 'checkbox', '', false) }))).toBe(
      'Checkbox',
    );
  });

  it('svg: small = icon (with its label), large = graphic', () => {
    const small = { rect: { x: 0, y: 0, width: 24, height: 24 } };
    expect(semanticName(el('svg', small))).toBe('Icon');
    expect(semanticName(el('svg', { ...small, attrs: { ariaLabel: 'Search' } }))).toBe(
      'Icon · Search',
    );
    expect(semanticName(el('svg', { rect: { x: 0, y: 0, width: 600, height: 300 } }))).toBe(
      'Graphic',
    );
  });

  it('generic boxes: readable class or id, never generated or utility classes', () => {
    expect(semanticName(el('div', { classes: ['jsx-2630333056', 'product-card-wrapper'] }))).toBe(
      'Product card wrapper',
    );
    expect(semanticName(el('div', { classes: ['flex', 'p-4', 'mt-2', 'md:grid'] }))).toBe('Box');
    expect(semanticName(el('div', { classes: ['css-1x2y3z4', 'sc-bdVaJa'] }))).toBe('Box');
    expect(semanticName(el('div', { idAttr: 'top-header' }))).toBe('Top header');
    expect(semanticName(el('span'))).toBe('Span');
    expect(semanticName(el('::before'))).toBe('::before');
  });
});

describe('helpers', () => {
  it('humanize', () => {
    expect(humanize('productCard__title--large')).toBe('Product card title large');
    expect(humanize('qs-fb__mat')).toBe('Qs fb mat');
  });
  it('readableClass skips hashed, utility and state classes', () => {
    expect(readableClass({ classes: ['is-active', 'jsx-123', 'price-tag'], idAttr: '' })).toBe(
      'Price tag',
    );
    expect(readableClass({ classes: ['hidden', 'sm:block'], idAttr: '' })).toBeNull();
  });
});
