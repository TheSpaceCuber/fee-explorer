import type { CarryTerms, FundEvent, FundInput, ISODate, Partner } from '../engine';
import type { Preset } from '../scenarios/presets';

/**
 * UI state. It's shaped for editing (calls and distributions as two separate lists), not for
 * the engine. `toFundInput` converts it into what the engine expects.
 */
export interface Flow {
  id: string;
  date: ISODate;
  amount: number;
}

export interface UiState {
  presetId: string;
  terms: CarryTerms;
  partners: Partner[];
  calls: Flow[];
  dists: Flow[];
  nav: Flow;
  /** Distribution shown in the step-through panel. */
  selectedDist: string | null;
  /** Current step in the step-through (0 = before the cash arrives). */
  step: number;
}

let counter = 0;
export const newId = (prefix: string) => `${prefix}-new-${++counter}`;

export function fromPreset(p: Preset): UiState {
  const { input } = p;
  return {
    presetId: p.id,
    terms: { ...input.terms },
    partners: input.partners.map((x) => ({ ...x })),
    calls: input.events
      .filter((e) => e.kind === 'capital_call')
      .map((e) => ({ id: e.id, date: e.date, amount: e.investment + e.fee })),
    dists: input.events
      .filter((e) => e.kind === 'distribution')
      .map((e) => ({ id: e.id, date: e.date, amount: e.amount })),
    nav: { id: 'nav', date: input.nav?.date ?? lastDate(input.events), amount: input.nav?.amount ?? 0 },
    selectedDist: null,
    step: 0,
  };
}

function lastDate(events: FundEvent[]): ISODate {
  return events.at(-1)?.date ?? '2030-01-01';
}

/**
 * Build the engine's input. The engine requires events in date order and leaves same-day order
 * to the caller, so the decision is made here: on the same day, calls go before distributions.
 * Cash has to come in before it can go out.
 */
export function toFundInput(s: UiState): FundInput {
  const events: FundEvent[] = [
    ...s.calls.map((c): FundEvent => ({ id: c.id, kind: 'capital_call', date: c.date, investment: c.amount, fee: 0 })),
    ...s.dists.map((d): FundEvent => ({ id: d.id, kind: 'distribution', date: d.date, amount: d.amount })),
  ];
  // Array.prototype.sort is stable, so calls (listed first) stay ahead of same-day distributions.
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return {
    terms: s.terms,
    partners: s.partners,
    events,
    ...(s.nav.amount > 0 ? { nav: { date: s.nav.date, amount: s.nav.amount } } : {}),
  };
}
