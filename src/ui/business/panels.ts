import { partnersCashFlows, xirr, type FundInput, type FundMetrics, type PartnerResult, type WaterfallResult } from '../../engine';
import { esc, money, multiple, pct, shortDate } from '../format';
import { PARTNER_TYPES, type Flow, type UiState } from '../state';
import { piecesFor, TIER_STYLE } from './chart';

/** Headline numbers. One tile per metric, with a one-line note on what it means. */
export function renderTiles(root: HTMLElement, m: FundMetrics, state: UiState): void {
  const c = state.terms.carryRate;
  const share = m.gpShareOfProfit;
  let shareNote = `Target ${pct(c, 0)}`;
  if (share !== null) {
    if (state.terms.catchUpRate === 0) shareNote = `Below ${pct(c, 0)}: no catch-up, so the pref is carry-free`;
    else if (share < c - 1e-6) shareNote = `Below ${pct(c, 0)}: still in the catch-up zone`;
    else shareNote = `Fully caught up to ${pct(c, 0)}`;
  }

  const tiles: [string, string, string][] = [
    ['Paid in', money(m.paidIn), m.fees > 0 ? `Includes ${money(m.fees)} of fees` : 'Capital the LPs contributed'],
    ['Distributed to LPs', money(m.distributedLp), 'Cash back, after carry'],
    ['Management fees', money(m.fees), m.fees > 0 ? `${pct(m.fees / m.paidIn)} of paid-in` : 'Fees are off'],
    ['GP carry paid', money(m.carryGp), m.accruedCarry > 0 ? `+ ${money(m.accruedCarry)} accrued on NAV` : 'Cash actually paid to the GP'],
    ['GP share of profit', pct(share), shareNote],
    ['DPI', multiple(m.dpi), 'Cash back per $1 paid in'],
    ['TVPI', multiple(m.tvpi), m.nav > 0 ? `Includes ${money(m.netNav)} net NAV` : 'Same as DPI: no NAV left'],
    ['Net IRR', pct(m.irr), `LPs, after fees and carry · gross ${pct(m.bridge.grossIrr)}`],
  ];
  root.innerHTML = tiles
    .map(([label, value, note]) => `<div class="tile"><div class="t-label">${label}</div><div class="t-value">${value}</div><div class="t-note">${note}</div></div>`)
    .join('');
}

export function renderLegend(root: HTMLElement): void {
  root.innerHTML =
    Object.values(TIER_STYLE)
      .map((s) => `<span><i class="swatch" style="background:${s.color}"></i>${s.label}</span>`)
      .join('') + '<span><i class="swatch hatched"></i>Hatched = paid to the GP</span>';
}

/** The chart's table view: the same numbers, readable without color. */
export function renderAllocTable(root: HTMLElement, dists: Flow[], result: WaterfallResult): void {
  const sorted = [...dists].sort((a, b) => (a.date < b.date ? -1 : 1));
  const cols = piecesFor([], '').map((p) => ({ tier: p.tier, who: p.who }));
  const header = cols.map((c) => `<th>${TIER_STYLE[c.tier].label} → ${c.who}</th>`).join('');
  const totals = cols.map(() => 0);
  let amountTotal = 0;

  const rows = sorted.map((d) => {
    const pieces = piecesFor(result.allocations, d.id);
    amountTotal += d.amount;
    pieces.forEach((p, i) => (totals[i]! += p.amount));
    return `<tr><td>${shortDate(d.date)}</td><td>${money(d.amount, 2)}</td>${pieces.map((p) => `<td>${money(p.amount, 2)}</td>`).join('')}</tr>`;
  });

  let navRow = '';
  if (result.liquidation) {
    const pieces = piecesFor(result.liquidation.allocations, result.liquidation.allocations[0]?.eventId ?? '');
    const total = result.liquidation.lp + result.liquidation.gp;
    navRow = `<tr class="hypothetical"><td>NAV, if sold</td><td>${money(total, 2)}</td>${pieces.map((p) => `<td>${money(p.amount, 2)}</td>`).join('')}</tr>`;
  }

  root.innerHTML = `<div class="table-scroll"><table>
    <thead><tr><th>Date</th><th>Distribution</th>${header}</tr></thead>
    <tbody>${rows.join('')}</tbody>
    <tfoot><tr><td>Total</td><td>${money(amountTotal, 2)}</td>${totals.map((t) => `<td>${money(t, 2)}</td>`).join('')}</tr>${navRow}</tfoot>
  </table></div>
  ${navRow ? '<p class="hint">The last row is not a real payment. It shows how the remaining NAV would be split if sold on its date. The GP part is the "accrued carry".</p>' : ''}`;
}

export function renderLpTable(root: HTMLElement, partners: PartnerResult[], state: UiState, input: FundInput): void {
  const ui = (id: string) => state.partners.find((p) => p.id === id);
  const typeLabel = (id: string) => PARTNER_TYPES.find(([t]) => t === ui(id)?.type)?.[1] ?? '';
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  const accrued = (p: PartnerResult) => sum(p.liquidation?.steps.map((x) => x.gp) ?? []);
  const navLp = (p: PartnerResult) => sum(p.liquidation?.steps.map((x) => x.lp) ?? []);
  const fees = (p: PartnerResult) => sum(p.fees.map((f) => f.amount));
  root.innerHTML = `<div class="table-scroll"><table>
    <thead><tr><th>Partner</th><th>Type</th><th>Commitment</th><th>Fees paid</th><th>Paid in</th><th>Distributed</th><th>Carry paid</th><th>Accrued carry</th><th>TVPI</th><th>Net IRR</th></tr></thead>
    <tbody>${partners
      .map((p) => {
        const tvpi = p.ledger.contributed > 0 ? (p.ledger.distributedLp + navLp(p)) / p.ledger.contributed : null;
        return `<tr><td>${esc(p.partnerId)}</td><td>${typeLabel(p.partnerId)}</td><td>${money(ui(p.partnerId)?.commitment ?? 0)}</td>
        <td>${money(fees(p), 2)}</td><td>${money(p.ledger.contributed, 2)}</td><td>${money(p.ledger.distributedLp, 2)}</td>
        <td>${money(p.ledger.distributedGp, 2)}</td><td>${money(accrued(p), 2)}</td>
        <td>${multiple(tvpi)}</td><td>${pct(xirr(partnersCashFlows(input, [p])))}</td></tr>`;
      })
      .join('')}</tbody>
  </table></div>
  <p class="hint">Each partner runs its own waterfall on its share of every flow, plus its own fee calls. Partners who pay lower fees
    contribute less, so their profit (and the carry on it) is higher and their net IRR is better. With identical terms everyone is exactly pro rata.</p>`;
}
