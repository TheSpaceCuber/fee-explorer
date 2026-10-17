import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { runFund, type FundInput } from '../src/engine';
import { allocateCents, currentRun, emptyDatabase, executeRun, toCents, type Database, type PipelineRun } from '../src/pipeline';
import { PRESETS } from '../src/scenarios/presets';
import { fundArb } from './arbitraries';

const preset = (id: string) => structuredClone(PRESETS.find((p) => p.id === id)!.input);
const run = (input: FundInput, db: Database = emptyDatabase(), history: PipelineRun[] = [], reason = 'test') =>
  executeRun(db, history, { input, reason });
const rowsOf = (db: Database, runId: string) => db.waterfall_allocation.filter((r) => r.run_id === runId);

describe('largest-remainder rounding', () => {
  it('hand-worked: case B2 (50% catch-up) stores 100, 10, 3.33, 3.33, 26.67, 6.67', () => {
    // ROC lp/gp, PREF lp/gp, CATCHUP lp/gp, SPLIT lp/gp
    const exact = [100, 0, 10, 0, 10 / 3, 10 / 3, 80 / 3, 20 / 3];
    expect(allocateCents(exact, 15000)).toEqual([10000, 0, 1000, 0, 333, 333, 2667, 667]);
  });

  it('always hits the target, and moves no amount by a cent or more', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 10_000_000 }).map((c) => c / 7), { minLength: 1, maxLength: 40 }), (amounts) => {
        const target = toCents(amounts.reduce((s, a) => s + a, 0));
        const cents = allocateCents(amounts, target);
        expect(cents.reduce((s, c) => s + c, 0)).toBe(target);
        cents.forEach((c, i) => expect(Math.abs(c - amounts[i]! * 100)).toBeLessThan(1 + 1e-6));
      }),
    );
  });
});

describe('pipeline: rows come from the engine', () => {
  it('every distribution reconciles to the cent, and each row is within a cent of the engine', () => {
    fc.assert(
      fc.property(fundArb, (input) => {
        const { db, run: r } = run(input);
        const engine = runFund(input);
        for (const e of input.events) {
          if (e.kind !== 'distribution') continue;
          const rows = db.waterfall_allocation.filter((x) => x.event_id === e.id);
          const total = rows.reduce((s, x) => s + toCents(x.lp_amount as number) + toCents(x.gp_amount as number), 0);
          expect(total).toBe(toCents(e.amount));
          for (const x of rows) {
            const a = engine.partners.find((p) => p.partnerId === x.partner_id)!.allocations.find((y) => y.eventId === e.id && y.tier === x.tier)!;
            expect(Math.abs((x.lp_amount as number) - a.lp)).toBeLessThan(0.01 + 1e-9);
            expect(Math.abs((x.gp_amount as number) - a.gp)).toBeLessThan(0.01 + 1e-9);
          }
        }
        expect(r.stages.find((s) => s.id === 'allocation')!.output).toMatchObject({ every_distribution_reconciles: true });
      }),
      { numRuns: 60 },
    );
  });

  it('is deterministic: the same request gives the same ids and rows', () => {
    const input = preset('full-fund');
    expect(run(input)).toEqual(run(input));
  });

  it('American funds also store clawback rows that match the engine', () => {
    const input = preset('american-loss');
    const { db } = run(input);
    const total = db.clawback.reduce((s, r) => s + (r.clawback_amount as number), 0);
    expect(total).toBeCloseTo(runFund(input).comparison!.clawback, 2);
    expect(total).toBeGreaterThan(0);
  });
});

describe('pipeline: history is never overwritten', () => {
  it('a re-run with changed terms adds a new version and a new run, and leaves the old rows alone', () => {
    const input = preset('clean-european');
    const first = run(input);
    const oldRows = structuredClone(rowsOf(first.db, 'run_0001'));

    const amended = { ...input, terms: { ...input.terms, hurdleRate: 0.09 } };
    const second = run(amended, first.db, [first.run], 'Terms amendment: hurdle 9%');

    expect(second.run.runId).toBe('run_0002');
    const tv1 = first.db.calc_run[0]!.terms_version_id;
    const tv2 = second.db.calc_run[1]!.terms_version_id;
    expect(tv2).not.toBe(tv1);
    expect(second.db.calc_run[1]!.supersedes_run_id).toBe('run_0001');
    expect(currentRun(second.db)!.run_id).toBe('run_0002');
    // Append-only: every table only grew, and run_0001's rows are byte-for-byte the same.
    for (const table of Object.keys(first.db) as (keyof Database)[]) {
      expect(second.db[table].slice(0, first.db[table].length)).toEqual(first.db[table]);
    }
    expect(rowsOf(second.db, 'run_0001')).toEqual(oldRows);
  });

  it('a re-run with new cash flows but the same terms reuses the terms version', () => {
    const input = preset('clean-european');
    const first = run(input);
    const lateFlow = { ...input, nav: { date: '2027-12-31', amount: 12 } };
    const second = run(lateFlow, first.db, [first.run], 'Revised NAV');
    expect(second.run.stages.find((s) => s.id === 'terms')!.status).toBe('reused');
    expect(second.run.stages.find((s) => s.id === 'ingestion')!.status).toBe('done');
    expect(second.db.calc_run[1]!.terms_version_id).toBe(first.db.calc_run[0]!.terms_version_id);
    expect(second.db.calc_run[1]!.batch_id).not.toBe(first.db.calc_run[0]!.batch_id);
  });

  it('re-running identical inputs is a no-op (idempotent)', () => {
    const input = preset('full-fund');
    const first = run(input);
    const again = run(input, first.db, [first.run], 'Accidental double click');
    expect(again.run.runId).toBeNull();
    expect(again.run.stages.find((s) => s.id === 'run')!.status).toBe('reused');
    expect(again.db).toEqual(first.db);
  });

  it('invalid terms are rejected and recorded, and nothing is calculated', () => {
    const input = preset('textbook-100');
    const bad = { ...input, terms: { ...input.terms, catchUpRate: 0.1 } };
    const { db, run: r } = run(bad);
    expect(r.runId).toBeNull();
    expect(r.stages.find((s) => s.id === 'validation')!.status).toBe('failed');
    expect(db.terms_approval).toHaveLength(1);
    expect(db.terms_approval[0]!.decision).toBe('rejected');
    expect(db.calc_run).toHaveLength(0);
    expect(r.stages.filter((s) => s.status === 'skipped').map((s) => s.id)).toEqual(['ingestion', 'run', 'fees', 'allocation', 'reporting']);
  });
});
