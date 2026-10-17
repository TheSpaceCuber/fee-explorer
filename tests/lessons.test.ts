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

describe('Part 3 (carry): predict answers and text claims agree with the engine', () => {
  const alloc = (input: FundInput, eventId: string, tier: string) => runFund(input).allocations.find((a) => a.eventId === eventId && a.tier === tier)!;

  it('7 carry basics: the first carry dollar comes in the third distribution, as the text works out', () => {
    const input = WIDGETS.carrySplit.input(WIDGETS.carrySplit.init());
    const r = runFund(input);
    const withCarry = input.events.filter((e) => e.kind === 'distribution' && r.allocations.some((a) => a.eventId === e.id && a.gp > 1e-9));
    expect(withCarry[0]!.id).toBe('dist-3');
    // "The third one finishes returning capital ($20m), and the remaining $40m is profit, split 80/20."
    expect(alloc(input, 'dist-3', 'ROC').lp).toBeCloseTo(20, 9);
    const split = alloc(input, 'dist-3', 'SPLIT');
    expect(split.lp + split.gp).toBeCloseTo(40, 9);
    expect(split.gp).toBeCloseTo(8, 9);
    expect(answerOf('carry-basics')).toBe(1);
  });

  it('8 the hurdle: adding an 8% hurdle (no catch-up) lowers the GP carry and its share below 20%', () => {
    const w = WIDGETS.hurdle;
    const carry = (h: number) => runFund(w.input({ ...w.init(), hurdle: h })).allocations.reduce((s, a) => s + a.gp, 0);
    expect(carry(0.08)).toBeLessThan(carry(0));
    expect(metrics(w.input(w.init())).gpShareOfProfit!).toBeLessThan(0.2);
    expect(answerOf('the-hurdle')).toBe(1);
  });

  it('9 the catch-up: with a full (or 80%) catch-up the GP ends at exactly 20% of profit', () => {
    const w = WIDGETS.catchUp;
    expect(metrics(w.input({ ...w.init(), catchUp: 1 })).gpShareOfProfit!).toBeCloseTo(0.2, 9);
    expect(metrics(w.input({ ...w.init(), catchUp: 0.8 })).gpShareOfProfit!).toBeCloseTo(0.2, 9); // "ends in the same place"
    expect(metrics(w.input({ ...w.init(), catchUp: 0 })).gpShareOfProfit!).toBeLessThan(0.2);
    expect(answerOf('the-catch-up')).toBe(1);
  });

  it('10 accrued carry: $40m of NAV shows as less on the LP statement, and each extra $1m gives the GP 20 cents', () => {
    const w = WIDGETS.accrued;
    const at = (nav: number) => metrics(w.input({ nav }));
    expect(at(40).netNav).toBeLessThan(40);
    expect(at(45).accruedCarry - at(40).accruedCarry).toBeCloseTo(1, 9); // $5m more NAV → $1m more accrued carry
    expect(at(0).tvpi).toBeCloseTo(at(0).dpi!, 12); // "Set the NAV to $0: TVPI then equals DPI"
    expect(answerOf('accrued-carry')).toBe(1);
  });

  it('11 compounding: annual compounding pays the LP more pref than simple interest', () => {
    const w = WIDGETS.compounding;
    const pref = (conv: string) =>
      runFund(w.input({ conv, hurdle: 0.08 })).allocations.filter((a) => a.tier === 'PREF').reduce((s, a) => s + a.lp, 0);
    expect(pref('annual')).toBeGreaterThan(pref('simple'));
    expect(pref('daily')).toBeGreaterThan(pref('annual'));
    expect(answerOf('compounding')).toBe(0);
  });
});

describe('Parts 4–5: predict answers and text claims agree with the engine', () => {
  const firstCarry = (allocs: { eventId: string; gp: number }[]) => allocs.find((a) => a.gp > 1e-9)?.eventId;

  it('12 European vs American: American pays carry first; with losses recovered it can pay less in total', () => {
    const r = runFund(WIDGETS.structure.input({ lossRecovery: 'realized' }));
    expect(firstCarry(r.allocations)).toBe('dist-A'); // 2023
    expect(firstCarry(r.comparison!.european.allocations)).toBe('dist-D'); // 2027, "with the last sale"
    expect(r.comparison!.americanCarry).toBeLessThan(r.comparison!.europeanCarry); // "can even end up paying the GP less"
    expect(answerOf('european-vs-american')).toBe(1);
  });

  it('13 clawback: $14m received, $9m whole-fund, $5m paid back; and it stays at 20% of deal B\u2019s $25m loss', () => {
    const c = runFund(WIDGETS.clawback.input(WIDGETS.clawback.init())).comparison!;
    expect(c.americanCarry).toBeCloseTo(14, 9);
    expect(c.europeanCarry).toBeCloseTo(9, 9);
    expect(c.clawback).toBeCloseTo(5, 9);
    for (const dealC of [45, 50, 60, 70]) expect(runFund(WIDGETS.clawback.input({ dealC })).comparison!.clawback).toBeCloseTo(0.2 * 25, 9);
    expect(answerOf('clawback')).toBe(1);
  });

  it('14 gross to net: about 17.0% gross, 14.5% after fees, 12.6% net', () => {
    const m = metrics(WIDGETS.grossNet.input(WIDGETS.grossNet.init()));
    expect(m.bridge.grossIrr!).toBeCloseTo(0.17, 2);
    expect(m.bridge.irrAfterFees!).toBeCloseTo(0.145, 2);
    expect(m.irr!).toBeGreaterThan(0.12);
    expect(m.irr!).toBeLessThan(0.13); // "About 12–13%"
    expect(answerOf('gross-to-net')).toBe(1);
  });

  it('15 net to gross: the same net result fits gross multiples from about 2.5x to 2.9x', async () => {
    const { solveGross } = await import('../src/scenarios/calibrate');
    const { NET_TO_GROSS_GRID, REPORTED, buyoutShape, typicalBuyoutTerms } = await import('../src/scenarios/public');
    const r = REPORTED.adventVI;
    const moics = NET_TO_GROSS_GRID.map((g) => solveGross(r, buyoutShape(r.vintage, 0.05), typicalBuyoutTerms(r.vintage, g)).grossMoic!);
    expect(Math.min(...moics)).toBeGreaterThan(2.4);
    expect(Math.min(...moics)).toBeLessThan(2.55);
    expect(Math.max(...moics)).toBeGreaterThan(2.8);
    expect(Math.max(...moics)).toBeLessThan(2.95);
    expect(answerOf('net-to-gross')).toBe(1);
  });
});
