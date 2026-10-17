import '../styles.css';
import { computeMetrics, runFund, validate, type FundInput } from '../engine';
import { PRESETS } from '../scenarios/presets';
import { renderChart, SEGMENTS, segmentsFor, type SegmentKey } from './business/chart';
import { renderInputs } from './business/inputs';
import { renderAllocTable, renderLegend, renderLpTable, renderTiles, renderTrace } from './business/panels';
import { money, shortDate } from './format';
import { fromPreset, toFundInput, type UiState } from './state';

/**
 * App entry point. The flow is one direction only:
 *
 *   UI state ──toFundInput──▶ engine (pure) ──▶ result ──▶ render functions ──▶ DOM
 *
 * The UI never calculates anything financial itself. It only reshapes inputs and displays outputs.
 */

const el = (id: string) => document.getElementById(id)!;
let state: UiState = fromPreset(PRESETS[0]!);

function mountInputs() {
  renderInputs(el('inputs'), state, update, (next) => {
    if (next) state = next;
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
  // For the walkthrough, run the fund as one combined LP so its numbers match the fund-level chart.
  const fundView: FundInput = { ...input, partners: [{ id: 'All LPs', role: 'LP', commitment: 1 }] };
  const fundTrace = runFund(fundView).partners[0]!.trace;

  if (!state.dists.some((d) => d.id === state.selectedDist)) state.selectedDist = state.dists[0]?.id ?? null;

  const select = (id: string) => {
    state.selectedDist = id;
    update();
  };

  renderTiles(el('tiles'), metrics);
  renderChart(el('chart'), state.dists, result, state.selectedDist, {
    onSelect: select,
    onHover: (e, id, key) => showTooltip(e, id, key, result),
    onLeave: hideTooltip,
  });
  renderAllocTable(el('alloc-table'), state.dists, result);
  renderTrace(el('trace'), state.dists, fundTrace, state.selectedDist, state.terms.carryRate, select);
  renderLpTable(el('lp-table'), result.partners, state);
}

// --- Tooltip ---
const tooltip = el('tooltip');
function showTooltip(e: MouseEvent, id: string, key: SegmentKey | null, result: ReturnType<typeof runFund>) {
  const d = state.dists.find((x) => x.id === id);
  if (!d) return;
  const segs = segmentsFor(result, id);
  const rows = SEGMENTS.filter((s) => segs[s.key] > 1e-12)
    .map(
      (s) => `<div class="tt-row" style="${key && key !== s.key ? 'opacity:.6' : 'font-weight:600'}">
        <span><i class="swatch" style="background:${s.color}"></i> ${s.label}</span><span>${money(segs[s.key], 2)}</span></div>`,
    )
    .join('');
  tooltip.innerHTML = `<div class="tt-title">${shortDate(d.date)} distribution · ${money(d.amount, 2)}</div>${rows || '<div class="tt-row">Nothing distributed</div>'}`;
  tooltip.hidden = false;
  // Keep the tooltip on screen: flip to the left of the cursor near the right edge.
  const pad = 14;
  const { width, height } = tooltip.getBoundingClientRect();
  const left = e.clientX + pad + width > window.innerWidth ? e.clientX - pad - width : e.clientX + pad;
  const top = Math.min(e.clientY + pad, window.innerHeight - height - 8);
  tooltip.style.left = `${Math.max(8, left)}px`;
  tooltip.style.top = `${top}px`;
}
function hideTooltip() {
  tooltip.hidden = true;
}

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
