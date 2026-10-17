import { computeMetrics, runFund, type Compounding, type EventTrace, type FundInput, type WaterfallResult } from '../engine';
import { piecesFor, renderChart, TIER_STYLE, type Piece } from '../ui/business/chart';
import { renderLegend } from '../ui/business/panels';
import { LAST_STEP, renderStepThrough } from '../ui/business/stepthrough';
import { money, multiple, pct, shortDate } from '../ui/format';
import type { Flow } from '../ui/state';
import { hideTooltip, showTooltipHtml } from '../ui/tooltip';
import { exampleFund } from './funds';
import { keepFocus, onInput, onRadio, segmented, slider, stat, type Widget } from './widget-kit';

/**
 * Widgets for Part 3 (carry). Management fees are off here, so every change you see comes from
 * the carry terms alone. Each lesson adds one mechanism to the same Example Fund I.
 */

const CARRY = 0.2;

// ------------------------------------------------------------------ shared: chart + step-through

interface View {
  /** Distribution shown in the step-through. */
  dist: string;
  step: number;
}

/** One play timer for whichever lesson is showing; it stops itself if the lesson goes away. */
let play: { timer: number; tick: () => void } | null = null;
const stopPlay = () => {
  if (play) window.clearInterval(play.timer);
  play = null;
};

const flowsOf = (input: FundInput): Flow[] =>
  input.events.filter((e) => e.kind === 'distribution').map((e) => ({ id: e.id, date: e.date, amount: e.kind === 'distribution' ? e.amount : 0 }));

function distTooltip(e: MouseEvent, flow: Flow, hovered: Piece | null, result: WaterfallResult) {
  const rows = piecesFor(result.allocations, flow.id)
    .filter((p) => p.amount > 1e-12)
    .map((p) => {
      const on = hovered && hovered.tier === p.tier && hovered.who === p.who;
      const swatch = p.who === 'GP' ? '<i class="swatch hatched"></i>' : `<i class="swatch" style="background:${TIER_STYLE[p.tier].color}"></i>`;
      return `<div class="tt-row" style="${hovered && !on ? 'opacity:.6' : 'font-weight:600'}"><span>${swatch} ${TIER_STYLE[p.tier].label} → ${p.who}</span><span>${money(p.amount, 2)}</span></div>`;
    })
    .join('');
  showTooltipHtml(e, `<div class="tt-title">${shortDate(flow.date)} distribution · ${money(flow.amount, 2)}</div>${rows}<div class="tt-hint">Click to step through it</div>`);
}

/**
 * The tier chart for Example Fund I, plus (optionally) the step-through for one distribution.
 * `onView` is called when the reader picks a distribution or moves a step.
 */
function carryView(mount: HTMLElement, input: FundInput, view: View, stepThrough: boolean, onView: (v: View) => void) {
  const result = runFund(input);
  const flows = flowsOf(input);
  mount.innerHTML = `
    <div class="legend" id="cv-legend"></div>
    <div class="chart" id="cv-chart"></div>
    ${stepThrough ? '<div id="cv-steps" class="cv-steps"></div>' : ''}`;
  renderLegend(mount.querySelector('#cv-legend')!);
  renderChart(mount.querySelector('#cv-chart')!, flows, result, stepThrough ? view.dist : null, {
    onSelect: (id) => {
      stopPlay();
      if (stepThrough) onView({ dist: id, step: 0 });
    },
    onHover: (e, id, piece) => distTooltip(e, flows.find((f) => f.id === id)!, piece, result),
    onLeave: hideTooltip,
  });
  if (!stepThrough) return;

  // Example Fund I has one LP, so its trace is the fund's.
  const lp = result.partners[0]!;
  const traces: EventTrace[] = [...lp.trace, ...(lp.liquidation ? [lp.liquidation] : [])];
  const stepsRoot = mount.querySelector<HTMLElement>('#cv-steps')!;
  if (play) play.tick = () => (view.step >= LAST_STEP || !stepsRoot.isConnected ? stopPlay() : onView({ ...view, step: view.step + 1 }));
  renderStepThrough(stepsRoot, {
    traces,
    selectedId: view.dist,
    step: view.step,
    terms: input.terms,
    playing: play !== null,
    onSelect: (id) => {
      stopPlay();
      onView({ dist: id, step: 0 });
    },
    onStep: (s) => {
      stopPlay();
      onView({ ...view, step: Math.max(0, Math.min(LAST_STEP, s)) });
    },
    onTogglePlay: () => {
      if (play) {
        stopPlay();
        onView({ ...view });
        return;
      }
      const start = view.step >= LAST_STEP ? 0 : view.step;
      play = { timer: window.setInterval(() => play?.tick(), 1600), tick: () => {} };
      onView({ ...view, step: start });
    },
  });
}

const carryPaid = (r: WaterfallResult) => r.allocations.reduce((s, a) => s + a.gp, 0);
const prefPaid = (r: WaterfallResult) => r.allocations.filter((a) => a.tier === 'PREF').reduce((s, a) => s + a.lp, 0);

// ------------------------------------------------------------------ 7. carry split

interface SplitP extends View {
  carry: number;
}

const carrySplit: Widget<SplitP> = {
  init: () => ({ carry: CARRY, dist: 'dist-3', step: 0 }),
  input: (p) => exampleFund({ carry: { carryRate: p.carry } }),
  render(root, p, set) {
    keepFocus(root, () => {
      const input = carrySplit.input(p);
      const result = runFund(input);
      const m = computeMetrics(input, result);
      const first = input.events.find((e) => e.kind === 'distribution' && result.allocations.some((a) => a.eventId === e.id && a.gp > 1e-9));
      root.innerHTML = `
        ${slider('cs-carry', 'Carry rate (GP share of profit)', p.carry, 0, 0.3, 0.05, pct(p.carry, 0))}
        <div class="tiles">
          ${stat('LP received', money(m.distributedLp))}
          ${stat('GP carry paid', money(m.carryGp))}
          ${stat('First carry dollar', first ? shortDate(first.date) : 'never', 'once the LP has its $85m back')}
        </div>
        <div id="cs-view"></div>`;
      carryView(root.querySelector('#cs-view')!, input, p, false, () => {});
      onInput(root, 'cs-carry', (v) => set({ ...p, carry: v }));
    });
  },
};

// ------------------------------------------------------------------ 8. hurdle

interface HurdleP extends View {
  hurdle: number;
}

const hurdle: Widget<HurdleP> = {
  init: () => ({ hurdle: 0.08, dist: 'dist-3', step: 0 }),
  input: (p) => exampleFund({ carry: { carryRate: CARRY, hurdleRate: p.hurdle, catchUpRate: 0 } }),
  render(root, p, set) {
    keepFocus(root, () => {
      const input = hurdle.input(p);
      const result = runFund(input);
      const m = computeMetrics(input, result);
      const none = runFund(hurdle.input({ ...p, hurdle: 0 }));
      root.innerHTML = `
        ${slider('hd-rate', 'Hurdle rate (preferred return, per year)', p.hurdle, 0, 0.12, 0.01, pct(p.hurdle, 0))}
        <div class="tiles">
          ${stat('Pref paid to the LP', money(prefPaid(result), 1))}
          ${stat('GP carry paid', money(carryPaid(result), 1), p.hurdle > 0 ? `was ${money(carryPaid(none), 1)} with no hurdle` : 'no hurdle')}
          ${stat('GP share of profit', pct(m.gpShareOfProfit), p.hurdle > 0 ? 'below 20%: no catch-up yet' : 'no hurdle: the full 20%')}
        </div>
        <div id="hd-view"></div>`;
      carryView(root.querySelector('#hd-view')!, input, p, true, (v) => set({ ...p, ...v }));
      onInput(root, 'hd-rate', (v) => set({ ...p, hurdle: v }));
    });
  },
};

// ------------------------------------------------------------------ 9. catch-up

interface CatchUpP extends View {
  catchUp: number;
}

const catchUpInput = (catchUp: number) => exampleFund({ carry: { carryRate: CARRY, hurdleRate: 0.08, catchUpRate: catchUp } });

/** The first distribution where the GP gets a catch-up payment (the one worth stepping through). */
function firstCatchUp(): string {
  const input = catchUpInput(1);
  const r = runFund(input);
  return r.allocations.find((a) => a.tier === 'CATCHUP' && a.gp > 1e-9)?.eventId ?? 'dist-3';
}

const catchUp: Widget<CatchUpP> = {
  init: () => ({ catchUp: 1, dist: firstCatchUp(), step: 0 }),
  input: (p) => catchUpInput(p.catchUp),
  render(root, p, set) {
    keepFocus(root, () => {
      const input = catchUp.input(p);
      const result = runFund(input);
      const m = computeMetrics(input, result);
      const cu = result.allocations.filter((a) => a.tier === 'CATCHUP').reduce((s, a) => s + a.gp, 0);
      root.innerHTML = `
        ${segmented('cu-rate', 'Catch-up (GP share of each dollar after the pref)', [['0', 'None'], ['0.5', '50%'], ['0.8', '80%'], ['1', '100%']], String(p.catchUp))}
        <div class="tiles">
          ${stat('Catch-up paid to the GP', money(cu, 1))}
          ${stat('GP carry, paid + on unsold value', money(m.carryGp + m.accruedCarry, 1))}
          ${stat('GP share of profit', pct(m.gpShareOfProfit), p.catchUp > 0 ? 'caught up to the 20% carry rate' : 'no catch-up: below 20%')}
        </div>
        <div id="cu-view"></div>`;
      carryView(root.querySelector('#cu-view')!, input, p, true, (v) => set({ ...p, ...v }));
      onRadio(root, 'cu-rate', (v) => set({ ...p, catchUp: Number(v) }));
    });
  },
};

// ------------------------------------------------------------------ 10. accrued carry

interface AccruedP {
  nav: number;
}

const accrued: Widget<AccruedP> = {
  init: () => ({ nav: 40 }),
  input: (p) => exampleFund({ carry: { carryRate: CARRY, hurdleRate: 0.08, catchUpRate: 1 }, navAmount: p.nav }),
  render(root, p, set) {
    keepFocus(root, () => {
      const input = accrued.input(p);
      const m = computeMetrics(input, runFund(input));
      const lpShare = m.nav > 0 ? (m.netNav / m.nav) * 100 : 100;
      root.innerHTML = `
        ${slider('ac-nav', 'Value of the companies still held at the end of 2027 (NAV)', p.nav, 0, 60, 5, money(p.nav, 0))}
        <div class="nav-split" role="img" aria-label="NAV of ${money(m.nav)}: ${money(m.netNav)} for the LP, ${money(m.accruedCarry)} accrued carry for the GP">
          <div class="mb-row"><span>If sold today, the NAV would go</span>
            <div class="mb-track"><div class="mb-bar gross" style="width:${lpShare}%"></div><div class="mb-bar carry" style="width:${100 - lpShare}%"></div></div>
            <span></span></div>
        </div>
        <div class="tiles pairs">
          ${stat('NAV (gross)', money(m.nav, 1))}
          ${stat('Accrued carry (GP, on paper)', money(m.accruedCarry, 1))}
          ${stat('LP’s net NAV (on its statement)', money(m.netNav, 1))}
          ${stat('Net TVPI', multiple(m.tvpi), `gross of accrued carry it would be ${multiple((m.distributedLp + m.nav) / m.paidIn)}`)}
        </div>`;
      onInput(root, 'ac-nav', (v) => set({ nav: v }));
    });
  },
};

// ------------------------------------------------------------------ 11. compounding

interface CompoundP {
  conv: Compounding;
  hurdle: number;
}

const CONVENTIONS: [Compounding, string][] = [
  ['simple', 'Simple'],
  ['annual', 'Annual'],
  ['quarterly', 'Quarterly'],
  ['daily', 'Daily'],
];

const compoundInput = (conv: Compounding, h: number) =>
  exampleFund({ carry: { carryRate: CARRY, hurdleRate: h, catchUpRate: 0, compounding: conv } });

const compounding: Widget<CompoundP> = {
  init: () => ({ conv: 'annual', hurdle: 0.08 }),
  input: (p) => compoundInput(p.conv, p.hurdle),
  render(root, p, set) {
    keepFocus(root, () => {
      const rows = CONVENTIONS.map(([c, label]) => {
        const r = runFund(compoundInput(c, p.hurdle));
        return { c, label, pref: prefPaid(r), carry: carryPaid(r) };
      });
      root.innerHTML = `
        ${slider('cp-rate', 'Hurdle rate', p.hurdle, 0.04, 0.12, 0.01, pct(p.hurdle, 0))}
        ${segmented('cp-conv', 'Highlight', CONVENTIONS, p.conv)}
        <div class="table-scroll"><table>
          <thead><tr><th>How the pref grows</th><th>Pref paid to the LP</th><th>GP carry paid</th></tr></thead>
          <tbody>${rows
            .map((r) => `<tr${r.c === p.conv ? ' class="best"' : ''}><td>${r.label}</td><td>${money(r.pref, 2)}</td><td>${money(r.carry, 2)}</td></tr>`)
            .join('')}</tbody>
        </table></div>
        <p class="hint">Catch-up is off here, so every extra dollar of pref is a dollar less in the split.</p>`;
      onInput(root, 'cp-rate', (v) => set({ ...p, hurdle: v }));
      onRadio(root, 'cp-conv', (v) => set({ ...p, conv: v as Compounding }));
    });
  },
};

export const CARRY_WIDGETS = { carrySplit, hurdle, catchUp, accrued, compounding };
