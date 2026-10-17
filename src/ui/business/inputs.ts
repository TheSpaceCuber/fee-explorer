import { PRESETS } from '../../scenarios/presets';
import { esc } from '../format';
import { fromPreset, newId, PARTNER_TYPES, type Flow, type PartnerType, type UiState } from '../state';

/**
 * The inputs panel.
 *
 * Two kinds of change:
 *  - Editing a value (slider, amount, date) mutates the state and calls `onChange`. Only the
 *    outputs re-render, so the field you're typing in keeps focus.
 *  - Adding or removing a row, switching preset, or turning fees on/off changes the panel's
 *    structure. Then the whole panel re-renders through `onStructure`.
 */
export function renderInputs(
  root: HTMLElement,
  state: UiState,
  onChange: () => void,
  onStructure: (next?: UiState) => void,
): void {
  const preset = PRESETS.find((p) => p.id === state.presetId);
  const t = state.terms;
  const f = state.fees;
  const pctFmt = (x: number, d = 2) => `${(x * 100).toFixed(d)}%`;

  root.innerHTML = `
    <div class="field">
      <label for="preset">Scenario</label>
      <select id="preset">
        ${PRESETS.map((p) => `<option value="${p.id}" ${p.id === state.presetId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
        ${preset ? '' : '<option value="custom" selected>Custom</option>'}
      </select>
      <p class="hint">${preset ? esc(preset.blurb) : 'You have edited the scenario.'}</p>
    </div>

    <h3>Carry terms</h3>
    ${slider('hurdle', 'Hurdle rate (preferred return)', t.hurdleRate, 0, 0.15, 0.0025, 'The annual return LPs must earn before the GP gets any carry.')}
    ${slider('carry', 'Carry rate', t.carryRate, 0, 0.3, 0.01, "The GP's share of profit above the hurdle.")}
    ${segmented('Pref compounding', 'compounding', [['simple', 'Simple'], ['annual', 'Annual'], ['quarterly', 'Quarterly'], ['daily', 'Daily']], t.compounding, [])}
    <p class="hint">Simple: only capital earns the hurdle. Compound: unpaid pref earns it too, so more pref is owed.</p>
    ${segmented('GP catch-up', 'catchup', [['0', 'None'], ['0.5', '50%'], ['0.8', '80%'], ['1', '100%']], String(t.catchUpRate), [])}
    <p class="hint">The GP's share of each dollar after the pref, until it has its carry rate of all profit. ILPA's model LPA uses 80%.</p>
    ${segmented('Structure', 'structure', [['european', 'European'], ['american', 'American']], t.structure, [])}
    ${t.structure === 'american' ? segmented('Losses on sold deals', 'loss', [['realized', 'Recovered first'], ['none', 'Ignored']], t.lossRecovery ?? 'realized', []) : ''}
    <p class="hint">${
      t.structure === 'american'
        ? 'Deal by deal: carry is earned as each deal is sold. "Recovered first": losses on deals already sold are paid back from later deals before more carry. A clawback at the end returns any carry above the whole-fund calculation.'
        : 'Whole fund: carry only after ALL contributed capital plus the hurdle is back.'
    }</p>

    <h3>Management fees</h3>
    <label class="check"><input type="checkbox" id="fees-on" ${f.enabled ? 'checked' : ''}> Charge management fees</label>
    <div class="fee-fields" ${f.enabled ? '' : 'hidden'}>
      <div class="pair">
        <div class="field"><label for="fee-start">Fees start</label><input type="date" id="fee-start" value="${f.start}"></div>
        <div class="field"><label for="fee-ip-end">Investment period ends</label><input type="date" id="fee-ip-end" value="${f.ipEnd}"></div>
      </div>
      ${slider('fee-ip-rate', 'Rate during investment period (on commitment)', f.ipRate, 0, 0.025, 0.00125)}
      ${slider('fee-post-rate', 'Rate afterwards', f.postRate, 0, 0.025, 0.00125)}
      ${segmented('Basis afterwards', 'fee-basis', [['invested_capital', 'Invested capital'], ['commitment', 'Commitment']], f.postBasis, [])}
      <div class="field"><label for="fee-end">Fees end</label><input type="date" id="fee-end" value="${f.end}"></div>
      <p class="hint">Billed quarterly in advance and paid by calling capital, so fees are returned in ROC and earn pref.
        "Invested capital" = investment called − cost of what's been sold, so the fee falls as deals exit.</p>
      ${segmented('Size discount', 'fee-discount', [['none', 'None'], ['whole', 'Whole'], ['marginal', 'Marginal']], f.discountMode, [])}
      <div class="pair" ${f.discountMode === 'none' ? 'hidden' : ''}>
        <div class="field"><label for="fee-disc-min">Commitment ≥ ($m)</label><input type="number" id="fee-disc-min" min="0" step="1" value="${f.discountMin}"></div>
        <div class="field"><label for="fee-disc-cut">Rate cut (%)</label><input type="number" id="fee-disc-cut" min="0" step="0.05" value="${+(f.discountCut * 100).toFixed(3)}"></div>
      </div>
      <p class="hint">Whole: the whole commitment gets the lower rate. Marginal: only the part above the threshold does, like tax brackets.</p>
      ${slider('fee-side-cut', 'Side-letter rate cut', f.sideLetterCut, 0, 0.01, 0.00125, 'Applies to LPs set to "Side letter" below.')}
    </div>

    <h3>Partners <span class="hint">(name, commitment $m, type)</span></h3>
    <div class="rows">
      ${state.partners
        .map(
          (p, i) => `<div class="row lp">
            <input type="text" aria-label="Partner name" data-lp-name="${i}" value="${esc(p.id)}">
            <input type="number" aria-label="Commitment" data-lp-commit="${i}" min="0" step="1" value="${p.commitment}">
            <select aria-label="Partner type" data-lp-type="${i}">
              ${PARTNER_TYPES.map(([v, , short]) => `<option value="${v}" ${v === p.type ? 'selected' : ''}>${short}</option>`).join('')}
            </select>
            <button class="icon-btn" data-lp-remove="${i}" aria-label="Remove ${esc(p.id)}" ${state.partners.length === 1 ? 'disabled' : ''}>✕</button>
          </div>`,
        )
        .join('')}
    </div>
    <button class="add-btn" id="lp-add">+ Add partner</button>
    <p class="hint">"GP commitment" is the manager investing its own money alongside the LPs. It pays no fees and no carry, and is left out of LP metrics.</p>

    <h3>Investment calls <span class="hint">(date, ${t.structure === 'american' ? 'deal, ' : ''}$m)</span></h3>
    ${flowRows('calls', state.calls, t.structure === 'american')}
    <button class="add-btn" data-flow-add="calls">+ Add capital call</button>
    ${f.enabled ? '<p class="hint">Fee calls are added automatically from the fee schedule.</p>' : ''}

    <h3>Distributions <span class="hint">(date, ${t.structure === 'american' ? 'deal, ' : ''}$m, cost sold $m)</span></h3>
    ${flowRows('dists', state.dists, t.structure === 'american')}
    <button class="add-btn" data-flow-add="dists">+ Add distribution</button>
    <p class="hint">"Cost sold" is what the fund originally paid for the investments it sold. It sets the fee basis after the investment period and, for American waterfalls, how much capital becomes due. A write-off is a distribution of 0 with its full cost sold.</p>

    <h3>Remaining value</h3>
    <div class="row">
      <input type="date" aria-label="NAV date" id="nav-date" value="${state.nav.date}">
      <input type="number" aria-label="NAV amount" id="nav-amount" min="0" step="1" value="${state.nav.amount}">
      <span></span>
    </div>
    <p class="hint">What the fund still holds (NAV). TVPI and IRR use it net of the carry the GP would earn if it were sold (accrued carry). Fees stop on this date. Set it to 0 for a fully realized fund.</p>
  `;

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  // Any edit turns the scenario into "Custom". We show it right away without re-rendering
  // (that would steal focus).
  const edited = () => {
    if (state.presetId !== 'custom') {
      state.presetId = 'custom';
      $<HTMLSelectElement>('#preset').add(new Option('Custom', 'custom', true, true));
      const hint = root.querySelector('#preset + .hint');
      if (hint) hint.textContent = 'You have edited the scenario.';
    }
    onChange();
  };
  const structural = () => {
    state.presetId = 'custom';
    onStructure();
  };

  // --- Preset ---
  $<HTMLSelectElement>('#preset').addEventListener('change', (e) => {
    const p = PRESETS.find((x) => x.id === (e.target as HTMLSelectElement).value);
    if (p) onStructure(fromPreset(p));
  });

  // --- Sliders: each shows its value and writes one field ---
  const bindSlider = (id: string, set: (v: number) => void, get: () => number) => {
    const input = $<HTMLInputElement>(`#${id}`);
    const show = () => ($(`#${id}-v`).textContent = pctFmt(get()));
    show();
    input.addEventListener('input', () => {
      set(Number(input.value));
      show();
      edited();
    });
  };
  bindSlider('hurdle', (v) => (state.terms.hurdleRate = v), () => state.terms.hurdleRate);
  bindSlider('carry', (v) => (state.terms.carryRate = v), () => state.terms.carryRate);
  bindSlider('fee-ip-rate', (v) => (f.ipRate = v), () => f.ipRate);
  bindSlider('fee-post-rate', (v) => (f.postRate = v), () => f.postRate);
  bindSlider('fee-side-cut', (v) => (f.sideLetterCut = v), () => f.sideLetterCut);

  // --- Radio groups ---
  const bindRadio = (name: string, set: (v: string) => void, structure = false) =>
    root.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach((el) =>
      el.addEventListener('change', () => {
        set(el.value);
        if (structure) structural();
        else edited();
      }),
    );
  bindRadio('compounding', (v) => (state.terms.compounding = v as typeof state.terms.compounding));
  bindRadio('catchup', (v) => (state.terms.catchUpRate = Number(v)));
  bindRadio('structure', (v) => (state.terms.structure = v as typeof state.terms.structure), true);
  bindRadio('loss', (v) => (state.terms.lossRecovery = v as 'none' | 'realized'));
  bindRadio('fee-basis', (v) => (f.postBasis = v as typeof f.postBasis));
  bindRadio('fee-discount', (v) => (f.discountMode = v as typeof f.discountMode), true);

  // --- Plain fields ---
  const bindField = (id: string, set: (el: HTMLInputElement) => void) => {
    const el = $<HTMLInputElement>(`#${id}`);
    el.addEventListener('input', () => {
      set(el);
      edited();
    });
  };
  bindField('fee-start', (el) => (f.start = el.value));
  bindField('fee-ip-end', (el) => (f.ipEnd = el.value));
  bindField('fee-end', (el) => (f.end = el.value));
  bindField('fee-disc-min', (el) => (f.discountMin = el.valueAsNumber || 0));
  bindField('fee-disc-cut', (el) => (f.discountCut = (el.valueAsNumber || 0) / 100));
  bindField('nav-date', (el) => (state.nav.date = el.value));
  bindField('nav-amount', (el) => (state.nav.amount = el.valueAsNumber || 0));
  $<HTMLInputElement>('#fees-on').addEventListener('change', (e) => {
    f.enabled = (e.target as HTMLInputElement).checked;
    structural();
  });

  // --- Partners ---
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
  root.querySelectorAll<HTMLSelectElement>('[data-lp-type]').forEach((el) =>
    el.addEventListener('change', () => {
      state.partners[Number(el.dataset.lpType)]!.type = el.value as PartnerType;
      edited();
    }),
  );
  root.querySelectorAll<HTMLButtonElement>('[data-lp-remove]').forEach((el) =>
    el.addEventListener('click', () => {
      state.partners.splice(Number(el.dataset.lpRemove), 1);
      structural();
    }),
  );
  $('#lp-add').addEventListener('click', () => {
    state.partners.push({ id: `LP ${state.partners.length + 1}`, commitment: 10, type: 'standard' });
    structural();
  });

  // --- Calls and distributions ---
  for (const key of ['calls', 'dists'] as const) {
    root.querySelectorAll<HTMLInputElement>(`[data-flow="${key}"]`).forEach((el) =>
      el.addEventListener('input', () => {
        const row = state[key][Number(el.dataset.i)]!;
        if (el.type === 'date') row.date = el.value;
        else if (el.dataset.field === 'deal') row.deal = el.value;
        else if (el.dataset.field === 'cost') row.cost = el.valueAsNumber || 0;
        else row.amount = el.valueAsNumber;
        edited();
      }),
    );
    root.querySelectorAll<HTMLButtonElement>(`[data-flow-remove="${key}"]`).forEach((el) =>
      el.addEventListener('click', () => {
        state[key].splice(Number(el.dataset.i), 1);
        structural();
      }),
    );
    $(`[data-flow-add="${key}"]`).addEventListener('click', () => {
      const last = state[key].at(-1);
      const row: Flow = { id: newId(key === 'calls' ? 'call' : 'dist'), date: nextYear(last?.date), amount: 10, deal: last?.deal || 'A' };
      if (key === 'dists') row.cost = 0;
      state[key].push(row);
      structural();
    });
  }
}

function slider(id: string, label: string, value: number, min: number, max: number, step: number, hint?: string) {
  return `<div class="field">
    <label for="${id}">${label} <span class="value" id="${id}-v"></span></label>
    <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}">
    ${hint ? `<p class="hint">${hint}</p>` : ''}
  </div>`;
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

function flowRows(key: 'calls' | 'dists', flows: Flow[], showDeal: boolean) {
  return `<div class="rows">${flows
    .map(
      (f, i) => `<div class="row ${key === 'dists' ? 'dist' : 'call'} ${showDeal ? 'with-deal' : ''}">
        <input type="date" aria-label="Date" data-flow="${key}" data-i="${i}" value="${f.date}">
        ${showDeal ? `<input type="text" aria-label="Deal" data-flow="${key}" data-field="deal" data-i="${i}" value="${esc(f.deal ?? '')}">` : ''}
        <input type="number" aria-label="Amount" data-flow="${key}" data-i="${i}" min="0" step="1" value="${f.amount}">
        ${key === 'dists' ? `<input type="number" aria-label="Cost sold" data-flow="${key}" data-field="cost" data-i="${i}" min="0" step="1" value="${f.cost ?? 0}">` : ''}
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
