import { TIERS, type FundAllocation, type Tier, type WaterfallResult } from '../../engine';
import { money, shortDate } from '../format';
import type { Flow } from '../state';

/**
 * The tier chart: one horizontal stacked bar per distribution, split into the four places the
 * money went. Hand-written SVG, so every shape is visible in the code.
 *
 * Chart rules from the dataviz guidance:
 *  - one bar per row, ≤ 24px thick, growing from a single baseline;
 *  - a 2px gap (empty space) between stacked segments, instead of drawn borders;
 *  - 4px rounded corners only at the data end, square at the baseline;
 *  - hairline gridlines, a hover tooltip on every segment, and a table view as an alternative;
 *  - the GP's share is hatched (texture), so identity never depends on color alone.
 */

/** One color per tier, in payment order (fixed categorical order, never cycled). */
export const TIER_STYLE = {
  ROC: { label: 'Return of capital', color: 'var(--tier-roc)' },
  PREF: { label: 'Preferred return', color: 'var(--tier-pref)' },
  CATCHUP: { label: 'GP catch-up', color: 'var(--tier-catchup)' },
  SPLIT: { label: 'Profit split', color: 'var(--tier-split)' },
} as const satisfies Record<Tier, { label: string; color: string }>;

/**
 * The pieces of one bar, in drawing order. Each tier can have an LP part (solid) and a GP part
 * (hatched in the same color). Color says which tier, texture says who gets it, so neither
 * relies on telling six colors apart.
 */
export interface Piece {
  tier: Tier;
  who: 'LP' | 'GP';
  amount: number;
}

export function piecesFor(allocations: FundAllocation[], eventId: string): Piece[] {
  const pieces: Piece[] = [];
  for (const tier of TIERS) {
    const row = allocations.find((a) => a.eventId === eventId && a.tier === tier);
    pieces.push({ tier, who: 'LP', amount: row?.lp ?? 0 });
    pieces.push({ tier, who: 'GP', amount: row?.gp ?? 0 });
  }
  return pieces;
}

const W_FALLBACK = 760;
const LABEL_W = 78;
const RIGHT_W = 64;
const ROW_H = 38;
const BAR_H = 20;
const GAP = 2;
const AXIS_H = 22;

export interface ChartHandlers {
  onSelect: (eventId: string) => void;
  onHover: (e: MouseEvent, eventId: string, piece: Piece | null) => void;
  onLeave: () => void;
}

export function renderChart(
  root: HTMLElement,
  dists: Flow[],
  result: WaterfallResult,
  selected: string | null,
  h: ChartHandlers,
): void {
  const sorted = [...dists].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (sorted.length === 0) {
    root.innerHTML = '<p class="hint">Add a distribution to see how it is split.</p>';
    return;
  }

  // Draw at the container's real pixel width so 12px text stays 12px on a phone.
  const W = Math.max(300, Math.round(root.clientWidth) || W_FALLBACK);
  const plotW = W - LABEL_W - RIGHT_W;
  const maxAmount = Math.max(...sorted.map((d) => d.amount), 1e-9);
  const ticks = niceTicks(maxAmount, W < 500 ? 3 : 5);
  const xMax = ticks.at(-1)!;
  const x = (v: number) => (v / xMax) * plotW;
  const height = sorted.length * ROW_H + AXIS_H;

  let svg = `<svg viewBox="0 0 ${W} ${height}" role="img" aria-label="Stacked bars: how each distribution was split across the waterfall tiers">`;
  svg += hatchDefs();

  // Gridlines and tick labels first, so the bars draw on top.
  svg += '<g class="axis">';
  for (const t of ticks) {
    const gx = LABEL_W + x(t);
    svg += `<line class="grid" x1="${gx}" x2="${gx}" y1="0" y2="${height - AXIS_H}"/>`;
    svg += `<text x="${gx}" y="${height - 6}" text-anchor="middle">${t === 0 ? '0' : `$${t}m`}</text>`;
  }
  svg += '</g>';

  sorted.forEach((d, i) => {
    const y0 = i * ROW_H;
    const barY = y0 + (ROW_H - BAR_H) / 2;
    const pieces = piecesFor(result.allocations, d.id);
    const nonZero = pieces.filter((p) => p.amount > 1e-12);

    // A full-width transparent rectangle makes the whole row clickable and hoverable, not just the thin bar.
    svg += `<rect class="row-hit ${d.id === selected ? 'selected' : ''}" data-row="${d.id}" x="0" y="${y0}" width="${W}" height="${ROW_H}" rx="6"/>`;
    svg += `<text class="row-label" x="0" y="${barY + BAR_H / 2 + 4}">${shortDate(d.date)}</text>`;

    let cursor = LABEL_W;
    nonZero.forEach((p, j) => {
      const isLast = j === nonZero.length - 1;
      const full = x(p.amount);
      // Leave a 2px gap after every segment except the last, if there's room for it.
      const w = isLast || full <= GAP ? full : full - GAP;
      const fill = p.who === 'GP' ? `url(#hatch-${p.tier})` : TIER_STYLE[p.tier].color;
      const i = pieces.indexOf(p);
      svg += `<path class="seg" data-row="${d.id}" data-piece="${i}" fill="${fill}" d="${barPath(cursor, barY, Math.max(w, 0.5), BAR_H, isLast ? 4 : 0)}"/>`;
      cursor += full;
    });

    svg += `<text class="total-label" x="${cursor + 8}" y="${barY + BAR_H / 2 + 4}">${money(d.amount)}</text>`;
  });

  svg += '</svg>';
  root.innerHTML = svg;

  root.querySelectorAll<SVGElement>('[data-row]').forEach((el) => {
    const id = el.dataset.row!;
    const piece = el.dataset.piece === undefined ? null : piecesFor(result.allocations, id)[Number(el.dataset.piece)]!;
    el.addEventListener('click', () => h.onSelect(id));
    el.addEventListener('mousemove', (e) => h.onHover(e, id, piece));
    el.addEventListener('mouseleave', h.onLeave);
  });
}

/**
 * Diagonal-stripe patterns, one per tier: a pale wash of the tier color with solid stripes.
 * Used for the GP's part of each tier.
 */
export function hatchDefs(): string {
  return `<defs>${TIERS.map(
    (t) => `<pattern id="hatch-${t}" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
      <rect width="6" height="6" fill="${TIER_STYLE[t].color}" opacity="0.35"/>
      <rect width="3" height="6" fill="${TIER_STYLE[t].color}"/>
    </pattern>`,
  ).join('')}</defs>`;
}

/**
 * A rectangle with only its right-hand (data-end) corners rounded.
 * SVG <rect rx> would round all four corners, so we draw the outline as a path.
 */
function barPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2);
  return [
    `M${x},${y}`,
    `H${x + w - rr}`,
    rr ? `Q${x + w},${y} ${x + w},${y + rr}` : '',
    `V${y + h - rr}`,
    rr ? `Q${x + w},${y + h} ${x + w - rr},${y + h}` : '',
    `H${x}`,
    'Z',
  ].join(' ');
}

/** Round axis ticks: steps of 1, 2 or 5 × 10^k, about `count` of them. */
export function niceTicks(max: number, count: number): number[] {
  const rough = max / count;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rough)!;
  const ticks: number[] = [];
  for (let t = 0; t < max + step - 1e-9; t += step) ticks.push(Number(t.toPrecision(12)));
  return ticks;
}
