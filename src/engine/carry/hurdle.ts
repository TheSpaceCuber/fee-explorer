import { yearFraction } from '../daycount';
import type { CarryTerms, ISODate, PartnerLedger } from '../types';

/**
 * Bring the hurdle account up to `date`.
 *
 * Think of a savings account in the LP's name that pays the hurdle rate. Capital calls are
 * deposits, and the ROC and PREF tiers are withdrawals. Its balance is
 *
 *     H = capitalOutstanding + prefAccrued
 *
 * With annual compounding, the whole balance grows (interest earns interest):
 *
 *     H(t) = H(0) · (1 + r)^t,   t in years (ACT/365F)
 *
 * Capital only changes on calls and ROC payments, so all the growth lands in prefAccrued:
 *
 *     prefAccrued_new = H(t) − capitalOutstanding
 *
 * Why use the fractional exponent (1 + r)^t instead of compounding only on anniversaries? Because
 * then H reaches zero at exactly the moment the LP's IRR equals r. "The LP has cleared the hurdle"
 * and "the LP has earned r a year" become the same statement, which hand-worked case A4 checks.
 */
export function accrue(ledger: PartnerLedger, date: ISODate, terms: CarryTerms): PartnerLedger {
  // First event: nothing to accrue yet, just start the clock.
  if (ledger.asOf === null) return { ...ledger, asOf: date };

  const t = yearFraction(ledger.asOf, date);
  const balance = ledger.capitalOutstanding + ledger.prefAccrued;
  const grown = balance * Math.pow(1 + terms.hurdleRate, t);
  return {
    ...ledger,
    asOf: date,
    prefAccrued: grown - ledger.capitalOutstanding,
  };
}
