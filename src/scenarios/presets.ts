import type { FundEvent, FundInput, Partner } from '../engine';

/**
 * Preset scenarios. All synthetic: invented LPs, round-ish numbers, amounts in $ millions.
 * The carry terms of the first two presets follow the ILPA Model LPA's whole-of-fund waterfall
 * (see sources.md). The fee terms are typical market terms, not from any one document.
 * M6 adds presets calibrated to public data.
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

/** A $100m fund that calls $95m over 2020–2022, one deal per call. */
const CALLS: FundEvent[] = [
  { id: 'call-1', kind: 'capital_call', date: '2020-03-31', investment: 30, fee: 0, dealId: 'A' },
  { id: 'call-2', kind: 'capital_call', date: '2020-12-31', investment: 25, fee: 0, dealId: 'B' },
  { id: 'call-3', kind: 'capital_call', date: '2021-09-30', investment: 25, fee: 0, dealId: 'C' },
  { id: 'call-4', kind: 'capital_call', date: '2022-06-30', investment: 15, fee: 0, dealId: 'D' },
];

/** A distribution from one deal, with the cost of what was sold (needed for American waterfalls and fees). */
const dist = (id: string, date: string, amount: number, dealId: string, costRealized: number): FundEvent => ({
  id,
  kind: 'distribution',
  date,
  amount,
  dealId,
  costRealized,
});

export const PRESETS: Preset[] = [
  {
    id: 'full-fund',
    name: 'Full fund: fees, side letters, GP commitment',
    blurb:
      'ILPA-style carry terms plus management fees: 2% on commitments for a 5-year investment period, then ' +
      '1.5% on invested capital, billed quarterly. LP Alpha gets a 0.25% size discount (≥ $40m), LP Beta has ' +
      'a side letter (0.5% off), and the GP invests 2% of the fund itself. Compare net IRRs across partners, ' +
      'and see how much of the gross profit fees and carry take.',
    input: {
      terms: { structure: 'european', hurdleRate: 0.08, compounding: 'annual', catchUpRate: 0.8, carryRate: 0.2 },
      partners: [
        { id: 'LP Alpha (pension)', role: 'LP', commitment: 50, feeClassId: 'standard' },
        { id: 'LP Beta (insurer)', role: 'LP', commitment: 30, feeClassId: 'side_letter' },
        { id: 'LP Gamma (family office)', role: 'LP', commitment: 18, feeClassId: 'standard' },
        { id: 'GP commitment', role: 'GP', commitment: 2 },
      ],
      events: [
        { id: 'call-1', kind: 'capital_call', date: '2020-03-31', investment: 25, fee: 0, dealId: 'A' },
        { id: 'call-2', kind: 'capital_call', date: '2020-12-31', investment: 25, fee: 0, dealId: 'B' },
        { id: 'call-3', kind: 'capital_call', date: '2021-09-30', investment: 22, fee: 0, dealId: 'C' },
        { id: 'call-4', kind: 'capital_call', date: '2022-06-30', investment: 13, fee: 0, dealId: 'D' },
        dist('dist-1', '2023-06-30', 20, 'D', 12),
        dist('dist-2', '2024-12-31', 45, 'B', 25),
        dist('dist-3', '2026-06-30', 60, 'A', 25),
        dist('dist-4', '2027-12-31', 50, 'C', 22),
      ],
      nav: { date: '2027-12-31', amount: 10 },
      fees: {
        start: '2020-01-01',
        classes: {
          standard: {
            periods: [
              { from: '2020-01-01', to: '2025-01-01', rate: 0.02, basis: 'commitment' },
              { from: '2025-01-01', to: '2030-01-01', rate: 0.015, basis: 'invested_capital' },
            ],
            sizeDiscount: { mode: 'whole', bands: [{ minCommitment: 40, rateReduction: 0.0025 }] },
          },
          side_letter: {
            periods: [
              { from: '2020-01-01', to: '2025-01-01', rate: 0.015, basis: 'commitment' },
              { from: '2025-01-01', to: '2030-01-01', rate: 0.01, basis: 'invested_capital' },
            ],
            sizeDiscount: { mode: 'whole', bands: [{ minCommitment: 40, rateReduction: 0.0025 }] },
          },
        },
      },
    },
  },
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
        dist('dist-1', '2023-06-30', 20, 'B', 15),
        dist('dist-2', '2024-12-31', 45, 'A', 30),
        dist('dist-3', '2026-06-30', 60, 'C', 25),
        dist('dist-4', '2027-12-31', 50, 'B', 10),
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
        dist('dist-1', '2023-06-30', 20, 'B', 25),
        dist('dist-2', '2024-12-31', 45, 'A', 30),
        dist('dist-3', '2026-06-30', 60, 'C', 25),
        dist('dist-4', '2027-12-31', 12, 'D', 15),
      ],
    },
  },
  {
    id: 'american-loss',
    name: 'American: a write-off and a clawback',
    blurb:
      'Pure deal by deal (losses ignored), with ILPA-style carry terms. Deal A doubles in 2023 and the GP takes carry on it ' +
      'right away. Deal B is written off in 2024. C and D each make a profit on their own, so the GP earns carry on them ' +
      'too, even though B was never made up. On the whole fund the GP would earn $9m. It received $14m, so $5m is clawed ' +
      'back at the end. Now set losses to "Recovered first": American carry drops below European.',
    input: {
      terms: { structure: 'american', lossRecovery: 'none', hurdleRate: 0.08, compounding: 'annual', catchUpRate: 0.8, carryRate: 0.2 },
      partners: LPS,
      events: [
        ...CALLS,
        dist('dist-a', '2023-06-30', 60, 'A', 30),
        dist('write-off-b', '2024-06-30', 0, 'B', 25),
        dist('dist-c', '2025-12-31', 45, 'C', 25),
        dist('dist-d', '2027-06-30', 35, 'D', 15),
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
        { id: 'c1', kind: 'capital_call', date: '2025-01-01', investment: 100, fee: 0, dealId: 'A' },
        dist('d1', '2026-01-01', 60, 'A', 40),
        dist('d2', '2027-01-01', 100, 'A', 60),
      ],
    },
  },
];
