import { LIQUIDATION_ID, type CarryTerms, type EventTrace, type Tier, type TraceStep } from '../../engine';
import { carryPaid, profitPaid } from '../../engine/carry/tiers';
import { money, pct, shortDate } from '../format';
import { TIER_STYLE } from './chart';

/**
 * Step-through mode: walk one distribution down the waterfall, one tier at a time.
 *
 * Each tier is drawn as a "bucket" whose width is what that tier is owed. Stepping forward pours
 * the cash into the next bucket. When a bucket is full, the rest spills over to the next one.
 * That's where the name "waterfall" comes from.
 *
 * Steps: 0 = the hurdle account just before the distribution, 1–4 = the four tiers, 5 = summary.
 * All numbers come from the engine's trace. This file only displays them.
 */

export const LAST_STEP = 5;

export interface StepThroughProps {
  /** Fund-level traces (one combined LP), real distributions plus an optional NAV liquidation. */
  traces: EventTrace[];
  selectedId: string;
  step: number;
  terms: CarryTerms;
  playing: boolean;
  onSelect: (id: string) => void;
  onStep: (step: number) => void;
  onTogglePlay: () => void;
}

export function renderStepThrough(root: HTMLElement, props: StepThroughProps): void {
  const dists = props.traces.filter((t) => t.kind !== 'capital_call');
  const trace = dists.find((t) => t.eventId === props.selectedId) ?? dists[0];
  if (!trace) {
    root.innerHTML = '<h2>Step through a distribution</h2><p class="hint">No distributions yet.</p>';
    return;
  }

  const step = Math.min(props.step, LAST_STEP);
  // One shared scale for every bucket, so their widths can be compared.
  const scale = Math.max(trace.amount, ...trace.steps.map((s) => s.owed ?? 0), 1e-9);
  const w = (x: number) => `${Math.max(0, (x / scale) * 100)}%`;
  const cashLeft = step === 0 ? trace.amount : step >= LAST_STEP ? 0 : trace.steps[step - 1]!.remaining;

  const label = (t: EventTrace) =>
    t.eventId === LIQUIDATION_ID ? `NAV, if sold on ${shortDate(t.date)} · ${money(t.amount)}` : `${shortDate(t.date)} · ${money(t.amount)}`;

  root.innerHTML = `
    <div class="panel-head">
      <h2>Step through a distribution</h2>
      <select id="st-pick" aria-label="Distribution">
        ${dists.map((t) => `<option value="${t.eventId}" ${t.eventId === trace.eventId ? 'selected' : ''}>${label(t)}</option>`).join('')}
      </select>
    </div>

    <div class="st-controls" role="group" aria-label="Step controls">
      <button id="st-reset" ${step === 0 ? 'disabled' : ''}>⏮ Start</button>
      <button id="st-back" ${step === 0 ? 'disabled' : ''}>◀ Back</button>
      <button id="st-next" class="primary" ${step >= LAST_STEP ? 'disabled' : ''}>Next ▶</button>
      <button id="st-play">${props.playing ? '⏸ Pause' : '▶ Play'}</button>
      <span class="st-progress" aria-live="polite">Step ${step} of ${LAST_STEP}</span>
    </div>

    <div class="st-cash">
      <div class="st-cash-label"><span>Cash still to allocate</span><strong>${money(cashLeft, 2)}</strong></div>
      <div class="st-track"><div class="st-cash-fill" style="width:${w(cashLeft)}"></div></div>
    </div>

    <ol class="st-buckets">
      ${trace.steps.map((s, i) => bucket(s, i + 1, step, w, props.terms)).join('')}
    </ol>

    <div class="st-explain" aria-live="polite">${explanation(trace, step, props.terms)}</div>
  `;

  const $ = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;
  $('st-pick').addEventListener('change', (e) => props.onSelect((e.target as HTMLSelectElement).value));
  $('st-reset').addEventListener('click', () => props.onStep(0));
  $('st-back').addEventListener('click', () => props.onStep(step - 1));
  $('st-next').addEventListener('click', () => props.onStep(step + 1));
  $('st-play').addEventListener('click', props.onTogglePlay);
}

const TIER_NUMBER: Record<Tier, number> = { ROC: 1, PREF: 2, CATCHUP: 3, SPLIT: 4 };

/** One tier as a bucket: the outline is what it's owed, the fill is what it got. */
function bucket(s: TraceStep, n: number, step: number, w: (x: number) => string, terms: CarryTerms): string {
  const state = step === n ? 'current' : step > n ? 'done' : 'upcoming';
  const style = TIER_STYLE[s.tier];
  const shown = step >= n; // fill only once the cash has reached this tier
  const lp = shown ? s.lp : 0;
  const gp = shown ? s.gp : 0;

  let owedText: string;
  if (s.tier === 'SPLIT') owedText = `takes everything left · LP ${pct(1 - terms.carryRate, 0)} / GP ${pct(terms.carryRate, 0)}`;
  else if (s.tier === 'CATCHUP' && terms.catchUpRate === 0) owedText = 'not in these terms';
  else owedText = `owed ${money(s.owed ?? 0, 2)}`;

  const capacity = s.tier === 'SPLIT' ? s.available : (s.owed ?? 0);
  const paidText = shown ? `LP ${money(s.lp, 2)}${s.gp > 0 || s.tier === 'CATCHUP' || s.tier === 'SPLIT' ? ` · GP ${money(s.gp, 2)}` : ''}` : '—';

  return `<li class="st-bucket ${state}" style="--c:${style.color}">
    <div class="st-head">
      <span class="st-name">${n}. ${style.label}</span>
      <span class="st-owed">${owedText}</span>
      <span class="st-paid">${paidText}</span>
    </div>
    <div class="st-track" title="Outline = what this tier is owed. Fill = what it received.">
      ${capacity > 1e-12 ? `<div class="st-capacity" style="width:${w(capacity)}"></div>` : ''}
      <div class="st-fill lp" style="width:${w(lp)}"></div>
      <div class="st-fill gp" style="width:${w(gp)};left:${w(lp)}"></div>
    </div>
  </li>`;
}

function explanation(trace: EventTrace, step: number, terms: CarryTerms): string {
  const isNav = trace.eventId === LIQUIDATION_ID;
  if (step === 0) {
    const a = trace.accrual;
    const conv = { simple: 'simple interest (on capital only)', annual: 'annual compounding', quarterly: 'quarterly compounding', daily: 'daily compounding' }[a.compounding];
    const years = a.years.toFixed(2);
    const intro = isNav
      ? `<strong>This is not a real payment.</strong> It asks: if the fund sold everything for its NAV of ${money(trace.amount, 2)} today, who would get what? The GP's part is its <em>accrued carry</em>.<br><br>`
      : '';
    return `${intro}<strong>Before the cash arrives:</strong> the hurdle account. The LP still has ${money(a.capital, 2)} of capital outstanding.
      Over the ${years} years since the previous event, at a ${pct(terms.hurdleRate, 2)} hurdle with ${conv}, the unpaid preferred return grew from
      ${money(a.prefBefore, 2)} to <strong>${money(a.prefAfter, 2)}</strong>. Together that's ${money(a.capital + a.prefAfter, 2)} the LP must receive before the GP earns anything.
      Press <em>Next</em> to pour the ${money(trace.amount, 2)} in.`;
  }
  if (step >= LAST_STEP) {
    const lp = trace.steps.reduce((s, x) => s + x.lp, 0);
    const gp = trace.steps.reduce((s, x) => s + x.gp, 0);
    const cum = trace.ledgerAfter.cumulative;
    const profit = profitPaid(cum);
    const share = profit > 0 ? carryPaid(cum) / profit : 0;
    return `<strong>Summary:</strong> of ${money(trace.amount, 2)}, the LP ${isNav ? 'would get' : 'got'} ${money(lp, 2)} and the GP ${money(gp, 2)}.
      Counting everything paid out so far, the GP has ${pct(share)} of the profit${terms.carryRate > 0 ? ` (its carry rate is ${pct(terms.carryRate, 0)})` : ''}.`;
  }
  const s = trace.steps[step - 1]!;
  return `<strong>${step}. ${TIER_STYLE[s.tier].label}:</strong> ${s.explanation}`;
}
