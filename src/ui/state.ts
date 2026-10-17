import { addMonths, type CarryTerms, type FeeBasis, type FeeClass, type FundEvent, type FundInput, type ISODate, type Partner } from '../engine';
import type { Preset } from '../scenarios/presets';

/**
 * UI state. It's shaped for editing (calls and distributions as two lists, fee terms as a few
 * sliders), not for the engine. `toFundInput` converts it into what the engine expects, and
 * `fromPreset` goes the other way.
 */
export interface Flow {
  id: string;
  date: ISODate;
  amount: number;
  /** Distributions only: cost of the investments sold (reduces invested capital). */
  cost?: number;
}

/** How a partner row is set up in the UI. Each maps to a role and a fee class. */
export type PartnerType = 'standard' | 'side_letter' | 'fee_free' | 'gp';
/** [type, long label for tables, short label for the narrow inputs panel] */
export const PARTNER_TYPES: [PartnerType, string, string][] = [
  ['standard', 'Standard fees', 'Standard'],
  ['side_letter', 'Side letter (reduced fee)', 'Side letter'],
  ['fee_free', 'Fee-free LP', 'Fee-free'],
  ['gp', 'GP commitment', 'GP commit'],
];

export interface UiPartner {
  id: string;
  commitment: number;
  type: PartnerType;
}

/** The fee schedule, as the inputs panel presents it. */
export interface FeeUi {
  enabled: boolean;
  /** First billing date (usually the first close). */
  start: ISODate;
  /** End of the investment period: the rate and basis change here. */
  ipEnd: ISODate;
  /** Last date fees are charged (exclusive). */
  end: ISODate;
  ipRate: number;
  postRate: number;
  postBasis: FeeBasis;
  /** Rate cut for side-letter LPs, e.g. 0.005 = 0.5% off. */
  sideLetterCut: number;
  discountMode: 'none' | 'whole' | 'marginal';
  discountMin: number;
  discountCut: number;
}

export interface UiState {
  presetId: string;
  terms: CarryTerms;
  partners: UiPartner[];
  calls: Flow[];
  dists: Flow[];
  nav: Flow;
  fees: FeeUi;
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
    partners: input.partners.map((x) => ({ id: x.id, commitment: x.commitment, type: partnerType(x) })),
    calls: input.events
      .filter((e) => e.kind === 'capital_call')
      .map((e) => ({ id: e.id, date: e.date, amount: e.investment + e.fee })),
    dists: input.events
      .filter((e) => e.kind === 'distribution')
      .map((e) => ({ id: e.id, date: e.date, amount: e.amount, cost: e.costRealized ?? 0 })),
    nav: { id: 'nav', date: input.nav?.date ?? lastDate(input.events), amount: input.nav?.amount ?? 0 },
    fees: feeUiFrom(input),
    selectedDist: null,
    step: 0,
  };
}

function partnerType(p: Partner): PartnerType {
  if (p.role === 'GP') return 'gp';
  if (p.feeClassId === 'side_letter') return 'side_letter';
  if (p.feeClassId === undefined) return 'fee_free';
  return 'standard';
}

/** Read the slider values back out of a preset's fee terms (or sensible defaults with fees off). */
function feeUiFrom(input: FundInput): FeeUi {
  const firstDate = input.events[0]?.date ?? '2020-01-01';
  const start = input.fees?.start ?? `${firstDate.slice(0, 4)}-01-01`;
  const std = input.fees?.classes.standard;
  const side = input.fees?.classes.side_letter;
  const [ip, post] = std?.periods ?? [];
  const band = std?.sizeDiscount?.bands[0];
  return {
    enabled: Boolean(input.fees),
    start,
    ipEnd: ip?.to ?? addMonths(start, 60),
    end: post?.to ?? ip?.to ?? addMonths(start, 120),
    ipRate: ip?.rate ?? 0.02,
    postRate: post?.rate ?? 0.015,
    postBasis: post?.basis ?? 'invested_capital',
    sideLetterCut: ip && side?.periods[0] ? ip.rate - side.periods[0].rate : 0.005,
    discountMode: std?.sizeDiscount?.mode ?? 'none',
    discountMin: band?.minCommitment ?? 40,
    discountCut: band?.rateReduction ?? 0.0025,
  };
}

function lastDate(events: FundEvent[]): ISODate {
  return events.at(-1)?.date ?? '2030-01-01';
}

/** Build the engine's fee classes from the sliders. */
function feeClasses(f: FeeUi): Record<string, FeeClass> {
  const schedule = (cut: number): FeeClass => {
    const periods: FeeClass['periods'] = [{ from: f.start, to: f.ipEnd, rate: Math.max(0, f.ipRate - cut), basis: 'commitment' }];
    if (f.end > f.ipEnd) periods.push({ from: f.ipEnd, to: f.end, rate: Math.max(0, f.postRate - cut), basis: f.postBasis });
    return f.discountMode === 'none'
      ? { periods }
      : { periods, sizeDiscount: { mode: f.discountMode, bands: [{ minCommitment: f.discountMin, rateReduction: f.discountCut }] } };
  };
  return { standard: schedule(0), side_letter: schedule(f.sideLetterCut) };
}

/**
 * Build the engine's input. The engine requires events in date order and leaves same-day order
 * to the caller, so the decision is made here: on the same day, calls go before distributions.
 * Cash has to come in before it can go out.
 */
export function toFundInput(s: UiState): FundInput {
  const events: FundEvent[] = [
    ...s.calls.map((c): FundEvent => ({ id: c.id, kind: 'capital_call', date: c.date, investment: c.amount, fee: 0 })),
    ...s.dists.map((d): FundEvent => ({ id: d.id, kind: 'distribution', date: d.date, amount: d.amount, costRealized: d.cost ?? 0 })),
  ];
  // Array.prototype.sort is stable, so calls (listed first) stay ahead of same-day distributions.
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const partners: Partner[] = s.partners.map((p) => {
    if (p.type === 'gp') return { id: p.id, role: 'GP', commitment: p.commitment };
    if (p.type === 'fee_free' || !s.fees.enabled) return { id: p.id, role: 'LP', commitment: p.commitment };
    return { id: p.id, role: 'LP', commitment: p.commitment, feeClassId: p.type };
  });

  return {
    terms: s.terms,
    partners,
    events,
    ...(s.nav.amount > 0 ? { nav: { date: s.nav.date, amount: s.nav.amount } } : {}),
    ...(s.fees.enabled ? { fees: { start: s.fees.start, classes: feeClasses(s.fees) } } : {}),
  };
}
