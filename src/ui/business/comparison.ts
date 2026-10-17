import { dayNumber } from '../../engine/daycount';
import type { FundInput, WaterfallResult } from '../../engine';
import { money, shortDate } from '../format';
import { niceTicks } from './chart';

/**
 * American vs European on the same cash flows: cumulative GP carry over time.
 *
 * American usually pays carry earlier (deal by deal), European later (only once the whole fund
 * is in profit). At the end, the clawback pulls American down to at most European. That drop is
 * drawn as a dashed line.
 *
 * Two series → a legend plus direct labels at the line ends. Lines are 2px with round joins.
 */
const COLORS = { european: 'var(--tier-roc)', american: 'var(--tier-pref)' };

interface Point {
  day: number;
  value: number;
}

function cumulative(input: FundInput, result: WaterfallResult): Point[] {
  const dists = input.events.filter((e) => e.kind === 'distribution');
  const points: Point[] = [{ day: dayNumber(input.events[0]!.date), value: 0 }];
  let total = 0;
  for (const e of dists) {
    total += result.allocations.filter((a) => a.eventId === e.id).reduce((s, a) => s + a.gp, 0);
    points.push({ day: dayNumber(e.date), value: total });
  }
  return points;
}

/** A step line: flat until the next payment, then up. */
function stepPath(points: Point[], x: (d: number) => number, y: (v: number) => number): string {
  let d = `M${x(points[0]!.day)},${y(points[0]!.value)}`;
  for (let i = 1; i < points.length; i++) d += ` H${x(points[i]!.day)} V${y(points[i]!.value)}`;
  return d;
}

export function renderComparison(root: HTMLElement, input: FundInput, result: WaterfallResult): void {
  const c = result.comparison;
  if (!c) {
    root.innerHTML = '';
    return;
  }
  const am = cumulative(input, result);
  const eu = cumulative(input, c.european);
  const endDay = dayNumber(c.date);
  const amPaid = am.at(-1)!.value;
  const euPaid = eu.at(-1)!.value;
  const amAccrued = result.liquidation?.gp ?? 0;
  const euAccrued = c.european.liquidation?.gp ?? 0;
  const kept = c.americanCarry - c.clawback;

  const W = Math.max(300, Math.round(root.clientWidth) || 760);
  const H = 220;
  const LEFT = 48;
  const RIGHT = W < 500 ? 70 : 110;
  const TOP = 12;
  const BOTTOM = 24;
  const startDay = am[0]!.day;
  const maxV = Math.max(c.americanCarry, c.europeanCarry, 1e-9);
  const ticks = niceTicks(maxV, 4);
  const x = (d: number) => LEFT + ((d - startDay) / Math.max(1, endDay - startDay)) * (W - LEFT - RIGHT);
  const y = (v: number) => TOP + (1 - v / ticks.at(-1)!) * (H - TOP - BOTTOM);

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulative GP carry over time, American versus European">`;
  for (const t of ticks) {
    svg += `<line class="grid" x1="${LEFT}" x2="${W - RIGHT}" y1="${y(t)}" y2="${y(t)}"/>`;
    svg += `<text class="axis-label" x="${LEFT - 6}" y="${y(t) + 4}" text-anchor="end">${t === 0 ? '0' : `$${t}m`}</text>`;
  }
  const firstYear = new Date(startDay * 86_400_000).getUTCFullYear();
  const lastYear = new Date(endDay * 86_400_000).getUTCFullYear();
  const yearStep = lastYear - firstYear > 8 ? 2 : 1;
  for (let yr = firstYear + 1; yr <= lastYear; yr += yearStep) {
    const d = dayNumber(`${yr}-01-01`);
    svg += `<text class="axis-label" x="${x(d)}" y="${H - 6}" text-anchor="middle">${yr}</text>`;
  }

  // Each line: paid steps, then (dashed) to the end date including accrued carry on the NAV.
  const line = (pts: Point[], paid: number, accrued: number, color: string) => {
    let s = `<path d="${stepPath(pts, x, y)}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    s += `<path d="M${x(pts.at(-1)!.day)},${y(paid)} H${x(endDay)} V${y(paid + accrued)}" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="${accrued > 0 ? '4 3' : '0'}"/>`;
    return s;
  };
  svg += line(eu, euPaid, euAccrued, COLORS.european);
  svg += line(am, amPaid, amAccrued, COLORS.american);

  // The clawback: a dashed drop on the American line at the end.
  if (c.clawback > 1e-9) {
    svg += `<line x1="${x(endDay)}" x2="${x(endDay)}" y1="${y(c.americanCarry)}" y2="${y(kept)}" stroke="${COLORS.american}" stroke-width="2" stroke-dasharray="2 3"/>`;
    svg += `<circle cx="${x(endDay)}" cy="${y(kept)}" r="4" fill="${COLORS.american}" stroke="var(--surface-1)" stroke-width="2"/>`;
  }
  // Direct labels at the right edge.
  const labelY = (v: number) => y(v) + 4;
  const amLabelV = c.clawback > 1e-9 ? c.americanCarry : kept;
  let euY = labelY(c.europeanCarry);
  const amY = labelY(amLabelV);
  if (Math.abs(euY - amY) < 14) euY = amY + (euY >= amY ? 14 : -14);
  svg += `<text class="total-label" x="${x(endDay) + 8}" y="${amY}">American ${money(amLabelV)}</text>`;
  svg += `<text class="total-label" x="${x(endDay) + 8}" y="${euY}">European ${money(c.europeanCarry)}</text>`;
  svg += '</svg>';

  const lossNote =
    (input.terms.lossRecovery ?? 'realized') === 'none'
      ? 'Losses on deals already sold are ignored, so the GP can earn carry on winners while losers add nothing back.'
      : 'Losses on deals already sold must be recovered from later deals before more carry.';

  root.innerHTML = `
    <div class="legend">
      <span><i class="swatch" style="background:${COLORS.american}"></i>American (deal by deal)</span>
      <span><i class="swatch" style="background:${COLORS.european}"></i>European (whole fund), same cash flows</span>
    </div>
    ${svg}
    <div class="table-scroll"><table>
      <thead><tr><th></th><th>Carry paid</th><th>Accrued on NAV</th><th>Total</th><th>Clawback</th><th>GP keeps</th></tr></thead>
      <tbody>
        <tr><td>American</td><td>${money(amPaid, 2)}</td><td>${money(amAccrued, 2)}</td><td>${money(c.americanCarry, 2)}</td><td>${money(c.clawback, 2)}</td><td><strong>${money(kept, 2)}</strong></td></tr>
        <tr><td>European</td><td>${money(euPaid, 2)}</td><td>${money(euAccrued, 2)}</td><td>${money(c.europeanCarry, 2)}</td><td>—</td><td>${money(c.europeanCarry, 2)}</td></tr>
      </tbody>
    </table></div>
    <p class="hint">${lossNote} At the end (${shortDate(c.date)}${input.nav ? ', if the NAV were sold' : ''}) the GP must give back any carry above the
      European figure: <strong>clawback ${money(c.clawback, 2)}</strong>. American isn't always more carry in total, but it is earlier. The LP's risk is
      that money already paid out has to be clawed back later, which is why LPAs often add escrows or guarantees.</p>`;
}
