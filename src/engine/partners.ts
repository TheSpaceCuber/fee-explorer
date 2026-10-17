import { applyEvent, runPartner } from './carry/waterfall';
import { feeCalls, mergeFeeCalls, partnerFees } from './fees/managementFee';
import {
  TIERS,
  type CarryTerms,
  type Comparison,
  type ISODate,
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
    const run = runPartner(terms, p.id, events);

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
      clawback: 0,
    };
    return { result, liquidationRows, lastDate: events.at(-1)?.date };
  });

  const partners = runs.map((r) => r.result);
  const liquidationAllocations = input.nav ? aggregate([LIQUIDATION_ID], runs.map((r) => r.liquidationRows)) : null;

  // American: compare with European on the same flows, and claw back any excess carry.
  let comparison: Comparison | null = null;
  if (input.terms.structure === 'american') {
    const lastDates = runs.map((r) => r.lastDate).filter((d): d is ISODate => d !== undefined);
    const date = input.nav?.date ?? lastDates.reduce((a, b) => (a > b ? a : b), lastDates[0] ?? '1970-01-01');
    comparison = clawBack(input, partners, date);
  }

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
    comparison,
  };
}

/**
 * Clawback: at the end of the fund the GP must not have received more carry than a whole-of-fund
 * (European) calculation would have given it on the same cash flows. Per partner:
 *
 *     clawback = max(0, American carry − European carry)
 *
 * "Carry" here is carry paid plus accrued carry on any remaining NAV. With NAV left, the clawback is
 * what would be owed if the fund were sold at NAV today (an exposure, like accrued carry).
 * It's paid back to that partner on `date`, so it's added to the partner's cash flows. The result
 * is that the GP keeps min(American, European). Real clawbacks are often capped at carry net of
 * the GP's taxes; this model ignores taxes.
 */
function clawBack(input: FundInput, partners: PartnerResult[], date: ISODate): Comparison {
  const european = runFund({ ...input, terms: { ...input.terms, structure: 'european' } });
  const carryOf = (p: PartnerResult) => p.ledger.distributedGp + (p.liquidation?.steps.reduce((s, x) => s + x.gp, 0) ?? 0);
  let americanCarry = 0;
  let europeanCarry = 0;
  let clawback = 0;
  for (const p of partners) {
    const eu = european.partners.find((x) => x.partnerId === p.partnerId)!;
    const am = carryOf(p);
    const euCarry = carryOf(eu);
    americanCarry += am;
    europeanCarry += euCarry;
    p.clawback = Math.max(0, am - euCarry);
    clawback += p.clawback;
    if (p.clawback > 0) p.flows.push({ date, amount: p.clawback });
  }
  return { european, americanCarry, europeanCarry, clawback, date };
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
