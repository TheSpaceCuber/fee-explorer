import type { FundInput } from '../engine';

/**
 * Preset scenarios. All synthetic: invented LPs, round-ish numbers, amounts in $ millions.
 * M2 adds the "inside the catch-up zone" preset, M4 the American one. M8 adds presets
 * calibrated to public data, with sources.
 */
export interface Preset {
  id: string;
  name: string;
  blurb: string;
  input: FundInput;
}

export const PRESETS: Preset[] = [
  {
    id: 'clean-european',
    name: 'Clean European fund',
    blurb:
      'A $100m fund with three LPs. Capital is called over three years and returned over five. ' +
      'The third distribution finishes returning capital and pays most of the 8% pref. The fourth ' +
      'clears the hurdle, and only then does the GP earn carry.',
    input: {
      terms: { structure: 'european', hurdleRate: 0.08, compounding: 'annual', catchUpRate: 0, carryRate: 0.2 },
      partners: [
        { id: 'LP Alpha (pension)', role: 'LP', commitment: 50 },
        { id: 'LP Beta (insurer)', role: 'LP', commitment: 30 },
        { id: 'LP Gamma (family office)', role: 'LP', commitment: 20 },
      ],
      events: [
        { id: 'call-1', kind: 'capital_call', date: '2020-03-31', investment: 30, fee: 0 },
        { id: 'call-2', kind: 'capital_call', date: '2020-12-31', investment: 25, fee: 0 },
        { id: 'call-3', kind: 'capital_call', date: '2021-09-30', investment: 25, fee: 0 },
        { id: 'call-4', kind: 'capital_call', date: '2022-06-30', investment: 15, fee: 0 },
        { id: 'dist-1', kind: 'distribution', date: '2023-06-30', amount: 20 },
        { id: 'dist-2', kind: 'distribution', date: '2024-12-31', amount: 45 },
        { id: 'dist-3', kind: 'distribution', date: '2026-06-30', amount: 60 },
        { id: 'dist-4', kind: 'distribution', date: '2027-12-31', amount: 50 },
      ],
      nav: { date: '2027-12-31', amount: 10 },
    },
  },
  {
    id: 'textbook-100',
    name: 'Textbook $100 fund',
    blurb: 'Hand-worked case A5: $100 in, $60 back after one year, $100 after two, 10% hurdle. LP IRR is exactly 30%.',
    input: {
      terms: { structure: 'european', hurdleRate: 0.1, compounding: 'annual', catchUpRate: 0, carryRate: 0.2 },
      partners: [{ id: 'LP', role: 'LP', commitment: 100 }],
      events: [
        { id: 'c1', kind: 'capital_call', date: '2025-01-01', investment: 100, fee: 0 },
        { id: 'd1', kind: 'distribution', date: '2026-01-01', amount: 60 },
        { id: 'd2', kind: 'distribution', date: '2027-01-01', amount: 100 },
      ],
    },
  },
];
