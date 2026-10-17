import type { CarryTerms, EventTrace, FundEvent, PartnerLedger, RealizationNote, SubAccount } from '../types';
import { distribute, type StepResult } from './european';
import { accrue } from './hurdle';

/**
 * American (deal-by-deal) waterfall for one partner.
 *
 * In a European waterfall, ALL contributed capital (+ pref) is due before any carry. In an
 * American one, only the capital of deals that have been sold is due. So the GP can earn carry on
 * an early winner while other deals are still held, or have quietly lost money.
 *
 * How the engine models it:
 *   - every deal has its own hurdle account (capital + pref), and so do the fees;
 *   - the ledger's capitalOutstanding / prefAccrued become the "due" account;
 *   - when a distribution sells cost K of deal d, the fraction K / (d's capital) of d's account
 *     moves into "due", and so does the fraction K / (all deals' capital) of the fee account,
 *     so fees are shared across deals by cost;
 *   - then the same tiers as European run against "due" (see european.ts `distribute`);
 *   - lossRecovery 'realized': anything still due stays due, so a written-off deal must be
 *     recovered from later winners before carry. 'none': it's forgiven (pure deal-by-deal).
 *
 * Because it can pay carry that the whole fund never earns, an American waterfall needs a
 * clawback at the end (see partners.ts).
 */

/** Move `fraction` of a sub-account out. Returns [moved, left]. */
function take(a: SubAccount, fraction: number): [SubAccount, SubAccount] {
  const f = Math.max(0, Math.min(1, fraction));
  // Taking everything returns exact zeros, so a fully sold deal doesn't leave floating-point dust.
  if (f === 1) return [a, { capital: 0, pref: 0 }];
  const moved = { capital: a.capital * f, pref: a.pref * f };
  return [moved, { capital: a.capital - moved.capital, pref: a.pref - moved.pref }];
}

export function applyAmerican(
  terms: CarryTerms,
  partnerId: string,
  before: PartnerLedger,
  event: FundEvent,
  kind: EventTrace['kind'] = event.kind,
): StepResult {
  const accrued = accrue(before, event.date, terms);
  let ledger: PartnerLedger = {
    ...accrued.ledger,
    deals: { ...(accrued.ledger.deals ?? {}) },
    feeAccount: accrued.ledger.feeAccount ?? { capital: 0, pref: 0 },
  };
  const deals = ledger.deals!;

  // --- Capital call: money goes into the deal's own account (or the fee account), not "due" yet.
  if (event.kind === 'capital_call') {
    if (event.investment > 0) {
      const id = event.dealId ?? 'unassigned';
      const d = deals[id] ?? { capital: 0, pref: 0 };
      deals[id] = { capital: d.capital + event.investment, pref: d.pref };
    }
    if (event.fee > 0) ledger.feeAccount = { capital: ledger.feeAccount!.capital + event.fee, pref: ledger.feeAccount!.pref };
    ledger.contributed += event.investment + event.fee;
    return {
      ledger,
      allocations: [],
      trace: { eventId: event.id, date: event.date, kind, amount: event.investment + event.fee, accrual: accrued.note, steps: [], ledgerAfter: ledger },
    };
  }

  // --- Distribution: realize cost, move it into "due", then run the tiers.
  const carriedCapital = ledger.capitalOutstanding;
  const carriedPref = ledger.prefAccrued;
  const totalDealCapital = Object.values(deals).reduce((s, d) => s + d.capital, 0);
  let dealMoved: SubAccount = { capital: 0, pref: 0 };
  let feeMoved: SubAccount = { capital: 0, pref: 0 };
  let costRealized = 0;

  if (kind === 'liquidation') {
    // Hypothetical sale of everything: every deal and all fees become due.
    for (const id of Object.keys(deals)) {
      dealMoved = add(dealMoved, deals[id]!);
      deals[id] = { capital: 0, pref: 0 };
    }
    costRealized = totalDealCapital;
    [feeMoved, ledger.feeAccount] = take(ledger.feeAccount!, 1);
  } else if (event.dealId !== undefined && deals[event.dealId]) {
    const deal = deals[event.dealId]!;
    costRealized = event.costRealized ?? 0;
    const dealFraction = deal.capital > 0 ? costRealized / deal.capital : 0;
    const feeFraction = totalDealCapital > 0 ? costRealized / totalDealCapital : 0;
    [dealMoved, deals[event.dealId]] = take(deal, dealFraction);
    [feeMoved, ledger.feeAccount] = take(ledger.feeAccount!, feeFraction);
  }

  ledger.capitalOutstanding += dealMoved.capital + feeMoved.capital;
  ledger.prefAccrued += dealMoved.pref + feeMoved.pref;

  const step = distribute(terms, partnerId, ledger, event, kind, accrued.note);

  // Pure deal-by-deal: whatever this distribution couldn't pay is forgiven for carry purposes.
  let forgiven = 0;
  if ((terms.lossRecovery ?? 'realized') === 'none' && kind !== 'liquidation') {
    forgiven = step.ledger.capitalOutstanding + step.ledger.prefAccrued;
    step.ledger = { ...step.ledger, capitalOutstanding: 0, prefAccrued: 0 };
    step.trace.ledgerAfter = step.ledger;
  }

  const realization: RealizationNote = {
    dealId: kind === 'liquidation' ? null : (event.kind === 'distribution' ? event.dealId ?? null : null),
    costRealized,
    carriedCapital,
    carriedPref,
    dealCapital: dealMoved.capital,
    dealPref: dealMoved.pref,
    feeCapital: feeMoved.capital,
    feePref: feeMoved.pref,
    forgiven,
  };
  step.trace.realization = realization;
  return step;
}

const add = (a: SubAccount, b: SubAccount): SubAccount => ({ capital: a.capital + b.capital, pref: a.pref + b.pref });
