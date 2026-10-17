import { describe, expect, it } from 'vitest';
import { computeMetrics, partnersCashFlows, runFund, validate, xirr, type FundInput } from '../src/engine';
import { LESSONS, READY, lessonBySlug } from '../src/learn/lessons';
import { WIDGETS } from '../src/learn/widgets';

/**
 * The course's claims, checked by the engine. If a lesson's "predict, then check" answer ever
 * disagrees with what the numbers do, these tests fail.
 */

const metrics = (input: FundInput) => computeMetrics(input, runFund(input));
const answerOf = (slug: string) => lessonBySlug(slug)!.predict!.answer;

describe('lesson structure', () => {
  it('has unique slugs, and every ready lesson has a widget, a predict question and a takeaway', () => {
    expect(new Set(LESSONS.map((l) => l.slug)).size).toBe(LESSONS.length);
    for (const l of READY) {
      expect(l.widget, l.slug).toBeDefined();
      expect(l.takeaway, l.slug).toBeTruthy();
      expect(l.predict!.answer).toBeGreaterThanOrEqual(0);
      expect(l.predict!.answer).toBeLessThan(l.predict!.options.length);
    }
  });

  it("every widget's fund is valid at its starting settings", () => {
    for (const l of READY) {
      const w = WIDGETS[l.widget!];
      expect(validate(w.input(w.init())), l.slug).toEqual([]);
    }
  });
});

describe('predict answers agree with the engine', () => {
  it("1 who's who: the running total is lowest just before the first distribution", () => {
    const input = WIDGETS.timeline.input(WIDGETS.timeline.init());
    let running = 0;
    let low = { date: '', value: Infinity };
    for (const e of input.events) {
      running += e.kind === 'capital_call' ? -(e.investment + e.fee) : e.amount;
      if (running < low.value) low = { date: e.date, value: running };
    }
    const firstDist = input.events.find((e) => e.kind === 'distribution')!;
    const lastCallBefore = input.events.filter((e) => e.kind === 'capital_call' && e.date < firstDist.date).at(-1)!;
    expect(low.date).toBe(lastCallBefore.date);
    expect(answerOf('whos-who')).toBe(1); // "Just before the first distribution"
  });

  it('2 measuring returns: delaying distributions leaves TVPI unchanged and lowers IRR', () => {
    const now = metrics(WIDGETS.returns.input({ delay: 0 }));
    const later = metrics(WIDGETS.returns.input({ delay: 2 }));
    expect(later.tvpi).toBeCloseTo(now.tvpi!, 12);
    expect(later.irr!).toBeLessThan(now.irr!);
    expect(answerOf('measuring-returns')).toBe(1); // "TVPI stays the same, IRR falls"
  });

  it('3 the management fee: 2% on $100m is $0.5m every quarter', () => {
    const fees = runFund(WIDGETS.feeRate.input({ rate: 0.02 })).fees;
    expect(fees.length).toBeGreaterThan(0);
    for (const f of fees) expect(f.amount).toBeCloseTo(0.5, 12);
    expect(lessonBySlug('the-management-fee')!.predict!.options[answerOf('the-management-fee')]).toBe('$0.5m');
  });

  it('4 step-down: after a sale, the next quarter’s fee on invested capital is lower', () => {
    const input = WIDGETS.stepDown.input(WIDGETS.stepDown.init());
    const fees = runFund(input).fees;
    const ipEnd = '2025-01-01';
    const sale = input.events.find((e) => e.kind === 'distribution' && e.date > ipEnd)!;
    const before = fees.filter((f) => f.date <= sale.date).at(-1)!;
    const after = fees.find((f) => f.date > sale.date)!;
    expect(before.basis).toBe('invested_capital');
    expect(after.amount).toBeLessThan(before.amount);
    expect(answerOf('step-down')).toBe(1); // "goes down"
  });

  it('5 fee drag: a higher fee lowers the LP’s net TVPI', () => {
    const low = metrics(WIDGETS.feeDrag.input({ rate: 0.01 }));
    const high = metrics(WIDGETS.feeDrag.input({ rate: 0.02 }));
    expect(high.tvpi!).toBeLessThan(low.tvpi!);
    expect(high.bridge.grossMoic).toBeCloseTo(low.bridge.grossMoic!, 12); // the deals didn't change
    expect(answerOf('fee-drag')).toBe(1); // "falls"
  });

  it('6 who pays what: the GP commitment has the highest net IRR', () => {
    const input = WIDGETS.whoPays.input(WIDGETS.whoPays.init());
    const result = runFund(input);
    const irrs = result.partners.map((p) => ({ id: p.partnerId, irr: xirr(partnersCashFlows(input, [p]))! }));
    const best = irrs.reduce((a, b) => (b.irr > a.irr ? b : a));
    expect(best.id).toBe('GP commitment');
    expect(answerOf('who-pays-what')).toBe(2); // "The GP's own commitment"
  });
});
