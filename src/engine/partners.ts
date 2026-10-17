import { applyEvent, runEuropean } from './carry/european';
import { feeCalls, mergeFeeCalls, partnerFees } from './fees/managementFee';
import {
  TIERS,
  type CarryTerms,
  type DatedFlow,
  type FundAllocation,
  type FundEvent,
  type FundInput,
  type Partner,
  type PartnerResult,
  type TierAllocation,
  type WaterfallResult,
} from './types';
import { assertValid } from './validate';

/** Event id used for the pretend NAV distribution. The double underscores keep it apart from real ids. */
export const LIQUIDATION_ID = '__liquidation__';

/**
 * Run the waterfall for every partner, then add them up.
 *
 * Why per partner instead of running once at fund level and splitting pro rata?
 * Partners can pay different management fees (size discounts, side letters, the GP's own
 * commitment pays none). Then they have contributed different amounts, their hurdle accounts
 * differ, and so does the carry they pay. Fund administrators handle this by running the
 * waterfall on each partner's own capital account. Hand-worked cases F3–F5 show the divergence.
 *
 * Per partner:
 *   1. take its commitment share of every fund-level investment call and distribution,
 *   2. work out its quarterly management fees and turn them into extra capital calls,
 *   3. run the waterfall on the combined, date-ordered events,
 *   4. optionally run a hypothetical liquidation of its share of the NAV.
 */
export function runFund(input: FundInput): WaterfallResult {
  assertValid(input);

  const total = input.partners.reduce((s, p) => s + p.commitment, 0);

  const runs = input.partners.map((p) => {
    const share = p.commitment / total;
    const terms = termsFor(input.terms, p);
    const base = input.events.map((e) => scaleEvent(e, share));
    const fees = partnerFees(input.fees, p, base, input.nav?.date);
    const events = mergeFeeCalls(base, feeCalls(fees));
    const run = runEuropean(terms, p.id, events);

    /*
     * Hypothetical liquidation: "if the fund sold everything at NAV today, who would get what?"
     * We push the NAV through the same waterfall as a pretend distribution, starting from the
     * partner's final ledger. The GP's part is the "accrued carry": carry earned on paper but not
     * yet paid. LP statements report NAV net of it, so TVPI and IRR use the net figure.
     * The real ledger is left untouched.
     */
    let liquidation: PartnerResult['liquidation'] = null;
    let liquidationRows: TierAllocation[] = [];
    if (input.nav) {
      const pretend: FundEvent = { id: LIQUIDATION_ID, kind: 'distribution', date: input.nav.date, amount: input.nav.amount * share };
      const step = applyEvent(terms, p.id, run.ledger, pretend, 'liquidation');
      liquidation = step.trace;
      liquidationRows = step.allocations;
    }

    const result: PartnerResult = {
      partnerId: p.id,
      role: p.role,
      share,
      allocations: run.allocations,
      trace: run.trace,
      ledger: run.ledger,
      liquidation,
      fees,
      flows: partnerFlows(events, run.allocations),
    };
    return { result, liquidationRows };
  });

  const partners = runs.map((r) => r.result);
  const liquidationAllocations = input.nav ? aggregate([LIQUIDATION_ID], runs.map((r) => r.liquidationRows)) : null;

  return {
    partners,
    allocations: aggregate(
      input.events.filter((e) => e.kind === 'distribution').map((e) => e.id),
      partners.map((p) => p.allocations),
    ),
    liquidation: liquidationAllocations && {
      lp: liquidationAllocations.reduce((s, a) => s + a.lp, 0),
      gp: liquidationAllocations.reduce((s, a) => s + a.gp, 0),
      allocations: liquidationAllocations,
    },
    fees: partners.flatMap((p) => p.fees).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
  };
}

/**
 * The GP's own commitment pays no carry: it would be paying itself. Running the same waterfall
 * with carry and catch-up at 0 sends every dollar of it back to the GP-as-investor.
 */
function termsFor(terms: CarryTerms, p: Partner): CarryTerms {
  return p.role === 'GP' ? { ...terms, carryRate: 0, catchUpRate: 0 } : terms;
}

/** A partner's slice of a fund-level event. */
function scaleEvent(e: FundEvent, share: number): FundEvent {
  if (e.kind === 'capital_call') return { ...e, investment: e.investment * share, fee: e.fee * share };
  const scaled: FundEvent = { ...e, amount: e.amount * share };
  if (e.costRealized !== undefined) scaled.costRealized = e.costRealized * share;
  return scaled;
}

/** Calls negative (investment + fee), distributions positive (what the partner itself received). */
function partnerFlows(events: FundEvent[], allocations: TierAllocation[]): DatedFlow[] {
  return events.map((e) =>
    e.kind === 'capital_call'
      ? { date: e.date, amount: -(e.investment + e.fee) }
      : { date: e.date, amount: allocations.filter((a) => a.eventId === e.id).reduce((s, a) => s + a.lp, 0) },
  );
}

/** Sum partner allocations into one row per (event, tier), zero rows included. */
function aggregate(eventIds: string[], perPartner: TierAllocation[][]): FundAllocation[] {
  const rows: FundAllocation[] = [];
  for (const eventId of eventIds) {
    for (const tier of TIERS) {
      let lp = 0;
      let gp = 0;
      for (const allocations of perPartner) {
        for (const a of allocations) {
          if (a.eventId === eventId && a.tier === tier) {
            lp += a.lp;
            gp += a.gp;
          }
        }
      }
      rows.push({ eventId, tier, lp, gp });
    }
  }
  return rows;
}
