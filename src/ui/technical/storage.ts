import type { FundInput } from '../../engine';
import type { Database } from '../../pipeline';

/** The three design decisions the brief asks about, in plain words. */
export function renderDecisions(root: HTMLElement): void {
  root.innerHTML = `
    <h2>Design decisions</h2>
    <div class="cards">
      <article class="card">
        <h3>Calculations are immutable and versioned by run</h3>
        <p>Every derived number (fee, allocation, clawback, report) carries a <code>run_id</code>. The run records the exact terms version,
          cash-flow batch and engine version used. So any figure can be traced back and reproduced, and an auditor asking
          "why did the LP get 3.33 in Q2 2026?" gets an answer, not an apology.</p>
        <p>Nothing is ever <code>UPDATE</code>d. Approval is a new row, not a status change. Superseding is a pointer on the new run,
          not a flag flipped on the old one. The one thing that "changes", which run is current, is a view.</p>
      </article>
      <article class="card">
        <h3>Allocations are stored per tier</h3>
        <p>One row per distribution × partner × tier keeps the <em>why</em>, not just the total. ROC vs pref vs catch-up vs split matters
          for LP statements (return of capital vs income), tax reporting, and for checking a run against the LPA by hand.</p>
        <p>Zero rows are kept too. A missing row is ambiguous ("zero", or "not computed"?), a fixed shape makes pivots and
          reconciliation queries simple, and runs of zeros cost almost nothing after compression.</p>
      </article>
      <article class="card">
        <h3>A re-run creates a new run</h3>
        <p>When terms are amended or a cash flow is corrected, the pipeline writes a new <code>calc_run</code> that
          <code>supersedes</code> the old one. The old run's rows stay exactly as they were, so a report already sent to investors can
          always be reproduced, and the two runs can be compared with a query (open stage 6 on a re-run).</p>
        <p>Identical inputs give the same <code>input_hash</code>, and the pipeline refuses to recompute them: re-running is
          <em>idempotent</em>. Try "Run again, nothing changed" above.</p>
      </article>
    </div>`;
}

interface Sizing {
  partners: number;
  distributions: number;
  years: number;
  runsPerYear: number;
  changedShare: number;
}

/** Storage trade-offs, plus a small calculator seeded from the current fund. */
export function renderStorage(root: HTMLElement, input: FundInput, db: Database): void {
  const s: Sizing = {
    partners: Math.max(1, input.partners.length),
    distributions: Math.max(1, input.events.filter((e) => e.kind === 'distribution').length),
    years: 12,
    runsPerYear: 4,
    changedShare: 0.1,
  };

  root.innerHTML = `
    <h2>Storage trade-offs</h2>
    <div class="table-scroll"><table class="tradeoffs">
      <thead><tr><th></th><th>Full snapshot per run (this demo)</th><th>History table (valid from / to)</th><th>Deltas only (event-sourced)</th></tr></thead>
      <tbody>
        <tr><td>What a re-run writes</td><td>Every row, again</td><td>Only rows that changed: close the old row, insert a new one</td><td>Only the differences</td></tr>
        <tr><td>Storage growth</td><td>Highest: rows × runs</td><td>Low: proportional to changes</td><td>Lowest</td></tr>
        <tr><td>"Current numbers" query</td><td>Easy: filter on the current run</td><td>Easy: <code>WHERE valid_to IS NULL</code></td><td>Hard: replay or keep a projection</td></tr>
        <tr><td>"As published on date X"</td><td>Easy: the run the report points at</td><td>Possible: range query on valid_from / valid_to</td><td>Replay up to X</td></tr>
        <tr><td>Audit and reproduction</td><td>Simplest: each run is self-contained</td><td>Good, but a run spans many row versions</td><td>Good, but needs the replay logic</td></tr>
        <tr><td>Main risk</td><td>Volume</td><td>Update logic that closes/opens rows correctly</td><td>Complexity; replay bugs</td></tr>
      </tbody>
    </table></div>
    <p>Full snapshots are the usual choice for <strong>calculation results</strong>: they are written once, read often, and must be reproducible
      exactly. History tables suit <strong>reference data</strong> that changes slowly (partner details, fee schedules). Here, versioning by
      content hash plays that role: unchanged terms are stored once and shared by every run that uses them.</p>
    <p><strong>Retention and compression.</strong> Snapshot volume is the price of simplicity, and two things tame it. <em>Retention</em>: keep
      every run that was published or approved, and drop superseded draft runs after a while (they were never relied on).
      <em>Compression</em>: in a columnar store (e.g. Parquet, or a warehouse's columnstore) the repeated values (<code>run_id</code>,
      <code>tier</code>, <code>partner_id</code>, runs of zeros) compress very well, often 5–10×. Partitioning by <code>run_id</code> (or by month)
      also means "current run" queries only scan one partition, so query cost tracks the size of one run, not the whole history.</p>

    <h3>How big does it get?</h3>
    <div class="sizing">
      ${numberField('partners', 'Partners', s.partners, 1, 2000)}
      ${numberField('distributions', 'Distributions over the fund’s life', s.distributions, 1, 500)}
      ${numberField('years', 'Fund life (years)', s.years, 1, 30)}
      ${numberField('runsPerYear', 'Kept runs per year', s.runsPerYear, 1, 365)}
      ${numberField('changedShare', 'Rows changed per re-run (%)', s.changedShare * 100, 1, 100)}
    </div>
    <div id="sizing-out"></div>
    <p class="hint">Assumptions: about 80 bytes per row before compression, 6× compression in a columnar store, fees for every partner every
      quarter. Starting values are from the fund in Tab 1. This demo's own tables currently hold
      ${Object.values(db).reduce((sum, rows) => sum + rows.length, 0).toLocaleString('en-US')} rows.</p>`;

  const out = root.querySelector<HTMLElement>('#sizing-out')!;
  const update = () => {
    const allocRows = s.partners * s.distributions * 4;
    const feeRows = s.partners * s.years * 4;
    const perRun = allocRows + feeRows + s.partners * 2; // + clawback / report rows
    const runs = s.years * s.runsPerYear;
    const snapshotRows = perRun * runs;
    const historyRows = perRun + perRun * s.changedShare * (runs - 1);
    const bytes = (rows: number) => rows * 80;
    out.innerHTML = `<div class="table-scroll"><table>
      <thead><tr><th></th><th>Rows</th><th>Raw size</th><th>Compressed (≈6×)</th></tr></thead>
      <tbody>
        <tr><td>One run</td><td>${fmtInt(perRun)}</td><td>${fmtBytes(bytes(perRun))}</td><td>${fmtBytes(bytes(perRun) / 6)}</td></tr>
        <tr><td>Full snapshots, ${fmtInt(runs)} runs</td><td>${fmtInt(snapshotRows)}</td><td>${fmtBytes(bytes(snapshotRows))}</td><td>${fmtBytes(bytes(snapshotRows) / 6)}</td></tr>
        <tr><td>History table instead</td><td>${fmtInt(historyRows)}</td><td>${fmtBytes(bytes(historyRows))}</td><td>${fmtBytes(bytes(historyRows) / 6)}</td></tr>
      </tbody></table></div>
      <p class="hint">Even a large fund's full snapshot history is usually modest next to its storage cost and the value of being able to
        reproduce any published number. Volume becomes a real concern across hundreds of funds with daily runs, which is when
        retention rules and partitioning matter.</p>`;
  };
  root.querySelectorAll<HTMLInputElement>('[data-size]').forEach((el) =>
    el.addEventListener('input', () => {
      const key = el.dataset.size as keyof Sizing;
      const v = Math.max(Number(el.min), Math.min(Number(el.max), el.valueAsNumber || Number(el.min)));
      s[key] = key === 'changedShare' ? v / 100 : v;
      update();
    }),
  );
  update();
}

function numberField(key: string, label: string, value: number, min: number, max: number): string {
  return `<label class="field"><span class="label">${label}</span><input type="number" data-size="${key}" min="${min}" max="${max}" step="1" value="${Math.round(value)}"></label>`;
}
const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
function fmtBytes(b: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (b >= 1024 && i < units.length - 1) {
    b /= 1024;
    i++;
  }
  return `${b.toFixed(b < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}
