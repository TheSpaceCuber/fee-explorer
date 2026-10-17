import { yearFraction } from '../daycount';
import type { AccrualNote, CarryTerms, Compounding, ISODate, PartnerLedger, SubAccount } from '../types';

/**
 * Bring the hurdle account up to `date`.
 *
 * Think of a savings account in the LP's name that pays the hurdle rate. Capital calls are
 * deposits, and the ROC and PREF tiers are withdrawals. Its balance is
 *
 *     H = capitalOutstanding + prefAccrued
 *
 * Capital only changes on calls and ROC payments, so all the growth lands in prefAccrued.
 * How it grows depends on the compounding convention:
 *
 *   simple     prefAccrued += capital · r · t        only capital earns; unpaid pref doesn't
 *   annual     H · (1 + r)^t                         interest on interest
 *   quarterly  H · (1 + r/4)^(4t)                    compounds 4×/year: effective rate (1 + r/4)⁴ − 1
 *   daily      H · (1 + r/365)^(365t)                effective rate (1 + r/365)³⁶⁵ − 1
 *
 * Why use the fractional exponent instead of compounding only on anniversaries? Because with
 * annual compounding, H reaches zero at exactly the moment the LP's IRR equals r. "The LP has
 * cleared the hurdle" and "the LP has earned r a year" become the same statement (case A4).
 * Quarterly and daily keep that property, but at their higher effective annual rate.
 */
export function accrue(
  ledger: PartnerLedger,
  date: ISODate,
  terms: CarryTerms,
): { ledger: PartnerLedger; note: AccrualNote } {
  const capital = ledger.capitalOutstanding;
  const prefBefore = ledger.prefAccrued;

  // First event: nothing to accrue yet, just start the clock.
  const years = ledger.asOf === null ? 0 : yearFraction(ledger.asOf, date);
  // Time must never run backwards. Validation should prevent it, so failing loudly here turns a
  // missed check into an obvious error instead of a quietly wrong (negative) pref.
  if (years < 0) throw new Error(`Hurdle accrual went backwards: ${ledger.asOf} → ${date}`);
  const prefAfter = years === 0 ? prefBefore : grow(capital, prefBefore, terms.hurdleRate, years, terms.compounding);

  const next: PartnerLedger = { ...ledger, asOf: date, prefAccrued: prefAfter };
  // American: every deal's account and the fee account accrue the same way, on the same clock.
  if (years > 0 && ledger.deals) {
    next.deals = Object.fromEntries(
      Object.entries(ledger.deals).map(([id, a]) => [id, growAccount(a, terms, years)]),
    );
  }
  if (years > 0 && ledger.feeAccount) next.feeAccount = growAccount(ledger.feeAccount, terms, years);

  return {
    ledger: next,
    note: { years, compounding: terms.compounding, capital, prefBefore, prefAfter },
  };
}

function growAccount(a: SubAccount, terms: CarryTerms, years: number): SubAccount {
  return { capital: a.capital, pref: grow(a.capital, a.pref, terms.hurdleRate, years, terms.compounding) };
}

/** New prefAccrued after `t` years. Exported for tests and the docs. */
export function grow(capital: number, pref: number, r: number, t: number, compounding: Compounding): number {
  if (compounding === 'simple') return pref + capital * r * t;
  const factor = growthFactor(r, t, compounding);
  return (capital + pref) * factor - capital;
}

function growthFactor(r: number, t: number, compounding: Exclude<Compounding, 'simple'>): number {
  switch (compounding) {
    case 'annual':
      return Math.pow(1 + r, t);
    case 'quarterly':
      return Math.pow(1 + r / 4, 4 * t);
    case 'daily':
      return Math.pow(1 + r / 365, 365 * t);
  }
}
