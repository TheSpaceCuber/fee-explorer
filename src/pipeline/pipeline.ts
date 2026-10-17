import { computeMetrics, runFund, validate, type FundInput, type ValidationIssue, type WaterfallResult } from '../engine';
import { TIERS } from '../engine/types';
import type { TableName } from './ddl';
import { fingerprint, runId } from './ids';
import { allocateCents, fromCents, toCents } from './rounding';

/**
 * The calculation pipeline behind Tab 2, as a pure function:
 *
 *   executeRun(database, history, request) → { database', run }
 *
 * The "database" is a set of in-memory tables that are only ever appended to. Each call runs the
 * seven stages below and records, for each one, its input, its output and the rows it wrote, so
 * the UI can show exactly what a real system would store. Every row is generated from the engine.
 *
 *   1 terms        configure the fund's terms        → fund_terms, fee_schedule, partner
 *   2 validation   check and approve them            → terms_approval
 *   3 ingestion    load the cash flows               → deal, cash_flow_event
 *   4 run          register a calculation run        → calc_run
 *   5 fees         management fees for that run      → fee_accrual
 *   6 allocation   waterfall rows, rounded to cents  → waterfall_allocation, clawback
 *   7 reporting    publish metrics from that run     → report_snapshot
 *
 * In a real system stages 4–6 commit in ONE transaction, so a calc_run row is never visible
 * without its fees and allocations.
 */

export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;
export type Database = Record<TableName, Row[]>;

export type StageId = 'terms' | 'validation' | 'ingestion' | 'run' | 'fees' | 'allocation' | 'reporting';
export type StageStatus = 'done' | 'reused' | 'failed' | 'skipped';

export interface StageResult {
  id: StageId;
  status: StageStatus;
  /** One line on what happened this time. */
  note: string;
  input: unknown;
  output: unknown;
  writes: { table: TableName; rows: Row[] }[];
  reads: TableName[];
}

export interface PipelineRun {
  /** Logical clock: the nth time the pipeline was executed. Stands in for a timestamp. */
  seq: number;
  reason: string;
  /** The calc_run created, or null if none was (failed validation, or identical inputs). */
  runId: string | null;
  stages: StageResult[];
}

export const FUND_ID = 'FUND-001';
export const ENGINE_VERSION = 'waterfall-engine m5';

export const emptyDatabase = (): Database => ({
  fund_terms: [],
  fee_schedule: [],
  partner: [],
  terms_approval: [],
  deal: [],
  cash_flow_event: [],
  calc_run: [],
  fee_accrual: [],
  waterfall_allocation: [],
  clawback: [],
  report_snapshot: [],
});

const money = (x: number) => Math.round(x * 100) / 100;
const rate = (x: number) => Math.round(x * 1e6) / 1e6;

/** Validation messages belong to the stage that owns the field. */
const isCashFlowIssue = (i: ValidationIssue) => i.field.startsWith('events') || i.field.startsWith('nav');

/** The run nobody has superseded yet (the v_current_run view). */
export function currentRun(db: Database): Row | null {
  const superseded = new Set(db.calc_run.map((r) => r.supersedes_run_id));
  return db.calc_run.filter((r) => !superseded.has(r.run_id)).at(-1) ?? null;
}

export function executeRun(db: Database, history: PipelineRun[], request: { input: FundInput; reason: string }): { db: Database; run: PipelineRun } {
  const { input, reason } = request;
  const seq = history.length + 1;
  const next: Database = Object.fromEntries(Object.entries(db).map(([k, rows]) => [k, [...rows]])) as Database;
  const stages: StageResult[] = [];
  const write = (table: TableName, rows: Row[]) => {
    next[table].push(...rows);
    return { table, rows };
  };
  const skipRest = (from: StageId[], why: string) => {
    for (const id of from) stages.push({ id, status: 'skipped', note: why, input: null, output: null, writes: [], reads: [] });
  };

  const issues = validate(input);
  const termsIssues = issues.filter((i) => !isCashFlowIssue(i));
  const flowIssues = issues.filter(isCashFlowIssue);

  // ---------------------------------------------------------------- 1. terms
  const termsContent = {
    fund_id: FUND_ID,
    terms: { ...input.terms, lossRecovery: input.terms.structure === 'american' ? (input.terms.lossRecovery ?? 'realized') : null },
    fees: input.fees ?? null,
    partners: input.partners,
  };
  const termsVersionId = `tv_${fingerprint(termsContent)}`;
  const termsExist = db.fund_terms.some((r) => r.terms_version_id === termsVersionId);
  const termsWrites = termsExist
    ? []
    : [
        write('fund_terms', [
          {
            terms_version_id: termsVersionId,
            fund_id: FUND_ID,
            structure: input.terms.structure,
            hurdle_rate: rate(input.terms.hurdleRate),
            compounding: input.terms.compounding,
            catch_up_rate: rate(input.terms.catchUpRate),
            carry_rate: rate(input.terms.carryRate),
            loss_recovery: termsContent.terms.lossRecovery,
            created_seq: seq,
          },
        ]),
        write(
          'fee_schedule',
          Object.entries(input.fees?.classes ?? {}).flatMap(([feeClass, cls]) =>
            cls.periods.map((p, i) => ({
              terms_version_id: termsVersionId,
              fee_class: feeClass,
              period_no: i + 1,
              period_from: p.from,
              period_to: p.to,
              annual_rate: rate(p.rate),
              basis: p.basis,
              discount_mode: cls.sizeDiscount?.mode ?? null,
              discount_min: cls.sizeDiscount?.bands[0]?.minCommitment ?? null,
              discount_cut: cls.sizeDiscount?.bands[0] ? rate(cls.sizeDiscount.bands[0].rateReduction) : null,
            })),
          ),
        ),
        write(
          'partner',
          input.partners.map((p) => ({
            terms_version_id: termsVersionId,
            partner_id: p.id,
            role: p.role,
            commitment: money(p.commitment),
            fee_class: p.feeClassId ?? null,
          })),
        ),
      ];
  stages.push({
    id: 'terms',
    status: termsExist ? 'reused' : 'done',
    note: termsExist
      ? `These exact terms are already stored as ${termsVersionId}. Nothing new is written: same content, same id.`
      : `New terms version ${termsVersionId}. Its id is a hash of the content, so any change to the terms gives a new id.`,
    input: termsContent,
    output: { terms_version_id: termsVersionId, new_version: !termsExist },
    writes: termsWrites,
    reads: ['fund_terms'],
  });

  // ---------------------------------------------------------------- 2. validation & approval
  const approved = termsIssues.length === 0;
  const alreadyApproved = db.terms_approval.some((r) => r.terms_version_id === termsVersionId && r.decision === 'approved');
  const approvalWrites =
    alreadyApproved && approved
      ? []
      : [
          write('terms_approval', [
            {
              approval_id: `appr_${String(seq).padStart(4, '0')}`,
              terms_version_id: termsVersionId,
              decision: approved ? 'approved' : 'rejected',
              issues: JSON.stringify(termsIssues),
              decided_seq: seq,
            },
          ]),
        ];
  stages.push({
    id: 'validation',
    status: approved ? (alreadyApproved ? 'reused' : 'done') : 'failed',
    note: !approved
      ? `Rejected: ${termsIssues.length} problem(s). The rejection is stored too, and nothing downstream runs.`
      : alreadyApproved
        ? 'This terms version was approved before. Approval is per version, so it carries over.'
        : 'All rules pass. In a real system a second person would approve here (four-eyes check).',
    input: { terms_version_id: termsVersionId, rules_checked: 'carry, catch-up, compounding, partners, fee classes and periods' },
    output: { decision: approved ? 'approved' : 'rejected', issues: termsIssues },
    writes: approvalWrites,
    reads: ['fund_terms', 'fee_schedule', 'partner'],
  });
  if (!approved) {
    skipRest(['ingestion', 'run', 'fees', 'allocation', 'reporting'], 'Skipped: terms not approved.');
    return { db: next, run: { seq, reason, runId: null, stages } };
  }

  // ---------------------------------------------------------------- 3. cash-flow ingestion
  const batchContent = { fund_id: FUND_ID, events: input.events, nav: input.nav ?? null };
  const batchId = `cfb_${fingerprint(batchContent)}`;
  if (flowIssues.length > 0) {
    stages.push({
      id: 'ingestion',
      status: 'failed',
      note: `The batch failed ${flowIssues.length} check(s), so it is not loaded.`,
      input: batchContent,
      output: { batch_id: batchId, issues: flowIssues },
      writes: [],
      reads: [],
    });
    skipRest(['run', 'fees', 'allocation', 'reporting'], 'Skipped: cash flows not loaded.');
    return { db: next, run: { seq, reason, runId: null, stages } };
  }
  const batchExists = db.cash_flow_event.some((r) => r.batch_id === batchId);
  const knownDeals = new Set(db.deal.map((r) => r.deal_id));
  const newDeals = [...new Set(input.events.map((e) => e.dealId).filter((d): d is string => !!d && !knownDeals.has(d)))];
  const seqInDay = new Map<string, number>();
  const ingestionWrites = batchExists
    ? []
    : [
        write('deal', newDeals.map((d) => ({ fund_id: FUND_ID, deal_id: d }))),
        write(
          'cash_flow_event',
          input.events.map((e) => {
            const n = (seqInDay.get(e.date) ?? 0) + 1;
            seqInDay.set(e.date, n);
            return {
              batch_id: batchId,
              event_id: e.id,
              fund_id: FUND_ID,
              deal_id: e.dealId ?? null,
              kind: e.kind,
              event_date: e.date,
              seq_in_day: n,
              amount: money(e.kind === 'capital_call' ? e.investment + e.fee : e.amount),
              cost_realized: e.kind === 'distribution' ? money(e.costRealized ?? 0) : null,
            };
          }),
        ),
      ];
  const calls = input.events.filter((e) => e.kind === 'capital_call');
  const dists = input.events.filter((e) => e.kind === 'distribution');
  stages.push({
    id: 'ingestion',
    status: batchExists ? 'reused' : 'done',
    note: batchExists
      ? `Same cash flows as an earlier batch (${batchId}): nothing reloaded.`
      : `Loaded batch ${batchId}. Events are stored with their order within a day, because the waterfall depends on it.`,
    input: batchContent,
    output: {
      batch_id: batchId,
      capital_calls: calls.length,
      distributions: dists.length,
      total_called: money(calls.reduce((s, e) => s + (e.kind === 'capital_call' ? e.investment : 0), 0)),
      total_distributed: money(dists.reduce((s, e) => s + (e.kind === 'distribution' ? e.amount : 0), 0)),
      nav: input.nav ?? null,
    },
    writes: ingestionWrites,
    reads: ['cash_flow_event'],
  });

  // ---------------------------------------------------------------- 4. calculation run
  const inputHash = fingerprint({ termsVersionId, batchId, ENGINE_VERSION });
  const duplicate = db.calc_run.find((r) => r.input_hash === inputHash);
  const runInput = { fund_id: FUND_ID, terms_version_id: termsVersionId, batch_id: batchId, engine_version: ENGINE_VERSION };
  if (duplicate) {
    stages.push({
      id: 'run',
      status: 'reused',
      note: `Same terms, same cash flows and same engine as ${duplicate.run_id}, so the answer would be identical. No new run (idempotent).`,
      input: runInput,
      output: { input_hash: inputHash, existing_run_id: duplicate.run_id },
      writes: [],
      reads: ['calc_run'],
    });
    skipRest(['fees', 'allocation', 'reporting'], `Skipped: results already exist in ${duplicate.run_id}.`);
    return { db: next, run: { seq, reason, runId: null, stages } };
  }
  const id = runId(db.calc_run.length + 1);
  const previous = currentRun(db);
  const lastEventDate = input.events.at(-1)?.date ?? null;
  const asOf = input.nav?.date ?? lastEventDate;
  const runRow: Row = {
    run_id: id,
    fund_id: FUND_ID,
    terms_version_id: termsVersionId,
    batch_id: batchId,
    engine_version: ENGINE_VERSION,
    input_hash: inputHash,
    as_of_date: asOf,
    supersedes_run_id: (previous?.run_id as string | undefined) ?? null,
    reason,
    created_seq: seq,
  };
  stages.push({
    id: 'run',
    status: 'done',
    note: previous
      ? `New run ${id}. It supersedes ${previous.run_id}, whose rows stay exactly as they were.`
      : `First run ${id} for this fund.`,
    input: { ...runInput, reason },
    output: { ...runRow },
    writes: [write('calc_run', [runRow])],
    reads: ['fund_terms', 'fee_schedule', 'partner', 'cash_flow_event'],
  });

  // The engine does the actual work. Everything below is shaping its output into rows.
  const result = runFund(input);
  const metrics = computeMetrics(input, result);

  // ---------------------------------------------------------------- 5. fees
  const feeRows: Row[] = result.fees.map((f) => ({
    run_id: id,
    partner_id: f.partnerId,
    billing_date: f.date,
    period_no: f.periodIndex + 1,
    basis: f.basis,
    basis_amount: money(f.basisAmount),
    annual_rate: rate(f.rate),
    amount: money(f.amount),
  }));
  stages.push({
    id: 'fees',
    status: 'done',
    note: feeRows.length
      ? `${feeRows.length} quarterly fee lines. They belong to the run because they are computed: new terms or cash flows can change them.`
      : 'No management fees in these terms.',
    input: { run_id: id, billing: 'quarterly in advance', fee_classes: Object.keys(input.fees?.classes ?? {}) },
    output: {
      lines: feeRows.length,
      total: money(result.fees.reduce((s, f) => s + f.amount, 0)),
      by_partner: Object.fromEntries(
        input.partners.map((p) => [p.id, money(result.fees.filter((f) => f.partnerId === p.id).reduce((s, f) => s + f.amount, 0))]),
      ),
    },
    writes: [write('fee_accrual', feeRows)],
    reads: ['calc_run', 'fee_schedule', 'partner', 'cash_flow_event'],
  });

  // ---------------------------------------------------------------- 6. allocation output
  const { rows: allocationRows, adjusted } = roundAllocations(id, input, result);
  const clawbackRows: Row[] = result.comparison
    ? result.partners.map((p) => {
        const eu = result.comparison!.european.partners.find((x) => x.partnerId === p.partnerId)!;
        const carry = (x: typeof p) => x.ledger.distributedGp + (x.liquidation?.steps.reduce((s, t) => s + t.gp, 0) ?? 0);
        return {
          run_id: id,
          partner_id: p.partnerId,
          american_carry: money(carry(p)),
          european_carry: money(carry(eu)),
          clawback_amount: money(p.clawback),
          settle_date: result.comparison!.date,
        };
      })
    : [];
  const reconciles = dists.every((e) => {
    const rows = allocationRows.filter((r) => r.event_id === e.id);
    return rows.reduce((s, r) => s + toCents(r.lp_amount as number) + toCents(r.gp_amount as number), 0) === toCents(e.kind === 'distribution' ? e.amount : 0);
  });
  stages.push({
    id: 'allocation',
    status: 'done',
    note: `${allocationRows.length} rows: one per distribution × partner × tier. Rounded to cents so each distribution adds up exactly (${adjusted} amount(s) got a remainder cent).`,
    input: { run_id: id, distributions: dists.length, partners: input.partners.length, tiers: TIERS },
    output: {
      rows: allocationRows.length,
      rounding: 'largest remainder, per distribution',
      cents_adjusted: adjusted,
      every_distribution_reconciles: reconciles,
      clawback: result.comparison ? money(result.comparison.clawback) : null,
    },
    writes: [write('waterfall_allocation', allocationRows), ...(clawbackRows.length ? [write('clawback', clawbackRows)] : [])],
    reads: ['calc_run', 'cash_flow_event'],
  });

  // ---------------------------------------------------------------- 7. reporting
  const fundMetrics = {
    paid_in: money(metrics.paidIn),
    distributed_to_lps: money(metrics.distributedLp),
    management_fees: money(metrics.fees),
    carry_paid: money(metrics.carryGp),
    accrued_carry: money(metrics.accruedCarry),
    clawback: money(metrics.clawback),
    dpi: metrics.dpi === null ? null : rate(metrics.dpi),
    tvpi: metrics.tvpi === null ? null : rate(metrics.tvpi),
    net_irr: metrics.irr === null ? null : rate(metrics.irr),
    gross_irr: metrics.bridge.grossIrr === null ? null : rate(metrics.bridge.grossIrr),
  };
  const reportRows: Row[] = [
    { run_id: id, report_seq: seq, scope: 'fund', metrics: JSON.stringify(fundMetrics) },
    ...result.partners.map((p) => {
      const navLp = p.liquidation?.steps.reduce((s, x) => s + x.lp, 0) ?? 0;
      return {
        run_id: id,
        report_seq: seq,
        scope: p.partnerId,
        metrics: JSON.stringify({
          paid_in: money(p.ledger.contributed),
          distributed: money(p.ledger.distributedLp),
          tvpi: p.ledger.contributed > 0 ? rate((p.ledger.distributedLp + navLp + p.clawback) / p.ledger.contributed) : null,
        }),
      };
    }),
  ];
  stages.push({
    id: 'reporting',
    status: 'done',
    note: `Published from ${id}. Reports point at their run, so a later re-run can't change numbers that were already sent.`,
    input: { query: 'SELECT … FROM v_current_run JOIN waterfall_allocation USING (run_id) …', run_id: id },
    output: fundMetrics,
    writes: [write('report_snapshot', reportRows)],
    reads: ['calc_run', 'waterfall_allocation', 'fee_accrual', 'clawback'],
  });

  return { db: next, run: { seq, reason, runId: id, stages } };
}

/**
 * One row per distribution × partner × tier (zeros included), with all of a distribution's LP and
 * GP amounts rounded together so they add up to the distribution to the cent.
 */
function roundAllocations(id: string, input: FundInput, result: WaterfallResult): { rows: Row[]; adjusted: number } {
  const rows: Row[] = [];
  let adjusted = 0;
  for (const e of input.events) {
    if (e.kind !== 'distribution') continue;
    // Gather this distribution's exact amounts: [partner, tier, lp, gp] for every partner and tier.
    const cells: { partnerId: string; tier: (typeof TIERS)[number]; lp: number; gp: number }[] = [];
    for (const p of result.partners) {
      for (const tier of TIERS) {
        const a = p.allocations.find((x) => x.eventId === e.id && x.tier === tier);
        cells.push({ partnerId: p.partnerId, tier, lp: a?.lp ?? 0, gp: a?.gp ?? 0 });
      }
    }
    const flat = cells.flatMap((c) => [c.lp, c.gp]);
    const cents = allocateCents(flat, toCents(e.amount));
    flat.forEach((x, i) => {
      if (cents[i] !== Math.round(x * 100)) adjusted++;
    });
    cells.forEach((c, i) => {
      rows.push({
        run_id: id,
        event_id: e.id,
        partner_id: c.partnerId,
        tier: c.tier,
        tier_seq: TIERS.indexOf(c.tier) + 1,
        lp_amount: fromCents(cents[2 * i]!),
        gp_amount: fromCents(cents[2 * i + 1]!),
      });
    });
  }
  return { rows, adjusted };
}
