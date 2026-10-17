import type { FundEvent, FundInput, Partner } from '../engine';

/**
 * Preset scenarios. All synthetic: invented LPs, round-ish numbers, amounts in $ millions.
 * The terms of the first preset follow the ILPA Model LPA's whole-of-fund waterfall
 * (see sources.md). M4 adds the American preset. M8 adds presets calibrated to public data.
 */
export interface Preset {
  id: string;
  name: string;
  blurb: string;
  input: FundInput;
}

const LPS: Partner[] = [
  { id: 'LP Alpha (pension)', role: 'LP', commitment: 50 },
  { id: 'LP Beta (insurer)', role: 'LP', commitment: 30 },
  { id: 'LP Gamma (family office)', role: 'LP', commitment: 20 },
];

/** A $100m fund that calls $95m over 2020–2022. */
const CALLS: FundEvent[] = [
  { id: 'call-1', kind: 'capital_call', date: '2020-03-31', investment: 30, fee: 0 },
  { id: 'call-2', kind: 'capital_call', date: '2020-12-31', investment: 25, fee: 0 },
  { id: 'call-3', kind: 'capital_call', date: '2021-09-30', investment: 25, fee: 0 },
  { id: 'call-4', kind: 'capital_call', date: '2022-06-30', investment: 15, fee: 0 },
];

const dist = (id: string, date: string, amount: number): FundEvent => ({ id, kind: 'distribution', date, amount });

export const PRESETS: Preset[] = [
  {
    id: 'clean-european',
    name: 'Clean European fund (ILPA-style terms)',
    blurb:
      'A $100m fund with three LPs. Terms follow the ILPA model whole-of-fund waterfall: 8% hurdle, ' +
      '80% GP catch-up, 20% carry (we assume annual compounding). The third distribution finishes ' +
      'returning capital. The fourth clears the pref, the GP catches up, and the rest is split 80/20. ' +
      '$10m of NAV is left, with accrued carry on it.',
    input: {
      terms: { structure: 'european', hurdleRate: 0.08, compounding: 'annual', catchUpRate: 0.8, carryRate: 0.2 },
      partners: LPS,
      events: [
        ...CALLS,
        dist('dist-1', '2023-06-30', 20),
        dist('dist-2', '2024-12-31', 45),
        dist('dist-3', '2026-06-30', 60),
        dist('dist-4', '2027-12-31', 50),
      ],
      nav: { date: '2027-12-31', amount: 10 },
    },
  },
  {
    id: 'catch-up-zone',
    name: 'Ending in the catch-up zone',
    blurb:
      'The same fund with a 100% catch-up, but the last exit only brings in $12m and nothing is left ' +
      'after it. The LPs clear the hurdle, then the cash runs out while the GP is catching up. The GP ' +
      'ends with well under 20% of the profit. Step through the Dec 2027 distribution to watch it happen.',
    input: {
      terms: { structure: 'european', hurdleRate: 0.08, compounding: 'annual', catchUpRate: 1, carryRate: 0.2 },
      partners: LPS,
      events: [
        ...CALLS,
        dist('dist-1', '2023-06-30', 20),
        dist('dist-2', '2024-12-31', 45),
        dist('dist-3', '2026-06-30', 60),
        dist('dist-4', '2027-12-31', 12),
      ],
    },
  },
  {
    id: 'textbook-100',
    name: 'Textbook $100 fund',
    blurb:
      'Hand-worked case A5: $100 in, $60 back after one year, $100 after two, 10% hurdle, no catch-up. ' +
      'The LP IRR is exactly 30%. Try adding a catch-up, or switching to simple interest (case C2).',
    input: {
      terms: { structure: 'european', hurdleRate: 0.1, compounding: 'annual', catchUpRate: 0, carryRate: 0.2 },
      partners: [{ id: 'LP', role: 'LP', commitment: 100 }],
      events: [
        { id: 'c1', kind: 'capital_call', date: '2025-01-01', investment: 100, fee: 0 },
        dist('d1', '2026-01-01', 60),
        dist('d2', '2027-01-01', 100),
      ],
    },
  },
];
