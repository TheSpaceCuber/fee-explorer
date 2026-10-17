import type { FundInput } from '../../engine';
import {
  currentRun,
  DDL,
  emptyDatabase,
  executeRun,
  fingerprint,
  type Database,
  type PipelineRun,
  type Row,
  type StageId,
  type StageResult,
  type TableName,
} from '../../pipeline';
import { esc, money } from '../format';
import { jsonHtml } from './json';
import { renderDecisions, renderStorage } from './storage';

/**
 * Tab 2: how the waterfall is configured, calculated and stored.
 *
 * Everything shown comes from `executeRun` in src/pipeline: the JSON, the rows and the run history.
 * This module only keeps the in-memory "database" between clicks and draws it.
 */

const STAGES: { id: StageId; title: string; short: string; about: string }[] = [
  {
    id: 'terms',
    title: '1. Terms configuration',
    short: 'Terms',
    about:
      'Fund terms come from the LPA and side letters: hurdle, catch-up, carry, structure, fee schedule, who the partners are. ' +
      'Someone enters them on a configuration screen. Every saved configuration is a version, identified by a hash of its content.',
  },
  {
    id: 'validation',
    title: '2. Validation and approval',
    short: 'Approval',
    about:
      'Rules check the terms before any calculation may use them (catch-up above carry, fee periods that don’t overlap, known fee classes…). ' +
      'Then a second person approves (a "four-eyes" check). The decision is stored as its own row, approved or rejected.',
  },
  {
    id: 'ingestion',
    title: '3. Cash-flow ingestion',
    short: 'Cash flows',
    about:
      'Capital calls and distributions arrive from the fund administrator or the general ledger. They are loaded as one batch, ' +
      'fingerprinted, so loading the same file twice is detected rather than double-counted.',
  },
  {
    id: 'run',
    title: '4. Calculation run',
    short: 'Run',
    about:
      'A run pins down exactly what is being calculated: this terms version, this cash-flow batch, this engine version. ' +
      'Their combined hash identifies the run’s inputs. Same inputs, same answer, so there is no need to run twice.',
  },
  {
    id: 'fees',
    title: '5. Fee calculation',
    short: 'Fees',
    about:
      'Quarterly management fees per partner, from the fee schedule and (after the investment period) the invested capital in the cash flows. ' +
      'They are stored against the run, because different terms or cash flows give different fees.',
  },
  {
    id: 'allocation',
    title: '6. Allocation output',
    short: 'Allocations',
    about:
      'The waterfall result: one row per distribution × partner × tier, LP and GP amounts, rounded to cents so every distribution adds up exactly. ' +
      'American funds also get one clawback row per partner.',
  },
  {
    id: 'reporting',
    title: '7. Reporting',
    short: 'Reports',
    about:
      'Investor reports (capital account statements, performance) are produced from one specific run and keep a pointer to it. ' +
      'A later re-run can then never silently change a number an investor has already seen.',
  },
];

const STATUS: Record<StageResult['status'], { icon: string; label: string }> = {
  done: { icon: '✓', label: 'Done' },
  reused: { icon: '↺', label: 'Reused' },
  failed: { icon: '✕', label: 'Failed' },
  skipped: { icon: '–', label: 'Skipped' },
};

export interface TechnicalView {
  /** Start over for a new fund (preset change). */
  reset: () => void;
  /** Draw (and run the first calculation if there is none yet). */
  show: () => void;
}

export function createTechnicalView(root: HTMLElement, getInput: () => FundInput, fundName: () => string): TechnicalView {
  let db: Database = emptyDatabase();
  let history: PipelineRun[] = [];
  let selected = 0; // index into history
  let stage: StageId = 'terms';
  let lastInputFingerprint = '';
  const expanded = new Set<string>(); // tables showing all rows

  const execute = (input: FundInput, reason: string) => {
    const out = executeRun(db, history, { input, reason });
    db = out.db;
    history = [...history, out.run];
    selected = history.length - 1;
    lastInputFingerprint = fingerprint(getInput());
  };

  /** The what-if buttons: each runs the pipeline on a modified copy of Tab 1's inputs. */
  const scenarios: { key: string; label: string; make: () => { input: FundInput; reason: string } }[] = [
    { key: 'tab1', label: 'Re-run with Tab 1’s inputs', make: () => ({ input: getInput(), reason: 'Re-run with current inputs' }) },
    {
      key: 'amend',
      label: 'Terms amendment: hurdle +0.5%',
      make: () => {
        const i = structuredClone(getInput());
        i.terms.hurdleRate = Math.round((i.terms.hurdleRate + 0.005) * 1e6) / 1e6;
        return { input: i, reason: `Terms amendment: hurdle ${(i.terms.hurdleRate * 100).toFixed(2)}%` };
      },
    },
    {
      key: 'correct',
      label: 'Corrected cash flow: last distribution +$1m',
      make: () => {
        const i = structuredClone(getInput());
        const last = [...i.events].reverse().find((e) => e.kind === 'distribution');
        if (last && last.kind === 'distribution') last.amount += 1;
        return { input: i, reason: 'Administrator corrected the last distribution (+$1m)' };
      },
    },
    { key: 'same', label: 'Run again, nothing changed', make: () => ({ input: structuredClone(lastInputOf()), reason: 'Run again with no changes' }) },
    {
      key: 'bad',
      label: 'Submit bad terms (catch-up 10%)',
      make: () => {
        const i = structuredClone(getInput());
        i.terms.catchUpRate = 0.1;
        return { input: i, reason: 'Terms entered with a 10% catch-up (below the carry rate)' };
      },
    },
  ];
  // Inputs actually used by the latest execution, so "nothing changed" really is unchanged.
  const lastInputs: FundInput[] = [];
  const lastInputOf = () => lastInputs.at(-1) ?? getInput();
  const run = (input: FundInput, reason: string) => {
    lastInputs.push(structuredClone(input));
    execute(input, reason);
  };

  function show() {
    if (history.length === 0) run(getInput(), 'Initial calculation');
    render();
  }

  function reset() {
    db = emptyDatabase();
    history = [];
    lastInputs.length = 0;
    selected = 0;
    stage = 'terms';
    expanded.clear();
  }

  function render() {
    const r = history[selected]!;
    const current = currentRun(db);
    const stale = fingerprint(getInput()) !== lastInputFingerprint;

    root.innerHTML = `
      <section class="panel tech-intro">
        <h2>From terms to stored numbers</h2>
        <p>Below is an illustrative pipeline a fund finance system might use for <strong>${esc(fundName())}</strong>. It is fed by the same engine as Tab 1.
          Every JSON payload and every table row is generated from it, nothing is typed in. Table names are generic, not any real system's.
          Click a stage to see what goes in, what comes out, and what gets stored.</p>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2>Pipeline runs</h2>
          ${stale ? '<span class="stale">Tab 1 inputs changed since the last run</span>' : ''}
        </div>
        <div class="scenario-buttons">
          ${scenarios.map((s) => `<button data-scenario="${s.key}" ${s.key === 'tab1' && stale ? 'class="primary"' : ''}>${s.label}</button>`).join('')}
        </div>
        <div class="table-scroll"><table class="runs">
          <thead><tr><th>#</th><th>Why</th><th>Result</th><th>Terms version</th><th>Cash-flow batch</th><th>Supersedes</th></tr></thead>
          <tbody>${history
            .map((h, i) => {
              const runRow = h.runId ? db.calc_run.find((x) => x.run_id === h.runId) : null;
              const tv = (h.stages.find((s) => s.id === 'terms')?.output as { terms_version_id?: string } | null)?.terms_version_id ?? '—';
              const batch = (h.stages.find((s) => s.id === 'ingestion')?.output as { batch_id?: string } | null)?.batch_id ?? '—';
              const result = h.runId
                ? `<strong>${h.runId}</strong>${current?.run_id === h.runId ? ' <span class="chip current">current</span>' : ' <span class="chip">superseded</span>'}`
                : h.stages.some((s) => s.status === 'failed')
                  ? '<span class="chip failed">✕ rejected, no run</span>'
                  : '<span class="chip">↺ identical inputs, no new run</span>';
              return `<tr data-row="${i}" class="${i === selected ? 'selected' : ''}">
                <td>${h.seq}</td><td>${esc(h.reason)}</td><td>${result}</td><td><code>${tv}</code></td><td><code>${batch}</code></td>
                <td>${runRow?.supersedes_run_id ? `<code>${runRow.supersedes_run_id}</code>` : '—'}</td></tr>`;
            })
            .join('')}</tbody>
        </table></div>
        <p class="hint">Click a row to inspect that execution. Old runs are never changed or deleted. "Current" isn't a stored flag: it is
          worked out from <code>supersedes_run_id</code> (the <code>v_current_run</code> view).</p>
      </section>

      <section class="panel">
        <h2>Pipeline for execution #${r.seq}${r.runId ? ` (${r.runId})` : ''}</h2>
        <ol class="pipeline" aria-label="Pipeline stages">
          ${STAGES.map((s) => {
            const st = r.stages.find((x) => x.id === s.id)!;
            const tables = (st.writes.length ? st.writes.map((w) => w.table) : defaultTables(s.id)).join(', ');
            return `<li><button class="stage ${s.id === stage ? 'active' : ''} st-${st.status}" data-stage="${s.id}" aria-pressed="${s.id === stage}">
              <span class="stage-title">${s.title}</span>
              <span class="stage-status"><span aria-hidden="true">${STATUS[st.status].icon}</span> ${STATUS[st.status].label}</span>
              <span class="stage-tables">${tables}</span>
            </button></li>`;
          }).join('')}
        </ol>
      </section>

      <section class="panel" id="tech-stage">${renderStage(r)}</section>
      <section class="panel" id="tech-decisions"></section>
      <section class="panel" id="tech-storage"></section>
    `;

    renderDecisions(root.querySelector('#tech-decisions')!);
    renderStorage(root.querySelector('#tech-storage')!, getInput(), db);

    root.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach((b) =>
      b.addEventListener('click', () => {
        const s = scenarios.find((x) => x.key === b.dataset.scenario)!.make();
        run(s.input, s.reason);
        render();
      }),
    );
    root.querySelectorAll<HTMLTableRowElement>('tr[data-row]').forEach((tr) =>
      tr.addEventListener('click', () => {
        selected = Number(tr.dataset.row);
        render();
      }),
    );
    root.querySelectorAll<HTMLButtonElement>('[data-stage]').forEach((b) =>
      b.addEventListener('click', () => {
        stage = b.dataset.stage as StageId;
        render();
        root.querySelector('#tech-stage')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }),
    );
    root.querySelectorAll<HTMLButtonElement>('[data-expand]').forEach((b) =>
      b.addEventListener('click', () => {
        const key = b.dataset.expand!;
        if (expanded.has(key)) expanded.delete(key);
        else expanded.add(key);
        render();
      }),
    );
  }

  function renderStage(r: PipelineRun): string {
    const meta = STAGES.find((s) => s.id === stage)!;
    const st = r.stages.find((s) => s.id === stage)!;
    const status = STATUS[st.status];
    const writes = st.writes.filter((w) => w.rows.length > 0);

    return `
      <div class="panel-head">
        <h2>${meta.title}</h2>
        <span class="chip st-${st.status}"><span aria-hidden="true">${status.icon}</span> ${status.label}</span>
      </div>
      <p>${meta.about}</p>
      <p class="stage-note"><strong>This time:</strong> ${esc(st.note)}</p>
      ${
        st.status === 'skipped'
          ? ''
          : `<div class="io-grid">
        <div><h3>Input</h3><pre class="json">${jsonHtml(st.input)}</pre></div>
        <div><h3>Output</h3><pre class="json">${jsonHtml(st.output)}</pre></div>
      </div>`
      }
      ${stage === 'allocation' && r.runId ? runDiff(r.runId) : ''}
      <h3>Writes</h3>
      ${
        writes.length === 0
          ? `<p class="hint">Nothing written by this execution${st.status === 'reused' ? ': the content already exists, so storing it again would only duplicate it' : ''}.</p>`
          : writes.map((w) => tableBlock(w.table, w.rows, r.seq)).join('')
      }
      ${writes.length === 0 ? ddlBlocks(defaultTables(stage)) : ''}
      <p class="hint">Reads: ${st.reads.map((t) => `<code>${t}</code>`).join(', ') || '—'}</p>
    `;
  }

  function tableBlock(table: TableName, rows: Row[], seq: number): string {
    const key = `${seq}:${table}`;
    const showAll = expanded.has(key);
    const shown = showAll ? rows : rows.slice(0, 8);
    const cols = Object.keys(rows[0] ?? {});
    return `<div class="table-block">
      <div class="table-head"><code class="table-name">${table}</code>
        <span class="hint">${rows.length} row${rows.length === 1 ? '' : 's'} written now · ${db[table].length} in the table across all runs</span></div>
      <div class="table-scroll"><table class="rows">
        <thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead>
        <tbody>${shown.map((row) => `<tr>${cols.map((c) => `<td>${cell(row[c] ?? null, c)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>
      ${rows.length > 8 ? `<button class="link-btn" data-expand="${key}">${showAll ? 'Show fewer' : `Show all ${rows.length} rows`}</button>` : ''}
      ${ddlBlocks([table])}
    </div>`;
  }

  /** Per-tier totals of a run vs the run it superseded. */
  function runDiff(id: string): string {
    const row = db.calc_run.find((x) => x.run_id === id);
    const prev = row?.supersedes_run_id as string | null;
    if (!prev) return '';
    const totals = (rid: string) => {
      const t: Record<string, { lp: number; gp: number }> = {};
      for (const a of db.waterfall_allocation.filter((x) => x.run_id === rid)) {
        const k = a.tier as string;
        t[k] ??= { lp: 0, gp: 0 };
        t[k].lp += a.lp_amount as number;
        t[k].gp += a.gp_amount as number;
      }
      return t;
    };
    const before = totals(prev);
    const after = totals(id);
    const tiers = ['ROC', 'PREF', 'CATCHUP', 'SPLIT'];
    const delta = (x: number) => (Math.abs(x) < 0.005 ? '—' : `${x > 0 ? '+' : '−'}${money(Math.abs(x), 2)}`);
    return `<h3>Compared with ${prev} (which this run supersedes)</h3>
      <div class="table-scroll"><table>
        <thead><tr><th>Tier</th><th>LP before</th><th>LP now</th><th>Change</th><th>GP before</th><th>GP now</th><th>Change</th></tr></thead>
        <tbody>${tiers
          .map((t) => {
            const b = before[t] ?? { lp: 0, gp: 0 };
            const a = after[t] ?? { lp: 0, gp: 0 };
            return `<tr><td>${t}</td><td>${money(b.lp, 2)}</td><td>${money(a.lp, 2)}</td><td>${delta(a.lp - b.lp)}</td>
              <td>${money(b.gp, 2)}</td><td>${money(a.gp, 2)}</td><td>${delta(a.gp - b.gp)}</td></tr>`;
          })
          .join('')}</tbody>
      </table></div>
      <p class="hint">Both runs' rows are still in <code>waterfall_allocation</code>, so this comparison is a query, not a reconstruction.</p>`;
  }

  return { reset, show };
}

function ddlBlocks(tables: TableName[]): string {
  return tables.map((t) => `<details class="ddl"><summary>DDL: <code>${t}</code></summary><pre>${esc(DDL[t])}</pre></details>`).join('');
}

function defaultTables(id: StageId): TableName[] {
  return (
    {
      terms: ['fund_terms', 'fee_schedule', 'partner'],
      validation: ['terms_approval'],
      ingestion: ['deal', 'cash_flow_event'],
      run: ['calc_run'],
      fees: ['fee_accrual'],
      allocation: ['waterfall_allocation', 'clawback'],
      reporting: ['report_snapshot'],
    } as Record<StageId, TableName[]>
  )[id];
}

/** Money columns are NUMERIC(18,2) in the DDL, so show them with two decimals like a database would. */
const MONEY_COLUMN = /amount|commitment|carry|cost_realized|discount_min/;

function cell(v: Row[string], column: string): string {
  if (v === null) return '<span class="null">NULL</span>';
  if (typeof v === 'number') return `<span class="num">${MONEY_COLUMN.test(column) ? v.toFixed(2) : v}</span>`;
  const s = String(v);
  return s.length > 60 ? `<span title="${esc(s)}">${esc(s.slice(0, 57))}…</span>` : esc(s);
}
