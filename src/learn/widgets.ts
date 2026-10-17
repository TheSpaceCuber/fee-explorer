import { computeMetrics, runFund, xirr, partnersCashFlows, type Partner } from '../engine';
import { dayNumber } from '../engine/daycount';
import { niceTicks } from '../ui/business/chart';
import { renderFeeChart } from '../ui/business/fees';
import { esc, money, multiple, pct, shortDate } from '../ui/format';
import { hideTooltip, showTooltipHtml } from '../ui/tooltip';
import { exampleFund, standardFeeClass } from './funds';
import type { WidgetId } from './lessons';

/** Lessons 1–6 (basics and management fees). Lessons 7–11 (carry) are in widgets-carry.ts. */
import { keepFocus, onInput, onRadio, segmented, slider, stat, type Widget } from './widget-kit';
import { CARRY_WIDGETS } from './widgets-carry';
import { STRUCTURE_WIDGETS } from './widgets-structure';

// ------------------------------------------------------------------ 1. timeline

interface TimelineP {
  cumulative: boolean;
}

/** Calls below the line, distributions above, NAV at the end; optionally the LP's running total (the J-curve). */
const timeline: Widget<TimelineP> = {
  init: () => ({ cumulative: false }),
  input: () => exampleFund(),
  render(root, p, set) {
    const input = timeline.input(p);
    const flows = input.events.map((e) =>
      e.kind === 'capital_call'
        ? { date: e.date, amount: -(e.investment + e.fee), label: `Capital call · deal ${e.dealId}`, kind: 'call' as const }
        : { date: e.date, amount: e.amount, label: `Distribution · sale of deal ${e.dealId}`, kind: 'dist' as const },
    );
    const nav = input.nav!;
    let running = 0;
    const cum = flows.map((f) => ({ date: f.date, value: (running += f.amount) }));
    const low = cum.reduce((a, b) => (b.value < a.value ? b : a));

    const W = Math.max(300, Math.round(root.clientWidth) || 640);
    const H = 240;
    const L = 44, R = 12, T = 12, B = 26;
    const d0 = dayNumber('2020-01-01');
    const d1 = dayNumber('2028-06-30');
    const x = (date: string) => L + ((dayNumber(date) - d0) / (d1 - d0)) * (W - L - R);
    const maxUp = Math.max(...flows.map((f) => f.amount), nav.amount, p.cumulative ? Math.max(...cum.map((c) => c.value)) : 0);
    const maxDown = Math.max(...flows.map((f) => -f.amount), p.cumulative ? -low.value : 0);
    const upTicks = niceTicks(maxUp, 2);
    const downTicks = niceTicks(maxDown, 2);
    const top = upTicks.at(-1)!;
    const bottom = downTicks.at(-1)!;
    const y = (v: number) => T + ((top - v) / (top + bottom)) * (H - T - B);
    const barW = Math.max(6, Math.min(18, (W - L - R) / 30));

    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Timeline of capital calls (below the line) and distributions (above the line)">`;
    svg += `<defs><pattern id="tl-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
      <rect width="6" height="6" fill="var(--tier-roc)" opacity="0.3"/><rect width="3" height="6" fill="var(--tier-roc)"/></pattern></defs>`;
    for (const t of [...upTicks, ...downTicks.slice(1).map((v) => -v)]) {
      svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/>`;
      svg += `<text class="axis-label" x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${t === 0 ? '0' : `${t < 0 ? '−' : ''}$${Math.abs(t)}m`}</text>`;
    }
    // Every year when there's room, every other year on a phone.
    for (let yr = 2020; yr <= 2028; yr += W < 500 ? 2 : 1) svg += `<text class="axis-label" x="${x(`${yr}-07-01`)}" y="${H - 6}" text-anchor="middle">${yr}</text>`;
    svg += `<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="var(--text-muted)" stroke-width="1"/>`;

    const bars = [...flows, { date: nav.date, amount: nav.amount, label: 'Still held (NAV): value, not cash yet', kind: 'nav' as const }];
    bars.forEach((f, i) => {
      // NAV sits just after the last distribution so the two bars don't overlap.
      const cx = x(f.date) + (f.kind === 'nav' ? barW + 2 : 0);
      const y0 = y(0);
      const y1 = y(f.amount);
      const fill = f.kind === 'call' ? 'var(--tier-pref)' : f.kind === 'dist' ? 'var(--tier-roc)' : 'url(#tl-hatch)';
      svg += `<rect class="tl-bar" data-i="${i}" x="${cx - barW / 2}" y="${Math.min(y0, y1)}" width="${barW}" height="${Math.max(1, Math.abs(y1 - y0))}" rx="3" fill="${fill}"/>`;
    });

    if (p.cumulative) {
      const pts = [{ date: '2020-01-01', value: 0 }, ...cum, { date: nav.date, value: cum.at(-1)!.value }];
      let path = `M${x(pts[0]!.date)},${y(0)}`;
      for (let i = 1; i < pts.length; i++) path += ` H${x(pts[i]!.date)} V${y(pts[i]!.value)}`;
      svg += `<path d="${path}" fill="none" stroke="var(--text-primary)" stroke-width="2" stroke-linejoin="round"/>`;
      svg += `<circle cx="${x(low.date)}" cy="${y(low.value)}" r="4.5" fill="var(--text-primary)" stroke="var(--surface-1)" stroke-width="2"/>`;
      svg += `<text class="total-label" x="${x(low.date) + 8}" y="${y(low.value) + 16}">Lowest: ${money(low.value)} (${shortDate(low.date)})</text>`;
    }
    svg += '</svg>';

    root.innerHTML = `
      <label class="check"><input type="checkbox" id="tl-cum" ${p.cumulative ? 'checked' : ''}> Show the LP's running total (money back − money in)</label>
      <div class="legend">
        <span><i class="swatch" style="background:var(--tier-pref)"></i>Capital calls (LP pays in)</span>
        <span><i class="swatch" style="background:var(--tier-roc)"></i>Distributions (LP receives)</span>
        <span><i class="swatch hatched"></i>Still held (NAV)</span>
        ${p.cumulative ? '<span><i class="swatch" style="background:var(--text-primary);height:3px"></i>Running total</span>' : ''}
      </div>
      <div class="chart">${svg}</div>
      <p class="hint">Called ${money(-flows.filter((f) => f.kind === 'call').reduce((s, f) => s + f.amount, 0))} of the $100m commitment ·
        received ${money(flows.filter((f) => f.kind === 'dist').reduce((s, f) => s + f.amount, 0))} · still held ${money(nav.amount)}.</p>`;

    root.querySelector('#tl-cum')!.addEventListener('change', (e) => set({ cumulative: (e.target as HTMLInputElement).checked }));
    root.querySelectorAll<SVGRectElement>('.tl-bar').forEach((bar) => {
      const f = bars[Number(bar.dataset.i)]!;
      bar.addEventListener('mousemove', (e) =>
        showTooltipHtml(e, `<div class="tt-title">${shortDate(f.date)}</div><div class="tt-row"><span>${f.label}</span><span>${money(Math.abs(f.amount))}</span></div>`),
      );
      bar.addEventListener('mouseleave', hideTooltip);
    });
  },
};

// ------------------------------------------------------------------ 2. returns

interface ReturnsP {
  delay: number;
}

const returns: Widget<ReturnsP> = {
  init: () => ({ delay: 0 }),
  input: (p) => exampleFund({ delayYears: p.delay }),
  render(root, p, set) {
    keepFocus(root, () => {
      const input = returns.input(p);
      const m = computeMetrics(input, runFund(input));
      const base = computeMetrics(exampleFund(), runFund(exampleFund()));
      root.innerHTML = `
        ${slider('rt-delay', 'Delay every distribution by', p.delay, 0, 3, 0.5, `${p.delay} year${p.delay === 1 ? '' : 's'}`)}
        <div class="tiles">
          ${stat('IRR: the annual, timing-aware return', pct(m.irr), p.delay > 0 ? `was ${pct(base.irr)} with no delay, for the same money` : 'move the slider: watch this, and TVPI below', true)}
          ${stat('TVPI', multiple(m.tvpi), `(${money(m.distributedLp)} + ${money(m.nav)}) ÷ ${money(m.paidIn)}`)}
          ${stat('DPI', multiple(m.dpi), `${money(m.distributedLp)} ÷ ${money(m.paidIn)}`)}
          ${stat('Paid in', money(m.paidIn))}
          ${stat('Distributed', money(m.distributedLp))}
          ${stat('Still held (NAV)', money(m.nav))}
        </div>`;
      onInput(root, 'rt-delay', (v) => set({ delay: v }));
    });
  },
};

// ------------------------------------------------------------------ 3. fee rate

interface FeeRateP {
  rate: number;
}

const feeRate: Widget<FeeRateP> = {
  init: () => ({ rate: 0.02 }),
  input: (p) => exampleFund({ feeRate: p.rate }),
  render(root, p, set) {
    keepFocus(root, () => {
      const result = runFund(feeRate.input(p));
      const total = result.fees.reduce((s, f) => s + f.amount, 0);
      const quarter = result.fees[0]?.amount ?? 0;
      root.innerHTML = `
        ${slider('fr-rate', 'Annual fee rate', p.rate, 0, 0.025, 0.0025, pct(p.rate, 2))}
        <div class="tiles">
          ${stat('Fee charged each quarter', money(quarter, 2), `${pct(p.rate, 2)} a year ÷ 4 quarters × $100m committed`, true)}
          ${stat('Each year', money(quarter * 4, 2))}
          ${stat('Total, 2020–2027', money(total, 1), `${result.fees.length} quarters · ${pct(total / 100, 0)} of the commitment`)}
        </div>
        <p class="fig-caption"><strong>One column per quarter</strong>, 2020 to 2027. Flat, because the fee doesn't care how the deals are doing.</p>
        <div class="chart" id="fr-chart"></div>`;
      renderFeeChart(root.querySelector('#fr-chart')!, result.fees, showTooltipHtml, hideTooltip);
      onInput(root, 'fr-rate', (v) => set({ rate: v }));
    });
  },
};

// ------------------------------------------------------------------ 4. step-down

interface StepDownP {
  ipYears: number;
  basis: 'invested_capital' | 'commitment';
}

const stepDown: Widget<StepDownP> = {
  init: () => ({ ipYears: 5, basis: 'invested_capital' }),
  input: (p) => exampleFund({ feeRate: 0.02, ipYears: p.ipYears, postRate: 0.015, postBasis: p.basis }),
  render(root, p, set) {
    keepFocus(root, () => {
      const result = runFund(stepDown.input(p));
      const total = result.fees.reduce((s, f) => s + f.amount, 0);
      const flat = runFund(exampleFund({ feeRate: 0.02 })).fees.reduce((s, f) => s + f.amount, 0);
      root.innerHTML = `
        ${slider('sd-ip', 'Investment period', p.ipYears, 3, 7, 1, `${p.ipYears} years (to ${2020 + p.ipYears})`)}
        ${segmented('sd-basis', 'After that: 1.5% a year on', [['invested_capital', 'Invested capital'], ['commitment', 'Commitment']], p.basis)}
        <div class="tiles">
          ${stat('Total management fees, 2020–2027', money(total, 1), `2% on commitment, then 1.5% on ${p.basis === 'commitment' ? 'commitment' : 'invested capital'}`, true)}
          ${stat('Without a step-down', money(flat, 1), '2% on commitment throughout')}
          ${stat('Saved by the step-down', money(flat - total, 1))}
        </div>
        <p class="fig-caption"><strong>Fee per quarter.</strong> The step down comes at the end of the investment period; after that, each sale
          (mid-2023, end-2024, mid-2026, end-2027) shrinks invested capital and the fee with it. Hover a column to see its base.</p>
        <div class="chart" id="sd-chart"></div>`;
      renderFeeChart(root.querySelector('#sd-chart')!, result.fees, showTooltipHtml, hideTooltip);
      onInput(root, 'sd-ip', (v) => set({ ...p, ipYears: v }));
      onRadio(root, 'sd-basis', (v) => set({ ...p, basis: v as StepDownP['basis'] }));
    });
  },
};

// ------------------------------------------------------------------ 5. fee drag

interface FeeDragP {
  rate: number;
}

const feeDrag: Widget<FeeDragP> = {
  init: () => ({ rate: 0.02 }),
  input: (p) => exampleFund({ feeRate: p.rate, ipYears: 5 }),
  render(root, p, set) {
    keepFocus(root, () => {
      const input = feeDrag.input(p);
      const m = computeMetrics(input, runFund(input));
      const b = m.bridge;
      const scale = (v: number) => `${Math.max(0, (v / b.grossProfit) * 100)}%`;
      root.innerHTML = `
        ${slider('fd-rate', 'Fee rate in the investment period (then two-thirds of it)', p.rate, 0, 0.025, 0.0025, pct(p.rate, 2))}
        <div class="mini-bridge" role="img" aria-label="Gross profit ${money(b.grossProfit)}, minus fees ${money(b.fees)}, equals net profit ${money(b.netProfit)}">
          <div class="mb-row"><span>Gross profit (the deals)</span><div class="mb-track"><div class="mb-bar gross" style="width:100%"></div></div><span>${money(b.grossProfit)}</span></div>
          <div class="mb-row"><span>− Management fees</span><div class="mb-track"><div class="mb-bar fees" style="margin-left:${scale(b.grossProfit - b.fees)};width:${scale(b.fees)}"></div></div><span>−${money(b.fees)}</span></div>
          <div class="mb-row"><span>= Net profit (the LP)</span><div class="mb-track"><div class="mb-bar gross" style="width:${scale(b.netProfit)}"></div></div><span>${money(b.netProfit)}</span></div>
        </div>
        <div class="tiles pairs">
          ${stat('LP: net IRR, after fees', pct(m.irr), `the deals made ${pct(b.grossIrr)}: fees cost ${(((b.grossIrr ?? 0) - (m.irr ?? 0)) * 100).toFixed(1)} percentage points`, true)}
          ${stat('Deals: gross multiple', multiple(b.grossMoic), `on ${money(b.investment)} invested`)}
          ${stat('LP: net TVPI', multiple(m.tvpi), `on ${money(m.paidIn)} paid in`)}

        </div>`;
      onInput(root, 'fd-rate', (v) => set({ rate: v }));
    });
  },
};

// ------------------------------------------------------------------ 6. who pays what

interface WhoPaysP {
  sizeDiscount: boolean;
  sideCut: number;
}

export const WHO_PAYS_PARTNERS: Partner[] = [
  { id: 'Pension', role: 'LP', commitment: 50, feeClassId: 'standard' },
  { id: 'Insurer', role: 'LP', commitment: 30, feeClassId: 'side_letter' },
  { id: 'Family office', role: 'LP', commitment: 18, feeClassId: 'standard' },
  { id: 'GP commitment', role: 'GP', commitment: 2 },
];
const PARTNER_TYPE: Record<string, string> = {
  Pension: 'Standard fee',
  Insurer: 'Side letter',
  'Family office': 'Standard fee',
  'GP commitment': 'No fee (GP)',
};

const whoPays: Widget<WhoPaysP> = {
  init: () => ({ sizeDiscount: true, sideCut: 0.005 }),
  input: (p) => {
    const discount = p.sizeDiscount ? { mode: 'whole' as const, bands: [{ minCommitment: 40, rateReduction: 0.0025 }] } : undefined;
    const base = { feeRate: 0.02, ipYears: 5, ...(discount ? { sizeDiscount: discount } : {}) };
    return exampleFund({
      ...base,
      partners: WHO_PAYS_PARTNERS,
      feeClasses: { side_letter: standardFeeClass({ ...base, feeRate: Math.max(0, 0.02 - p.sideCut) }) },
    });
  },
  render(root, p, set) {
    keepFocus(root, () => {
      const input = whoPays.input(p);
      const result = runFund(input);
      const rows = result.partners.map((x) => {
        const fees = x.fees.reduce((s, f) => s + f.amount, 0);
        const navLp = x.liquidation?.steps.reduce((s, t) => s + t.lp, 0) ?? 0;
        return {
          id: x.partnerId,
          rate: x.fees[0]?.rate ?? 0,
          fees,
          tvpi: (x.ledger.distributedLp + navLp) / x.ledger.contributed,
          irr: xirr(partnersCashFlows(input, [x])),
        };
      });
      const best = Math.max(...rows.map((r) => r.irr ?? -1));
      root.innerHTML = `
        <label class="check"><input type="checkbox" id="wp-disc" ${p.sizeDiscount ? 'checked' : ''}> Size discount: commitments of $40m+ pay 0.25% less</label>
        ${slider('wp-cut', 'Side-letter discount for the insurer', p.sideCut, 0, 0.01, 0.0025, `−${pct(p.sideCut, 2)}`)}
        <div class="table-scroll"><table>
          <thead><tr><th>Partner</th><th>Commitment</th><th>Fee terms</th><th>Fee rate</th><th>Fees paid</th><th>Net TVPI</th><th>Net IRR</th></tr></thead>
          <tbody>${rows
            .map((r) => {
              const partner = WHO_PAYS_PARTNERS.find((x) => x.id === r.id)!;
              const top = r.irr === best;
              return `<tr${top ? ' class="best"' : ''}><td>${esc(r.id)}${top ? ' <span class="chip current">highest</span>' : ''}</td><td>${money(partner.commitment)}</td>
                <td>${PARTNER_TYPE[r.id]}</td><td>${pct(r.rate, 2)}</td><td>${money(r.fees, 2)}</td><td>${multiple(r.tvpi)}</td><td>${pct(r.irr)}</td></tr>`;
            })
            .join('')}</tbody>
        </table></div>
        <p class="hint">Fee rate shown is the investment-period rate after any discount. Everyone owns the same deals in proportion to their commitment.</p>`;
      root.querySelector('#wp-disc')!.addEventListener('change', (e) => set({ ...p, sizeDiscount: (e.target as HTMLInputElement).checked }));
      onInput(root, 'wp-cut', (v) => set({ ...p, sideCut: v }));
    });
  },
};

// ------------------------------------------------------------------ registry

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const WIDGETS: Record<WidgetId, Widget<any>> = { timeline, returns, feeRate, stepDown, feeDrag, whoPays, ...CARRY_WIDGETS, ...STRUCTURE_WIDGETS };
