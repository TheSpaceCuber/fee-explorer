import { PRESETS } from '../../scenarios/presets';
import { esc } from '../format';
import { fromPreset, newId, type Flow, type UiState } from '../state';

/**
 * The inputs panel.
 *
 * Two kinds of change:
 *  - Editing a value (slider, amount, date) mutates the state and calls `onChange`. Only the
 *    outputs re-render, so the field you're typing in keeps focus.
 *  - Adding or removing a row, or switching preset, changes the panel's structure. Then the whole
 *    panel re-renders through `onStructure`.
 */
export function renderInputs(
  root: HTMLElement,
  state: UiState,
  onChange: () => void,
  onStructure: (next?: UiState) => void,
): void {
  const preset = PRESETS.find((p) => p.id === state.presetId);
  const t = state.terms;

  root.innerHTML = `
    <div class="field">
      <label for="preset">Scenario</label>
      <select id="preset">
        ${PRESETS.map((p) => `<option value="${p.id}" ${p.id === state.presetId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
        ${preset ? '' : '<option value="custom" selected>Custom</option>'}
      </select>
      <p class="hint">${preset ? esc(preset.blurb) : 'You have edited the scenario.'}</p>
    </div>

    <h3>Terms</h3>
    <div class="field">
      <label for="hurdle">Hurdle rate (preferred return) <span class="value" id="hurdle-v"></span></label>
      <input type="range" id="hurdle" min="0" max="0.15" step="0.0025" value="${t.hurdleRate}">
      <p class="hint">The annual return LPs must earn before the GP gets any carry.</p>
    </div>
    <div class="field">
      <label for="carry">Carry rate <span class="value" id="carry-v"></span></label>
      <input type="range" id="carry" min="0" max="0.3" step="0.01" value="${t.carryRate}">
      <p class="hint">The GP's share of profit above the hurdle.</p>
    </div>
    ${segmented('Compounding', 'compounding', [['annual', 'Annual'], ['simple', 'Simple'], ['quarterly', 'Quarterly']], t.compounding, ['simple', 'quarterly'])}
    ${segmented('GP catch-up', 'catchup', [['0', '0%'], ['0.5', '50%'], ['1', '100%']], String(t.catchUpRate), ['0.5', '1'])}
    ${segmented('Structure', 'structure', [['european', 'European'], ['american', 'American']], t.structure, ['american'])}
    <p class="hint">Greyed-out options arrive in later milestones: compounding and catch-up in M2, American in M4.</p>

    <h3>LPs <span class="hint">(name, commitment)</span></h3>
    <div class="rows" id="lps">
      ${state.partners
        .map(
          (p, i) => `<div class="row lp">
            <input type="text" aria-label="LP name" data-lp-name="${i}" value="${esc(p.id)}">
            <input type="number" aria-label="Commitment" data-lp-commit="${i}" min="0" step="1" value="${p.commitment}">
            <button class="icon-btn" data-lp-remove="${i}" aria-label="Remove ${esc(p.id)}" ${state.partners.length === 1 ? 'disabled' : ''}>✕</button>
          </div>`,
        )
        .join('')}
    </div>
    <button class="add-btn" id="lp-add">+ Add LP</button>

    <h3>Capital calls <span class="hint">(date, $m)</span></h3>
    ${flowRows('calls', state.calls)}
    <button class="add-btn" data-flow-add="calls">+ Add capital call</button>

    <h3>Distributions <span class="hint">(date, $m)</span></h3>
    ${flowRows('dists', state.dists)}
    <button class="add-btn" data-flow-add="dists">+ Add distribution</button>

    <h3>Remaining value</h3>
    <div class="row">
      <input type="date" aria-label="NAV date" id="nav-date" value="${state.nav.date}">
      <input type="number" aria-label="NAV amount" id="nav-amount" min="0" step="1" value="${state.nav.amount}">
      <span></span>
    </div>
    <p class="hint">What the fund still holds (NAV). It counts in TVPI and IRR. In M1 it's gross, before any carry it would trigger.</p>
  `;

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  // Any edit turns the scenario into "Custom". We show it right away without re-rendering
  // (that would steal focus).
  const edited = () => {
    if (state.presetId !== 'custom') {
      state.presetId = 'custom';
      const select = $<HTMLSelectElement>('#preset');
      select.add(new Option('Custom', 'custom', true, true));
      const hint = root.querySelector('#preset + .hint');
      if (hint) hint.textContent = 'You have edited the scenario.';
    }
    onChange();
  };

  // --- Preset ---
  $<HTMLSelectElement>('#preset').addEventListener('change', (e) => {
    const p = PRESETS.find((x) => x.id === (e.target as HTMLSelectElement).value);
    if (p) onStructure(fromPreset(p));
  });

  // --- Sliders ---
  const showSliders = () => {
    $('#hurdle-v').textContent = `${(state.terms.hurdleRate * 100).toFixed(2)}%`;
    $('#carry-v').textContent = `${(state.terms.carryRate * 100).toFixed(0)}%`;
  };
  showSliders();
  $<HTMLInputElement>('#hurdle').addEventListener('input', (e) => {
    state.terms.hurdleRate = Number((e.target as HTMLInputElement).value);
    showSliders();
    edited();
  });
  $<HTMLInputElement>('#carry').addEventListener('input', (e) => {
    state.terms.carryRate = Number((e.target as HTMLInputElement).value);
    showSliders();
    edited();
  });

  // --- LPs ---
  root.querySelectorAll<HTMLInputElement>('[data-lp-name]').forEach((el) =>
    el.addEventListener('input', () => {
      state.partners[Number(el.dataset.lpName)]!.id = el.value;
      edited();
    }),
  );
  root.querySelectorAll<HTMLInputElement>('[data-lp-commit]').forEach((el) =>
    el.addEventListener('input', () => {
      state.partners[Number(el.dataset.lpCommit)]!.commitment = el.valueAsNumber;
      edited();
    }),
  );
  root.querySelectorAll<HTMLButtonElement>('[data-lp-remove]').forEach((el) =>
    el.addEventListener('click', () => {
      state.partners.splice(Number(el.dataset.lpRemove), 1);
      state.presetId = 'custom';
      onStructure();
    }),
  );
  $('#lp-add').addEventListener('click', () => {
    state.partners.push({ id: `LP ${state.partners.length + 1}`, role: 'LP', commitment: 10 });
    state.presetId = 'custom';
    onStructure();
  });

  // --- Calls and distributions ---
  for (const key of ['calls', 'dists'] as const) {
    root.querySelectorAll<HTMLInputElement>(`[data-flow="${key}"]`).forEach((el) =>
      el.addEventListener('input', () => {
        const row = state[key][Number(el.dataset.i)]!;
        if (el.type === 'date') row.date = el.value;
        else row.amount = el.valueAsNumber;
        edited();
      }),
    );
    root.querySelectorAll<HTMLButtonElement>(`[data-flow-remove="${key}"]`).forEach((el) =>
      el.addEventListener('click', () => {
        state[key].splice(Number(el.dataset.i), 1);
        state.presetId = 'custom';
        onStructure();
      }),
    );
    $(`[data-flow-add="${key}"]`).addEventListener('click', () => {
      const last = state[key].at(-1);
      state[key].push({ id: newId(key === 'calls' ? 'call' : 'dist'), date: nextYear(last?.date), amount: 10 });
      state.presetId = 'custom';
      onStructure();
    });
  }

  // --- NAV ---
  $<HTMLInputElement>('#nav-date').addEventListener('input', (e) => {
    state.nav.date = (e.target as HTMLInputElement).value;
    edited();
  });
  $<HTMLInputElement>('#nav-amount').addEventListener('input', (e) => {
    state.nav.amount = (e.target as HTMLInputElement).valueAsNumber || 0;
    edited();
  });
}

function segmented(label: string, name: string, options: [string, string][], current: string, disabled: string[]) {
  return `<div class="field" role="radiogroup" aria-label="${label}">
    <span class="label">${label}</span>
    <div class="segmented">
      ${options
        .map(
          ([v, text]) => `<label ${disabled.includes(v) ? 'title="Coming in a later milestone"' : ''}>
            <input type="radio" name="${name}" value="${v}" ${v === current ? 'checked' : ''} ${disabled.includes(v) ? 'disabled' : ''}>${text}
          </label>`,
        )
        .join('')}
    </div>
  </div>`;
}

function flowRows(key: 'calls' | 'dists', flows: Flow[]) {
  return `<div class="rows">${flows
    .map(
      (f, i) => `<div class="row">
        <input type="date" aria-label="Date" data-flow="${key}" data-i="${i}" value="${f.date}">
        <input type="number" aria-label="Amount" data-flow="${key}" data-i="${i}" min="0" step="1" value="${f.amount}">
        <button class="icon-btn" data-flow-remove="${key}" data-i="${i}" aria-label="Remove row">✕</button>
      </div>`,
    )
    .join('')}</div>`;
}

function nextYear(date?: string): string {
  if (!date) return '2025-01-01';
  const [y, m, d] = date.split('-');
  return `${Number(y) + 1}-${m}-${d === '29' && m === '02' ? '28' : d}`;
}
