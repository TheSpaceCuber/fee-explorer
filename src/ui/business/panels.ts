import type { FundMetrics, PartnerResult, TraceStep, WaterfallResult } from '../../engine';
import { esc, money, multiple, pct, shortDate } from '../format';
import type { Flow, UiState } from '../state';
import { SEGMENTS, segmentsFor } from './chart';

/** Headline numbers. One tile per metric, with a one-line note on what it means. */
export function renderTiles(root: HTMLElement, m: FundMetrics): void {
  const tiles: [string, string, string][] = [
    ['Paid in', money(m.paidIn), 'Capital the LPs contributed'],
    ['Distributed to LPs', money(m.distributedLp), 'Cash back, after carry'],
    ['GP carry', money(m.carryGp), m.distributedLp + m.carryGp > 0 ? `${pct(m.carryGp / (m.distributedLp + m.carryGp))} of all distributions` : '—'],
    ['DPI', multiple(m.dpi), 'Cash back per $1 paid in'],
    ['TVPI', multiple(m.tvpi), m.nav > 0 ? `Includes ${money(m.nav)} NAV (gross)` : 'Same as DPI: no NAV left'],
    ['Net IRR', pct(m.irr), 'LP cash flows, after carry (XIRR)'],
  ];
  root.innerHTML = tiles
    .map(([label, value, note]) => `<div class="tile"><div class="t-label">${label}</div><div class="t-value">${value}</div><div class="t-note">${note}</div></div>`)
    .join('');
}

export function renderLegend(root: HTMLElement): void {
  root.innerHTML = SEGMENTS.map((s) => `<span><i class="swatch" style="background:${s.color}"></i>${s.label}</span>`).join('');
}

/** The chart's table view: the same numbers, readable without color. */
export function renderAllocTable(root: HTMLElement, dists: Flow[], result: WaterfallResult): void {
  const sorted = [...dists].sort((a, b) => (a.date < b.date ? -1 : 1));
  const totals = { amount: 0, ROC: 0, PREF: 0, SPLIT_LP: 0, SPLIT_GP: 0 };
  const rows = sorted.map((d) => {
    const s = segmentsFor(result, d.id);
    totals.amount += d.amount;
    for (const k of SEGMENTS) totals[k.key] += s[k.key];
    return `<tr><td>${shortDate(d.date)}</td><td>${money(d.amount, 2)}</td>${SEGMENTS.map((k) => `<td>${money(s[k.key], 2)}</td>`).join('')}</tr>`;
  });
  root.innerHTML = `<div class="table-scroll"><table>
    <thead><tr><th>Date</th><th>Distribution</th>${SEGMENTS.map((k) => `<th>${k.label}</th>`).join('')}</tr></thead>
    <tbody>${rows.join('')}</tbody>
    <tfoot><tr><td>Total</td><td>${money(totals.amount, 2)}</td>${SEGMENTS.map((k) => `<td>${money(totals[k.key], 2)}</td>`).join('')}</tr></tfoot>
  </table></div>`;
}

export function renderLpTable(root: HTMLElement, partners: PartnerResult[], state: UiState): void {
  const commit = (id: string) => state.partners.find((p) => p.id === id)?.commitment ?? 0;
  root.innerHTML = `<div class="table-scroll"><table>
    <thead><tr><th>LP</th><th>Commitment</th><th>Share</th><th>Paid in</th><th>Distributed to LP</th><th>Carry paid to GP</th><th>Capital still owed</th><th>Pref still owed</th></tr></thead>
    <tbody>${partners
      .map(
        (p) => `<tr><td>${esc(p.partnerId)}</td><td>${money(commit(p.partnerId))}</td><td>${pct(p.share)}</td>
        <td>${money(p.ledger.contributed, 2)}</td><td>${money(p.ledger.distributedLp, 2)}</td><td>${money(p.ledger.distributedGp, 2)}</td>
        <td>${money(Math.max(0, p.ledger.capitalOutstanding), 2)}</td><td>${money(Math.max(0, p.ledger.prefAccrued), 2)}</td></tr>`,
      )
      .join('')}</tbody>
  </table></div>
  <p class="hint">Each LP runs its own waterfall on its share of every flow. With identical terms the results are exactly pro rata. From M3, different fee rates per LP make them diverge.</p>`;
}

const TIER_INFO = {
  ROC: { n: 1, name: 'Return of capital', color: 'var(--tier-roc)' },
  PREF: { n: 2, name: 'Preferred return', color: 'var(--tier-pref)' },
  SPLIT: { n: 3, name: 'Profit split', color: 'var(--tier-split-lp)' },
} as const;

/**
 * Plain-English walkthrough of one distribution, tier by tier.
 * The steps come from the engine's trace for the fund as a whole (one combined LP), so the
 * numbers match the chart. M2 turns this into an animated step-through.
 */
export function renderTrace(
  root: HTMLElement,
  dists: Flow[],
  fundTrace: TraceStep[],
  selected: string | null,
  carryRate: number,
  onSelect: (id: string) => void,
): void {
  const sorted = [...dists].sort((a, b) => (a.date < b.date ? -1 : 1));
  const current = sorted.find((d) => d.id === selected) ?? sorted[0];
  if (!current) {
    root.innerHTML = '<h2>Follow one distribution</h2><p class="hint">No distributions yet.</p>';
    return;
  }
  const steps = fundTrace.filter((s) => s.eventId === current.id);
  const lpPct = Math.round((1 - carryRate) * 100);
  const gpPct = Math.round(carryRate * 100);

  root.innerHTML = `
    <div class="panel-head">
      <h2>Follow one distribution through the tiers</h2>
      <select id="trace-pick" aria-label="Distribution">
        ${sorted.map((d) => `<option value="${d.id}" ${d.id === current.id ? 'selected' : ''}>${shortDate(d.date)} · ${money(d.amount)}</option>`).join('')}
      </select>
    </div>
    <p class="hint" style="margin-bottom:10px">Cash goes down the tiers in order. Each tier takes what it's owed and passes the rest on. Click a bar in the chart to pick it.</p>
    <ol class="trace-steps">
      ${steps
        .map((s) => {
          const info = TIER_INFO[s.tier];
          const name = s.tier === 'SPLIT' ? `${info.name} (${lpPct}/${gpPct})` : info.name;
          const money2 = `${money(s.available, 2)} arrives → LP ${money(s.lp, 2)}${s.tier === 'SPLIT' ? `, GP ${money(s.gp, 2)}` : ''} → ${money(s.remaining, 2)} passed on`;
          // Dim tiers that paid nothing, so the eye goes to the ones that did.
          return `<li class="${s.lp + s.gp <= 1e-12 ? 'idle' : ''}">
            <span class="bar" style="background:${info.color}"></span>
            <div><span class="t-name">${info.n}. ${name}</span> <span class="t-money">${money2}</span>
            <p>${s.explanation}</p></div>
          </li>`;
        })
        .join('')}
    </ol>`;

  root.querySelector<HTMLSelectElement>('#trace-pick')!.addEventListener('change', (e) =>
    onSelect((e.target as HTMLSelectElement).value),
  );
}
