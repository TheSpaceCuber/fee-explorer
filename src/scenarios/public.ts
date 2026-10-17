import type { AssumedTerms, ReportedFund, Shape } from './calibrate';

/**
 * Reported figures from a public pension's disclosure, as printed. See sources.md.
 *
 * Source: Oregon Public Employees Retirement Fund (OPERF), "Private Equity Portfolio, as of
 * December 31, 2024" ($ in millions). Figures are net of fees. Funds marked as sold on the
 * secondary market were deliberately not used.
 */
export const OPERF_SOURCE = {
  publisher: 'Oregon State Treasury',
  document: 'OPERF Private Equity Portfolio, as of December 31, 2024',
  url: 'https://www.oregon.gov/treasury/invested-for-oregon/Documents/Invested-for-OR-Performance-and-Holdings/2024/OPERF_Private_Equity_Portfolio_-_Quarter_4_2024.pdf',
};

export const REPORTED: Record<'adventVI' | 'avistaIII', ReportedFund> = {
  adventVI: {
    name: 'Advent International GPE VI A',
    vintage: 2008,
    asOf: '2024-12-31',
    commitment: 100.0,
    contributed: 100.0,
    distributed: 200.8,
    nav: 7.6,
    tvpi: 2.08,
    irr: 0.163,
  },
  avistaIII: {
    name: 'Avista Capital Partners III',
    vintage: 2011,
    asOf: '2024-12-31',
    commitment: 100.0,
    contributed: 113.7,
    distributed: 113.6,
    nav: 0.0,
    tvpi: 1.0,
    irr: 0.0,
  },
};

/**
 * ASSUMED timing: a typical buyout pattern (calls over ~5 years, distributions over ~10, peaking
 * in years 6–8). The real dates aren't published; calibration then shifts the distribution dates
 * to match the reported IRR.
 */
export function buyoutShape(vintage: number, costStillHeld: number): Shape {
  const y = (k: number) => `${vintage + k}-06-30`;
  return {
    calls: [[y(0), 0.15], [y(1), 0.2], [y(2), 0.25], [y(3), 0.2], [y(4), 0.12], [y(5), 0.08]],
    dists: [
      [y(3), 0.03], [y(4), 0.07], [y(5), 0.12], [y(6), 0.16], [y(7), 0.17], [y(8), 0.14],
      [y(9), 0.11], [y(10), 0.08], [y(11), 0.06], [y(12), 0.04], [y(13), 0.02],
    ],
    costStillHeld,
  };
}

/**
 * ASSUMED terms, typical of large buyout funds of that era. The funds' actual LPAs aren't public.
 * 1.5% on commitments for a 6-year investment period, then 1% on invested capital; 8% hurdle,
 * 100% catch-up, 20% carry, European.
 */
export function typicalBuyoutTerms(vintage: number, overrides: Partial<{ feeRate: number; carryRate: number; catchUpRate: number; hurdleRate: number }> = {}): AssumedTerms {
  const feeRate = overrides.feeRate ?? 0.015;
  const start = `${vintage}-03-31`;
  const ipEnd = `${vintage + 6}-03-31`;
  return {
    carry: {
      structure: 'european',
      hurdleRate: overrides.hurdleRate ?? 0.08,
      compounding: 'annual',
      catchUpRate: overrides.catchUpRate ?? 1,
      carryRate: overrides.carryRate ?? 0.2,
    },
    feeStart: start,
    fees: {
      periods: [
        { from: start, to: ipEnd, rate: feeRate, basis: 'commitment' },
        { from: ipEnd, to: `${vintage + 12}-03-31`, rate: Math.round(feeRate * (2 / 3) * 1e6) / 1e6, basis: 'invested_capital' },
      ],
    },
  };
}

export interface NetToGrossRow {
  feeRate: number;
  carryRate: number;
  grossMoic: number | null;
  grossIrr: number | null;
  fees: number;
  carry: number;
  /** The net figures this gross story produces (should all equal the published ones). */
  netTvpi: number | null;
  netIrr: number | null;
}

/** The fee and carry combinations the net-to-gross panel tries. */
export const NET_TO_GROSS_GRID: { feeRate: number; carryRate: number }[] = [0.01, 0.015, 0.02].flatMap((feeRate) =>
  [0.15, 0.2, 0.25].map((carryRate) => ({ feeRate, carryRate })),
);
