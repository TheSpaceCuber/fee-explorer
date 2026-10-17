import type { FeeLine } from '../../engine';
import { esc, money, pct, shortDate } from '../format';
import { niceTicks } from './chart';

/**
 * Management fees by quarter: one column per billing date (all partners added up).
 * The step-down shows as a drop in the columns after the investment period, and with an
 * invested-capital basis they keep falling as deals are sold.
 *
 * Single series, so no legend box: the panel title names it. Hover a column for the breakdown.
 */

interface Quarter {
  date: string;
  total: number;
  lines: FeeLine[];
}

export function quartersOf(fees: FeeLine[]): Quarter[] {
  const map = new Map<string, Quarter>();
  for (const f of fees) {
    const q = map.get(f.date) ?? { date: f.date, total: 0, lines: [] };
    q.total += f.amount;
    q.lines.push(f);
    map.set(f.date, q);
  }
  return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function renderFeeChart(
  root: HTMLElement,
  fees: FeeLine[],
  onHover: (e: MouseEvent, html: string) => void,
  onLeave: () => void,
): void {
  const quarters = quartersOf(fees);
  if (quarters.length === 0) {
    root.innerHTML = '<p class="hint">No management fees: turn them on in the inputs panel.</p>';
    return;
  }

  const W = Math.max(300, Math.round(root.clientWidth) || 760);
  const H = 170;
  const LEFT = 44;
  const BOTTOM = 22;
  const TOP = 8;
  const plotW = W - LEFT - 4;
  const plotH = H - BOTTOM - TOP;
  const ticks = niceTicks(Math.max(...quarters.map((q) => q.total), 1e-9), 4);
  const yMax = ticks.at(-1)!;
  const y = (v: number) => TOP + plotH - (v / yMax) * plotH;
  const slot = plotW / quarters.length;
  // Columns: at most 24px wide, with at least a 2px gap between neighbours.
  const colW = Math.max(1, Math.min(24, slot - 2));

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Column chart of management fees per quarter">`;
  for (const t of ticks) {
    svg += `<line class="grid" x1="${LEFT}" x2="${W}" y1="${y(t)}" y2="${y(t)}"/>`;
    svg += `<text class="axis-label" x="${LEFT - 6}" y="${y(t) + 4}" text-anchor="end">${t === 0 ? '0' : `$${t}m`}</text>`;
  }
  // Year labels along the bottom, once per year.
  let lastYear = '';
  quarters.forEach((q, i) => {
    const x = LEFT + i * slot + (slot - colW) / 2;
    const top = y(q.total);
    svg += `<path class="fee-col" data-i="${i}" d="${columnPath(x, top, colW, y(0) - top)}"/>`;
    const year = q.date.slice(0, 4);
    if (year !== lastYear) {
      svg += `<text class="axis-label" x="${x + colW / 2}" y="${H - 6}" text-anchor="middle">${year}</text>`;
      lastYear = year;
    }
  });
  // Wide invisible hit areas: the full slot, not just the thin column.
  quarters.forEach((_, i) => {
    svg += `<rect class="hit" data-i="${i}" x="${LEFT + i * slot}" y="${TOP}" width="${slot}" height="${plotH}"/>`;
  });
  svg += '</svg>';
  root.innerHTML = svg;

  root.querySelectorAll<SVGElement>('.hit').forEach((el) => {
    const q = quarters[Number(el.dataset.i)]!;
    el.addEventListener('mousemove', (e) => onHover(e, tooltipHtml(q)));
    el.addEventListener('mouseleave', onLeave);
  });
}

function tooltipHtml(q: Quarter): string {
  const rows = q.lines
    .map(
      (l) => `<div class="tt-row"><span>${esc(l.partnerId)}</span><span>${money(l.amount, 3)}</span></div>
        <div class="tt-sub">${pct(l.rate, 3)} × ${money(l.basisAmount, 2)} ${l.basis === 'commitment' ? 'commitment' : 'invested'} ÷ 4</div>`,
    )
    .join('');
  return `<div class="tt-title">Fees billed ${shortDate(q.date)} · ${money(q.total, 3)}</div>${rows}`;
}

/** A column with 4px rounded corners at the top (the data end), square at the baseline. */
function columnPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

/** The fee table: one row per partner per quarter would be long, so it shows totals per partner. */
export function renderFeeTable(root: HTMLElement, fees: FeeLine[]): void {
  if (fees.length === 0) {
    root.innerHTML = '';
    return;
  }
  const byPartner = new Map<string, { total: number; first: FeeLine; quarters: number }>();
  for (const f of fees) {
    const p = byPartner.get(f.partnerId) ?? { total: 0, first: f, quarters: 0 };
    p.total += f.amount;
    p.quarters += 1;
    byPartner.set(f.partnerId, p);
  }
  root.innerHTML = `<div class="table-scroll"><table>
    <thead><tr><th>Partner</th><th>Rate in investment period</th><th>Quarters billed</th><th>Total fees</th></tr></thead>
    <tbody>${[...byPartner.entries()]
      .map(([id, p]) => `<tr><td>${esc(id)}</td><td>${pct(p.first.rate, 3)}</td><td>${p.quarters}</td><td>${money(p.total, 2)}</td></tr>`)
      .join('')}</tbody>
  </table></div>`;
}
