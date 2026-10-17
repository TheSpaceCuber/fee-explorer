import { applyEvent, runEuropean } from './carry/european';
import {
  TIERS,
  type FundAllocation,
  type FundEvent,
  type FundInput,
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
 * With identical terms both give the same answer (case A7 and a property test check this). From
 * M3, LPs can pay different management fees. Then they have contributed different amounts, their
 * hurdle accounts differ, and so does the carry they pay. Fund administrators handle this by
 * running the waterfall on each partner's own capital account.
 */
export function runFund(input: FundInput): WaterfallResult {
  assertValid(input);

  const total = input.partners.reduce((s, p) => s + p.commitment, 0);

  const runs = input.partners.map((p) => {
    const share = p.commitment / total;
    const events = input.events.map((e) => scaleEvent(e, share));
    const run = runEuropean(input.terms, p.id, events);

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
      const step = applyEvent(input.terms, p.id, run.ledger, pretend, 'liquidation');
      liquidation = step.trace;
      liquidationRows = step.allocations;
    }

    const result: PartnerResult = {
      partnerId: p.id,
      share,
      allocations: run.allocations,
      trace: run.trace,
      ledger: run.ledger,
      liquidation,
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
  };
}

/** A partner's slice of a fund-level event. */
function scaleEvent(e: FundEvent, share: number): FundEvent {
  return e.kind === 'capital_call'
    ? { ...e, investment: e.investment * share, fee: e.fee * share }
    : { ...e, amount: e.amount * share };
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
