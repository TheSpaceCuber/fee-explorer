import { runEuropean } from './carry/european';
import { TIERS, type FundEvent, type FundInput, type PartnerResult, type WaterfallResult } from './types';
import { assertValid } from './validate';

/**
 * Run the waterfall for every partner, then add them up.
 *
 * Why per partner instead of running once at fund level and splitting pro rata?
 * In M1 every LP has the same terms, so both give the same answer (case A7 checks this). From M3,
 * LPs can pay different management fees. Then they have contributed different amounts, their
 * hurdle accounts differ, and so does the carry they pay. Fund administrators handle this by
 * running the waterfall on each partner's own capital account. Starting that way now means M3
 * doesn't need a redesign.
 */
export function runFund(input: FundInput): WaterfallResult {
  assertValid(input);

  const total = input.partners.reduce((s, p) => s + p.commitment, 0);

  const partners: PartnerResult[] = input.partners.map((p) => {
    const share = p.commitment / total;
    const events = input.events.map((e) => scaleEvent(e, share));
    const run = runEuropean(input.terms, p.id, events);
    return { partnerId: p.id, share, allocations: run.allocations, trace: run.trace, ledger: run.ledger };
  });

  return { partners, allocations: aggregate(input.events, partners) };
}

/** A partner's slice of a fund-level event. */
function scaleEvent(e: FundEvent, share: number): FundEvent {
  return e.kind === 'capital_call'
    ? { ...e, investment: e.investment * share, fee: e.fee * share }
    : { ...e, amount: e.amount * share };
}

/** Sum partner allocations into one row per (distribution, tier), zero rows included. */
function aggregate(events: FundEvent[], partners: PartnerResult[]): WaterfallResult['allocations'] {
  const rows: WaterfallResult['allocations'] = [];
  for (const e of events) {
    if (e.kind !== 'distribution') continue;
    for (const tier of TIERS) {
      let lp = 0;
      let gp = 0;
      for (const p of partners) {
        for (const a of p.allocations) {
          if (a.eventId === e.id && a.tier === tier) {
            lp += a.lp;
            gp += a.gp;
          }
        }
      }
      rows.push({ eventId: e.id, tier, lp, gp });
    }
  }
  return rows;
}
