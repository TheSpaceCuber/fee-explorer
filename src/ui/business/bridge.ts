import type { Bridge, FundMetrics } from '../../engine';
import { money, multiple, pct } from '../format';

/**
 * Gross-to-net bridge: where the deals' profit went.
 *
 *   Gross profit ─ fees ─ carry paid ─ accrued carry ═ net profit to partners
 *
 * Drawn as a horizontal "waterfall chart": the first and last bars start at zero, and each
 * deduction floats, starting where the running total left off. Everything the GP receives
 * (fees, carry) is hatched, the same convention as the tier chart.
 *
 * Below it, the same story in IRR terms: deals → after fees → LP net.
 */
interface Step {
  key: string;
  label: string;
  value: number;
  kind: 'total' | 'minus' | 'plus';
  color: string;
  hatched: boolean;
  note: string;
}

export function renderBridge(root: HTMLElement, m: FundMetrics): void {
  const b: Bridge = m.bridge;
  if (b.grossProfit <= 0) {
    root.innerHTML = `<p class="hint">The deals made no profit (gross profit ${money(b.grossProfit, 2)}), so there's nothing to bridge.
      LPs lose their fees on top: net ${money(b.netProfit, 2)}.</p>`;
    return;
  }

  const steps: Step[] = [
    { key: 'gross', label: 'Gross profit', value: b.grossProfit, kind: 'total', color: 'var(--tier-roc)', hatched: false, note: `Distributions + NAV − ${money(b.investment)} invested` },
    { key: 'fees', label: 'Management fees', value: b.fees, kind: 'minus', color: 'var(--tier-pref)', hatched: true, note: 'Paid to the GP whatever the result' },
    { key: 'carry', label: 'Carry paid', value: b.carryPaid, kind: 'minus', color: 'var(--tier-split)', hatched: true, note: 'From the waterfall' },
    { key: 'accrued', label: 'Accrued carry', value: b.accruedCarry, kind: 'minus', color: 'var(--tier-split)', hatched: true, note: 'On the NAV, if sold' },
    ...(b.clawback > 0
      ? [{ key: 'clawback', label: 'Clawback', value: b.clawback, kind: 'plus' as const, color: 'var(--tier-catchup)', hatched: false, note: 'Excess carry the GP pays back' }]
      : []),
    { key: 'net', label: 'Net profit', value: b.netProfit, kind: 'total', color: 'var(--tier-roc)', hatched: false, note: 'To all partners' },
  ];

  const W = Math.max(300, Math.round(root.clientWidth) || 760);
  const LABEL = W < 500 ? 104 : 130;
  const RIGHT = 70;
  const ROW = 34;
  const BAR = 20;
  const plotW = W - LABEL - RIGHT;
  // The running total can go above gross profit only by the clawback, so scale to the larger of the two.
  const scaleMax = Math.max(b.grossProfit, b.netProfit);
  const x = (v: number) => LABEL + (Math.max(0, v) / scaleMax) * plotW;
  const H = steps.length * ROW;

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Bridge from gross profit to net profit">`;
  svg += `<defs>${['pref', 'split'].map((t) => `<pattern id="bridge-hatch-${t}" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
      <rect width="6" height="6" fill="var(--tier-${t})" opacity="0.35"/><rect width="3" height="6" fill="var(--tier-${t})"/></pattern>`).join('')}</defs>`;

  let running = b.grossProfit;
  steps.forEach((s, i) => {
    const yTop = i * ROW + (ROW - BAR) / 2;
    let from: number;
    let to: number;
    if (s.kind === 'total') {
      from = 0;
      to = s.value;
    } else if (s.kind === 'minus') {
      from = running - s.value;
      to = running;
      running = from;
    } else {
      from = running;
      to = running + s.value;
      running = to;
    }
    const fill = s.hatched ? `url(#bridge-hatch-${s.key === 'fees' ? 'pref' : 'split'})` : s.color;
    svg += `<text class="row-label" x="0" y="${yTop + BAR / 2 + 4}">${s.label}</text>`;
    if (to - from > 1e-12) svg += `<rect x="${x(from)}" y="${yTop}" width="${Math.max(1, x(to) - x(from))}" height="${BAR}" rx="3" fill="${fill}"><title>${s.label}: ${money(s.value, 2)} · ${s.note}</title></rect>`;
    // Thin connector from the end of this bar to the next row, so the eye can follow the running total.
    const end = s.kind === 'minus' ? from : to;
    if (i < steps.length - 1) svg += `<line class="connector" x1="${x(end)}" x2="${x(end)}" y1="${yTop + BAR}" y2="${yTop + ROW}"/>`;
    svg += `<text class="total-label" x="${x(to) + 8}" y="${yTop + BAR / 2 + 4}">${s.kind === 'minus' ? '−' : s.kind === 'plus' ? '+' : ''}${money(s.value, 1)}</text>`;
  });
  svg += '</svg>';

  const irr = (v: number | null) => pct(v);
  root.innerHTML = `${svg}
    <div class="irr-steps">
      <div><span class="t-label">Deals (gross)</span><strong>${irr(b.grossIrr)}</strong><span class="t-note">${multiple(b.grossMoic)} MOIC</span></div>
      <div class="arrow">→</div>
      <div><span class="t-label">After fees</span><strong>${irr(b.irrAfterFees)}</strong><span class="t-note">before carry</span></div>
      <div class="arrow">→</div>
      <div><span class="t-label">LP net</span><strong>${irr(m.irr)}</strong><span class="t-note">${multiple(m.tvpi)} TVPI</span></div>
    </div>
    <p class="hint">Fund level, all partners (the GP's own commitment included). The gap between gross and net IRR is the "fee and carry drag".
      It always adds up: every distributed dollar goes to a partner or to carry, and fees are paid in on top of the investment.</p>`;
}
