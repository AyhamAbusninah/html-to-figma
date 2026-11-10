/**
 * Adapter: executes a RenderPlan with the Figma Plugin API. The ONLY module (besides main/code.ts) touching `figma`.
 * Verification: FIGMA MOCK only so far (test/figma-mock.ts). Real-Figma behavior is unverified until R5 (B-1).
 */
import type {
  FontName,
  PlanBox,
  PlanNode,
  PlanImage,
  PlanPlaceholder,
  PlanSvg,
  PlanText,
  RenderPlan,
  SolidPaintSpec,
} from '../plan/plan.ts';

export interface RenderOutcome {
  root: FrameNode;
  layersCreated: number;
  layersFailed: { path: string; error: string }[];
  fontsFallback: { requested: FontName; used: FontName }[];
}

type BoxNode = FrameNode | RectangleNode;

const PLACEHOLDER_FILL: SolidPaint = {
  type: 'SOLID',
  color: { r: 0.9, g: 0.91, b: 0.93 },
  opacity: 1,
};
const PLACEHOLDER_STROKE: SolidPaint = {
  type: 'SOLID',
  color: { r: 0.6, g: 0.62, b: 0.66 },
  opacity: 1,
};
const FALLBACK_FONT: FontName = { family: 'Inter', style: 'Regular' };

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function applyCommon(node: SceneNode & BlendMixin & LayoutMixin, n: PlanNode) {
  node.name = n.name;
  node.x = n.x;
  node.y = n.y;
  node.opacity = n.opacity;
  if (n.blendMode) node.blendMode = n.blendMode as BlendMode;
}

function applyRadii(
  node: BoxNode,
  r: { tl: number; tr: number; br: number; bl: number } | undefined,
) {
  if (!r) return;
  node.topLeftRadius = r.tl;
  node.topRightRadius = r.tr;
  node.bottomRightRadius = r.br;
  node.bottomLeftRadius = r.bl;
}

function applyBox(node: BoxNode, n: PlanBox) {
  node.resize(Math.max(n.width, 0.01), Math.max(n.height, 0.01));
  applyCommon(node, n);
  // Gradients/images: drawn by Copy to Figma; the plugin keeps solid fills for now (reported as unsupported).
  node.fills = n.fills.filter((f): f is SolidPaintSpec => f.type === 'SOLID');
  if (n.strokes) {
    node.strokes = [n.strokes.paint];
    node.strokeAlign = 'INSIDE';
    node.strokeTopWeight = n.strokes.top;
    node.strokeRightWeight = n.strokes.right;
    node.strokeBottomWeight = n.strokes.bottom;
    node.strokeLeftWeight = n.strokes.left;
    if (n.strokes.dash) node.dashPattern = n.strokes.dash;
  }
  applyRadii(node, n.radii);
  if (n.effects.length) node.effects = n.effects as Effect[];
}

export async function executePlan(
  plan: RenderPlan,
  options: { rootName: string; rootX: number; onProgress?: (done: number, total: number) => void },
): Promise<RenderOutcome> {
  const outcome: Omit<RenderOutcome, 'root'> = {
    layersCreated: 0,
    layersFailed: [],
    fontsFallback: [],
  };

  // PLG-F-1: load every resolved font once, before creating text. Unloadable fonts fall back to Inter Regular.
  const loaded = new Map<string, FontName>();
  await figma.loadFontAsync(FALLBACK_FONT);
  for (const f of plan.fonts) {
    try {
      await figma.loadFontAsync(f);
      loaded.set(`${f.family}|${f.style}`, f);
    } catch {
      loaded.set(`${f.family}|${f.style}`, FALLBACK_FONT);
      outcome.fontsFallback.push({ requested: f, used: FALLBACK_FONT });
    }
  }

  const total = plan.counts.total;
  let done = 0;
  const tick = async () => {
    done++;
    if (done % 200 === 0) {
      options.onProgress?.(done, total);
      await new Promise((r) => setTimeout(r, 0)); // yield so Figma stays responsive (PLG-R-13)
    }
  };

  // Every node is registered the moment it exists, so a failure while configuring it can remove it (no orphans).
  let pending: SceneNode | null = null;
  const track = <T extends SceneNode>(node: T): T => {
    pending = node;
    return node;
  };

  const createText = (n: PlanText): TextNode => {
    const t = track(figma.createText());
    t.fontName = loaded.get(`${n.font.family}|${n.font.style}`) ?? FALLBACK_FONT;
    t.characters = n.characters;
    t.fontSize = n.fontSize;
    t.lineHeight = n.lineHeight;
    t.letterSpacing = n.letterSpacing;
    t.fills = [n.fill];
    t.textAlignHorizontal = n.align;
    t.textDecoration = n.decoration;
    t.textCase = n.textCase;
    t.name = n.name;
    t.opacity = n.opacity;
    t.y = n.y;
    if (n.autoResize === 'HEIGHT') {
      t.textAutoResize = 'HEIGHT';
      t.resize(Math.max(n.width, 1), t.height);
      t.x = n.x;
    } else {
      t.textAutoResize = 'WIDTH_AND_HEIGHT';
      // Anchor by the aligned edge so a wider substitute font grows away from it (PLG-R-9a).
      t.x =
        n.anchor === 'right'
          ? n.x + n.width - t.width
          : n.anchor === 'center'
            ? n.x + (n.width - t.width) / 2
            : n.x;
    }
    return t;
  };

  const createPlaceholder = (n: PlanPlaceholder | PlanImage | PlanSvg): RectangleNode => {
    const r = track(figma.createRectangle());
    r.resize(Math.max(n.width, 0.01), Math.max(n.height, 0.01));
    applyCommon(r, n);
    r.name = `${n.name} — ${n.reason}`;
    r.fills = [PLACEHOLDER_FILL];
    r.strokes = [PLACEHOLDER_STROKE];
    r.strokeAlign = 'INSIDE';
    r.strokeWeight = 1;
    r.dashPattern = [4, 4];
    applyRadii(r, n.radii);
    return r;
  };

  const createNode = (n: PlanNode): SceneNode => {
    if (n.kind === 'text') return createText(n);
    // Images/SVG: placeholders in the plugin for now (Copy to Figma draws them; plugin node creation pending).
    if (n.kind === 'placeholder' || n.kind === 'image' || n.kind === 'svg')
      return createPlaceholder(n);
    if (n.kind === 'rect') {
      const r = track(figma.createRectangle());
      applyBox(r, n);
      return r;
    }
    const f = track(figma.createFrame());
    applyBox(f, n);
    f.clipsContent = n.clipsContent;
    return f;
  };

  const build = async (n: PlanNode, parent: FrameNode, path: string): Promise<void> => {
    pending = null;
    let created: SceneNode | null;
    try {
      created = createNode(n);
      parent.appendChild(created);
      outcome.layersCreated++;
    } catch (e) {
      // PLG-R-11: skip this node, keep going; children are attempted under the nearest ancestor.
      outcome.layersFailed.push({ path, error: errorText(e) });
      (pending as SceneNode | null)?.remove();
      created = null;
    }
    await tick();
    if (n.kind === 'frame' || n.kind === 'rect') {
      const target = created && created.type === 'FRAME' ? created : parent;
      for (const [i, child] of n.children.entries()) await build(child, target, `${path}/${i}`);
    }
  };

  const root = figma.createFrame();
  if (plan.root.fills.length === 0)
    plan.root.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 1 }];
  applyBox(root, plan.root);
  root.name = options.rootName; // after applyBox, which sets the capture's own name
  root.x = options.rootX;
  root.y = 0;
  root.clipsContent = plan.root.clipsContent;
  outcome.layersCreated++;
  for (const [i, child] of plan.root.children.entries()) await build(child, root, `/root/${i}`);
  return { root, ...outcome };
}
