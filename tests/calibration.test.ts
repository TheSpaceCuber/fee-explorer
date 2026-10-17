import { describe, expect, it } from 'vitest';
import { calibrate } from '../src/scenarios/calibrate';
import { buyoutShape, REPORTED, typicalBuyoutTerms } from '../src/scenarios/public';

/**
 * The calibrated presets must reproduce what the pension actually published.
 * Tolerances: amounts within $0.05m (they are printed to $0.1m), IRR within 0.1 percentage point.
 */
describe('calibration to published net figures', () => {
  for (const [key, r] of Object.entries(REPORTED)) {
    it(`${r.name}: reproduces contributed, distributed, NAV, TVPI and IRR`, () => {
      const t0 = performance.now();
      const c = calibrate(r, buyoutShape(r.vintage, r.nav > 0 ? 0.05 : 0), typicalBuyoutTerms(r.vintage));
      const ms = performance.now() - t0;
      expect(Math.abs(c.fit.contributed - r.contributed), 'contributed').toBeLessThan(0.05);
      expect(Math.abs(c.fit.distributed - r.distributed), 'distributed').toBeLessThan(0.05);
      expect(Math.abs(c.fit.nav - r.nav), 'nav').toBeLessThan(0.05);
      expect(Math.abs(c.fit.tvpi! - r.tvpi), 'tvpi').toBeLessThan(0.01);
      expect(Math.abs(c.fit.irr! - r.irr), 'irr').toBeLessThan(0.001);
      console.info(key, `${ms.toFixed(0)}ms`, 'gross MOIC', c.gross.moic?.toFixed(3), 'gross IRR', c.gross.irr?.toFixed(4), 'fees', c.gross.fees.toFixed(2), 'carry', c.gross.carry.toFixed(2), 'shift', c.shiftDays);
    });
  }
});

describe('net-to-gross: one net result, many gross stories', () => {
  it('every fee/carry combination reproduces the same net figures, with more gross needed as terms get richer', async () => {
    const { solveGross } = await import('../src/scenarios/calibrate');
    const { NET_TO_GROSS_GRID } = await import('../src/scenarios/public');
    const r = REPORTED.adventVI;
    const shape = buyoutShape(r.vintage, 0.05);
    const rows = NET_TO_GROSS_GRID.map((g) => ({ ...g, ...solveGross(r, shape, typicalBuyoutTerms(r.vintage, g)) }));
    for (const row of rows) {
      expect(Math.abs(row.netTvpi! - r.tvpi)).toBeLessThan(0.01);
      expect(Math.abs(row.netIrr! - r.irr)).toBeLessThan(0.001);
    }
    // Same carry, higher fee → more gross return needed. Same fee, higher carry → more gross needed.
    const at = (f: number, c: number) => rows.find((x) => x.feeRate === f && x.carryRate === c)!.grossMoic!;
    expect(at(0.02, 0.2)).toBeGreaterThan(at(0.01, 0.2));
    expect(at(0.015, 0.25)).toBeGreaterThan(at(0.015, 0.15));
  });
});
