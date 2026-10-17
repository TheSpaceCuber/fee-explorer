import '../styles.css';
import { computeMetrics, runFund, validate, type EventTrace, type FundInput, type WaterfallResult } from '../engine';
import { renderHome } from '../learn/home';
import { renderLearn } from '../learn/shell';
import { lessonBySlug } from '../learn/lessons';
import { PRESETS } from '../scenarios/presets';
import { renderBridge } from './business/bridge';
import { piecesFor, renderChart, TIER_STYLE, type Piece } from './business/chart';
import { renderComparison } from './business/comparison';
import { renderFeeChart, renderFeeTable } from './business/fees';
import { renderInputs } from './business/inputs';
import { renderNetToGross } from './business/netgross';
import { renderAllocTable, renderLegend, renderLpTable, renderTiles } from './business/panels';
import { LAST_STEP, renderStepThrough } from './business/stepthrough';
import { money, shortDate } from './format';
import { parseRoute, type Route } from './router';
import { fromPreset, toFundInput, type UiState } from './state';
import { createTechnicalView } from './technical/technical';
import { hideTooltip, showTooltipHtml } from './tooltip';

/**
 * App entry point. Four views, picked by the URL hash (see router.ts):
 *   #/                home: what this is, three ways in
 *   #/learn/<lesson>  the course
 *   #/explore         the full playground
 *   #/under-the-hood  the calculation pipeline
 *
 * In every view the flow is one direction only:
 *   UI state ──▶ engine (pure) ──▶ result ──▶ render functions ──▶ DOM
 * The UI never calculates anything financial itself.
 */

const el = (id: string) => document.getElementById(id)!;
let state: UiState = fromPreset(PRESETS[0]!);
/** The calibrated preset the current inputs came from (stays set after edits, so the panel can compare). */
let calibratedFrom: string | null = null;
let route: Route = parseRoute(location.hash);

// "Under the hood" keeps its own run history. A different fund starts the history over.
const technical = createTechnicalView(
  el('view-technical'),
  () => toFundInput(state),
  () => PRESETS.find((p) => p.id === state.presetId)?.name ?? 'your custom fund',
);

// ------------------------------------------------------------------ Explore

function mountInputs() {
  renderInputs(el('inputs'), state, update, (next) => {
    if (next) {
      state = next;
      calibratedFrom = PRESETS.find((p) => p.id === next.presetId)?.calibration ? next.presetId : null;
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
    errors.innerHTML = `<strong>Can't run the fund:</strong><ul>${issues.map((i) => `<li><code>${i.field}</code>: ${i.message}</li>`).join('')}</ul>`;
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
    onHover: (e, id, piece) => showDistributionTooltip(e, id, piece, result),
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
  renderNetToGross(el('netgross'), PRESETS.find((p) => p.id === calibratedFrom), metrics, state.presetId !== calibratedFrom);
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

// Play: advance one step every 1.6 seconds.
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

function showDistributionTooltip(e: MouseEvent, id: string, hovered: Piece | null, result: WaterfallResult) {
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
  showTooltipHtml(
    e,
    `<div class="tt-title">${shortDate(d.date)} distribution · ${money(d.amount, 2)}</div>${rows || '<div class="tt-row">Nothing distributed</div>'}<div class="tt-hint">Click to step through it</div>`,
  );
}

// Keyboard: ← / → step through, only in Explore and not while typing in a field.
document.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
  if (el('view-business').hidden) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    stopPlaying();
    state.step = Math.max(0, Math.min(LAST_STEP, state.step + (e.key === 'ArrowRight' ? 1 : -1)));
    update();
  }
});

// ------------------------------------------------------------------ Routing

const VIEW_IDS: Record<Route['view'], string> = { home: 'view-home', learn: 'view-learn', explore: 'view-business', hood: 'view-technical' };
const TITLES: Record<Route['view'], string> = { home: 'Fee Explorer', learn: 'Learn', explore: 'Explore', hood: 'Under the hood' };

function show(next: Route, { focus = true } = {}) {
  const leavingExplore = route.view === 'explore' && next.view !== 'explore';
  route = next;
  if (leavingExplore) stopPlaying();
  hideTooltip();

  for (const [view, id] of Object.entries(VIEW_IDS)) el(id).hidden = view !== next.view;
  document.querySelectorAll<HTMLAnchorElement>('[data-nav]').forEach((a) => {
    if (a.dataset.nav === next.view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  switch (next.view) {
    case 'home':
      renderHome(el('view-home'));
      break;
    case 'learn':
      renderLearn(el('view-learn'), next.lesson, { openInExplore });
      break;
    case 'explore':
      update();
      break;
    case 'hood':
      // The pipeline would reject invalid inputs anyway, so say so up front.
      if (validate(toFundInput(state)).length > 0) {
        el('view-technical').innerHTML = '<section class="panel"><p>The fund in Explore has validation errors. Fix them there first, then come back.</p></section>';
      } else technical.show();
      break;
  }

  const lesson = next.view === 'learn' && next.lesson ? lessonBySlug(next.lesson) : null;
  document.title = next.view === 'home' ? 'Fee Explorer' : `${lesson ? lesson.title : TITLES[next.view]} · Fee Explorer`;

  if (focus) {
    // Like a page load: start at the top, and move keyboard/screen-reader focus to the new content.
    window.scrollTo(0, 0);
    const target = el(VIEW_IDS[next.view]).querySelector<HTMLElement>('#lesson-title') ?? el(VIEW_IDS[next.view]);
    target.focus({ preventScroll: true });
  }
}

/** "Open this fund in Explore" from a lesson. */
function openInExplore(input: FundInput, name: string) {
  state = fromPreset({ id: 'from-lesson', name, blurb: `Loaded from ${name}. Everything is editable here, and the lesson keeps its own copy.`, input });
  calibratedFrom = null;
  technical.reset();
  stopPlaying();
  mountInputs();
  location.hash = '#/explore';
}

window.addEventListener('hashchange', () => show(parseRoute(location.hash)));

el('skip-link').addEventListener('click', () => {
  const main = el(VIEW_IDS[route.view]);
  main.focus();
  main.scrollIntoView();
});

renderLegend(el('legend'));
mountInputs();
show(route, { focus: false });

// Charts are drawn at their container's pixel width, so redraw the visible view when that changes.
// requestAnimationFrame groups a burst of resize events into one redraw per frame.
let resizeQueued = false;
window.addEventListener('resize', () => {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => {
    resizeQueued = false;
    if (route.view === 'explore') update();
    if (route.view === 'learn') show(route, { focus: false });
  });
});
