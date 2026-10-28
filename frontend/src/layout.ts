// Tile layout engine. Pure functions: (count, available box) → tile rects +
// where the campfire sits. Rects are absolute within the stage, so tiles can
// physically glide between arrangements via CSS transitions.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  rects: Rect[];
  fire: { x: number; y: number; size: number }; // base point + height, stage coords
  fireAlpha: number;
}

const GAP = 16;

export function gridLayout(n: number, W: number, H: number, aspect: number): Layout {
  const fireBottom = { x: W / 2, y: H + 30, size: Math.min(240, H * 0.32) };
  if (n === 0) return { rects: [], fire: { x: W / 2, y: H * 0.66, size: Math.min(220, H * 0.35) }, fireAlpha: 1 };

  let best = { cols: 1, w: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const w = Math.min((W - GAP * (cols - 1)) / cols, ((H - GAP * (rows - 1)) / rows) * aspect);
    if (w > best.w) best = { cols, w };
  }
  const w = Math.min(best.w, 880);
  const h = w / aspect;
  const cols = best.cols;
  const rows = Math.ceil(n / cols);
  const totalH = rows * h + (rows - 1) * GAP;
  const y0 = (H - totalH) / 2;
  const rects: Rect[] = [];
  for (let r = 0; r < rows; r++) {
    const inRow = r < rows - 1 ? cols : n - cols * (rows - 1);
    const rowW = inRow * w + (inRow - 1) * GAP;
    const x0 = (W - rowW) / 2;
    for (let c = 0; c < inRow; c++) rects.push({ x: x0 + c * (w + GAP), y: y0 + r * (h + GAP), w, h });
  }
  return { rects, fire: fireBottom, fireAlpha: 0.55 };
}

// Tiles sit on an ellipse around the fire; the empty middle is the point.
export function circleLayout(n: number, W: number, H: number, aspect: number): Layout {
  const cx = W / 2;
  const cy = H / 2;
  if (n === 0) return { rects: [], fire: { x: cx, y: cy + 90, size: Math.min(220, H * 0.36) }, fireAlpha: 1 };

  if (n === 1) {
    const w = Math.min(W * 0.62, (H * 0.5) * aspect, 620);
    const h = w / aspect;
    const fireSize = Math.min(150, H * 0.24);
    const top = (H - h - fireSize * 0.9) / 2;
    return {
      rects: [{ x: cx - w / 2, y: top, w, h }],
      fire: { x: cx, y: top + h + fireSize * 0.95, size: fireSize },
      fireAlpha: 1,
    };
  }

  // The middle belongs to the fire: tiles shrink until they clear the hearth
  const hearth = Math.min(W, H) * 0.34;
  const fireSize = Math.max(80, Math.min(230, hearth * 0.8));
  const fireBase = cy + fireSize * 0.42;
  const hearthRect: Rect = { x: cx - hearth * 0.42, y: fireBase - fireSize * 1.05, w: hearth * 0.84, h: fireSize * 1.15 };

  // Start angle chosen so small groups sit around the fire, not on top of it
  const start = n === 2 ? 0 : n === 4 ? -Math.PI / 4 : -Math.PI / 2;
  let w = Math.min(W, H * aspect) * (n <= 3 ? 0.44 : n <= 5 ? 0.36 : 0.3);
  let placed: Rect[] = [];
  for (let iter = 0; iter < 60; iter++) {
    const h = w / aspect;
    const rx = Math.max(0, W / 2 - w / 2 - 8);
    const ry = Math.max(0, H / 2 - h / 2 - 8);
    placed = [];
    for (let i = 0; i < n; i++) {
      const a = start + (i / n) * Math.PI * 2;
      placed.push({ x: cx + Math.cos(a) * rx - w / 2, y: cy + Math.sin(a) * ry - h / 2, w, h });
    }
    if (!overlaps(placed) && !placed.some((r) => intersects(r, hearthRect, 0))) break;
    w *= 0.95;
  }
  return { rects: placed, fire: { x: cx, y: fireBase, size: fireSize }, fireAlpha: 1 };
}

function intersects(a: Rect, b: Rect, gap: number): boolean {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}

function overlaps(rs: Rect[]): boolean {
  for (let i = 0; i < rs.length; i++) {
    for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i], b = rs[j];
      if (a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP) return true;
    }
  }
  return false;
}
