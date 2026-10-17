import '../styles.css';
import { computeMetrics, runFund, validate, type EventTrace, type FundInput, type WaterfallResult } from '../engine';
import { PRESETS } from '../scenarios/presets';
import { piecesFor, renderChart, TIER_STYLE, type Piece } from './business/chart';
import { renderInputs } from './business/inputs';
import { renderBridge } from './business/bridge';
import { renderComparison } from './business/comparison';
import { renderFeeChart, renderFeeTable } from './business/fees';
import { renderAllocTable, renderLegend, renderLpTable, renderTiles } from './business/panels';
import { LAST_STEP, renderStepThrough } from './business/stepthrough';
import { money, shortDate } from './format';
import { fromPreset, toFundInput, type UiState } from './state';
import { createTechnicalView } from './technical/technical';

/**
 * App entry point. The flow is one direction only:
 *
 *   UI state ──toFundInput──▶ engine (pure) ──▶ result ──▶ render functions ──▶ DOM
 *
 * The UI never calculates anything financial itself. It only reshapes inputs and displays outputs.
 */

const el = (id: string) => document.getElementById(id)!;
let state: UiState = fromPreset(PRESETS[0]!);

// Tab 2 keeps its own run history. A new preset is a different fund, so the history starts over.
const technical = createTechnicalView(
  el('view-technical'),
  () => toFundInput(state),
  () => PRESETS.find((p) => p.id === state.presetId)?.name ?? 'your custom fund',
);

function mountInputs() {
  renderInputs(el('inputs'), state, update, (next) => {
    if (next) {
      state = next;
      technical.reset();
    }
    stopPlaying();
    mountInputs();
    update();
  });
}

function update() {
  const input = toFundInput(state);

  // Validate first. Bad input shows a message instead of a crash, and the last good outputs stay on screen.
  const issues = validate(input);
  const errors = el('errors');
  if (issues.length > 0) {
    errors.hidden = false;
    errors.innerHTML = `<strong>Can't run the waterfall:</strong><ul>${issues.map((i) => `<li><code>${i.field}</code>: ${i.message}</li>`).join('')}</ul>`;
    return;
  }
  errors.hidden = true;

  const result = runFund(input);
  const metrics = computeMetrics(input, result);

  // For the step-through, run the fund as one combined LP so its numbers match the fund-level chart.
  const fundView: FundInput = { ...input, partners: [{ id: 'All LPs', role: 'LP', commitment: 1 }] };
  const fundRun = runFund(fundView).partners[0]!;
  const traces: EventTrace[] = [...fundRun.trace, ...(fundRun.liquidation ? [fundRun.liquidation] : [])];
  const selectable = traces.filter((t) => t.kind !== 'capital_call').map((t) => t.eventId);
  if (!state.selectedDist || !selectable.includes(state.selectedDist)) state.selectedDist = selectable[0] ?? null;

  renderTiles(el('tiles'), metrics, state);
  renderChart(el('chart'), state.dists, result, state.selectedDist, {
    onSelect: selectDistribution,
    onHover: (e, id, piece) => showTooltip(e, id, piece, result),
    onLeave: hideTooltip,
  });
  renderAllocTable(el('alloc-table'), state.dists, result);
  renderStepThrough(el('trace'), {
    traces,
    selectedId: state.selectedDist ?? '',
    step: state.step,
    terms: state.terms,
    playing: playTimer !== null,
    onSelect: selectDistribution,
    onStep: (s) => {
      stopPlaying();
      state.step = Math.max(0, Math.min(LAST_STEP, s));
      update();
    },
    onTogglePlay: togglePlay,
  });
  renderLpTable(el('lp-table'), result.partners, state, input);
  renderBridge(el('bridge'), metrics);
  el('comparison-panel').hidden = result.comparison === null;
  renderComparison(el('comparison'), input, result);
  renderFeeChart(el('fee-chart'), result.fees, showTooltipHtml, hideTooltip);
  renderFeeTable(el('fee-table'), result.fees);
  el('fees-panel').hidden = result.fees.length === 0;
}

function selectDistribution(id: string) {
  stopPlaying();
  state.selectedDist = id;
  state.step = 0;
  update();
  el('trace').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// --- Play: advance one step every 1.6 seconds ---
let playTimer: number | null = null;
function togglePlay() {
  if (playTimer !== null) return stopPlaying(), update();
  if (state.step >= LAST_STEP) state.step = 0;
  playTimer = window.setInterval(() => {
    state.step += 1;
    if (state.step >= LAST_STEP) stopPlaying();
    update();
  }, 1600);
  update();
}
function stopPlaying() {
  if (playTimer !== null) window.clearInterval(playTimer);
  playTimer = null;
}

// --- Tooltip ---
const tooltip = el('tooltip');
function showTooltip(e: MouseEvent, id: string, hovered: Piece | null, result: WaterfallResult) {
  const d = state.dists.find((x) => x.id === id);
  if (!d) return;
  const rows = piecesFor(result.allocations, id)
    .filter((p) => p.amount > 1e-12)
    .map((p) => {
      const isHovered = hovered && hovered.tier === p.tier && hovered.who === p.who;
      const swatch = p.who === 'GP' ? `<i class="swatch hatched"></i>` : `<i class="swatch" style="background:${TIER_STYLE[p.tier].color}"></i>`;
      return `<div class="tt-row" style="${hovered && !isHovered ? 'opacity:.6' : 'font-weight:600'}">
        <span>${swatch} ${TIER_STYLE[p.tier].label} → ${p.who}</span><span>${money(p.amount, 2)}</span></div>`;
    })
    .join('');
  tooltip.innerHTML = `<div class="tt-title">${shortDate(d.date)} distribution · ${money(d.amount, 2)}</div>${rows || '<div class="tt-row">Nothing distributed</div>'}<div class="tt-hint">Click to step through it</div>`;
  placeTooltip(e);
}
function placeTooltip(e: MouseEvent) {
  tooltip.hidden = false;
  // Keep the tooltip on screen: flip to the left of the cursor near the right edge.
  const pad = 14;
  const { width, height } = tooltip.getBoundingClientRect();
  const left = e.clientX + pad + width > window.innerWidth ? e.clientX - pad - width : e.clientX + pad;
  const top = Math.min(e.clientY + pad, window.innerHeight - height - 8);
  tooltip.style.left = `${Math.max(8, left)}px`;
  tooltip.style.top = `${top}px`;
}
function showTooltipHtml(e: MouseEvent, html: string) {
  tooltip.innerHTML = html;
  placeTooltip(e);
}
function hideTooltip() {
  tooltip.hidden = true;
}

// Keyboard: ← / → step through when focus isn't in a form field.
document.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement).tagName;
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    stopPlaying();
    state.step = Math.max(0, Math.min(LAST_STEP, state.step + (e.key === 'ArrowRight' ? 1 : -1)));
    update();
  }
});

// --- Tabs ---
function showTab(which: 'business' | 'technical') {
  el('tab-business').setAttribute('aria-selected', String(which === 'business'));
  el('tab-technical').setAttribute('aria-selected', String(which === 'technical'));
  el('view-business').hidden = which !== 'business';
  el('view-technical').hidden = which !== 'technical';
  hideTooltip();
  if (which === 'technical') {
    stopPlaying();
    // Only show Tab 2 when Tab 1's inputs are valid: the pipeline would reject them anyway.
    if (validate(toFundInput(state)).length > 0) {
      el('view-technical').innerHTML = '<section class="panel"><p>Tab 1 has validation errors. Fix them there first, then come back.</p></section>';
    } else technical.show();
  } else update();
}
el('tab-business').addEventListener('click', () => showTab('business'));
el('tab-technical').addEventListener('click', () => showTab('technical'));

renderLegend(el('legend'));
mountInputs();
update();

// The chart is drawn at its container's pixel width, so redraw when that changes.
// requestAnimationFrame groups a burst of resize events into one redraw per frame.
let resizeQueued = false;
window.addEventListener('resize', () => {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => {
    resizeQueued = false;
    update();
  });
});
