import { dayNumber, isValidDate } from './daycount';
import { COMPOUNDINGS, type FundInput } from './types';

/**
 * Term and input validation.
 *
 * In a real system this is the "validation and approval" stage: terms are checked before any
 * calculation is allowed to use them. Here it runs at the start of every run, and returns every
 * problem it finds rather than stopping at the first.
 */

export interface ValidationIssue {
  /** Dotted path to the bad field, e.g. "terms.carryRate" or "events[2].date". */
  field: string;
  message: string;
}

export class ValidationError extends Error {
  constructor(public readonly issues: ValidationIssue[]) {
    super(issues.map((i) => `${i.field}: ${i.message}`).join('; '));
    this.name = 'ValidationError';
  }
}

const isNonNegative = (x: number) => Number.isFinite(x) && x >= 0;

export function validate(input: FundInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (field: string, message: string) => issues.push({ field, message });
  const { terms, partners, events, nav } = input;

  // --- Terms ---
  if (terms.structure !== 'european') add('terms.structure', 'Only European is supported until M4.');
  if (!COMPOUNDINGS.includes(terms.compounding)) add('terms.compounding', `Must be one of: ${COMPOUNDINGS.join(', ')}.`);
  if (!isNonNegative(terms.hurdleRate)) add('terms.hurdleRate', 'Must be a number ≥ 0.');
  if (!(Number.isFinite(terms.carryRate) && terms.carryRate >= 0 && terms.carryRate < 1)) {
    add('terms.carryRate', 'Must be in [0, 1).');
  }
  // Catch-up: in that tier the GP takes k of each dollar while trying to reach c of ALL profit,
  // starting from 0%. If k ≤ c it can never get there, so the tier would never end.
  const k = terms.catchUpRate;
  if (!(Number.isFinite(k) && (k === 0 || (k > terms.carryRate && k <= 1)))) {
    add('terms.catchUpRate', `Must be 0 (no catch-up) or above the carry rate (${terms.carryRate}) and at most 1.`);
  }

  // --- Partners ---
  if (partners.length === 0) add('partners', 'At least one partner is required.');
  const ids = new Set<string>();
  partners.forEach((p, i) => {
    if (ids.has(p.id)) add(`partners[${i}].id`, `Duplicate partner id "${p.id}".`);
    ids.add(p.id);
    if (p.role !== 'LP') add(`partners[${i}].role`, 'Only LP partners are supported until M3.');
    if (!(Number.isFinite(p.commitment) && p.commitment > 0)) add(`partners[${i}].commitment`, 'Must be > 0.');
  });

  // --- Events ---
  // We require date order instead of sorting quietly. Same-day order matters (a call and a
  // distribution on one day), so the caller has to decide it explicitly.
  const eventIds = new Set<string>();
  let lastDay = -Infinity;
  // A distribution before any capital has been called would meet an empty hurdle account and
  // fall straight into the split, so the GP would earn carry on money no LP put in.
  let seenCall = false;
  events.forEach((e, i) => {
    const at = `events[${i}]`;
    if (eventIds.has(e.id)) add(`${at}.id`, `Duplicate event id "${e.id}".`);
    eventIds.add(e.id);
    if (!isValidDate(e.date)) {
      add(`${at}.date`, `Invalid date "${e.date}".`);
      return;
    }
    const day = dayNumber(e.date);
    if (day < lastDay) add(`${at}.date`, 'Events must be in date order.');
    lastDay = Math.max(lastDay, day);
    if (e.kind === 'capital_call') {
      seenCall = true;
      if (!isNonNegative(e.investment)) add(`${at}.investment`, 'Must be ≥ 0.');
      if (!isNonNegative(e.fee)) add(`${at}.fee`, 'Must be ≥ 0.');
    } else {
      if (!isNonNegative(e.amount)) add(`${at}.amount`, 'Must be ≥ 0.');
      if (!seenCall) add(`${at}.date`, 'A distribution cannot come before the first capital call.');
    }
  });

  // --- NAV ---
  if (nav) {
    if (!isValidDate(nav.date)) add('nav.date', `Invalid date "${nav.date}".`);
    else if (dayNumber(nav.date) < lastDay) add('nav.date', 'NAV date must be on or after the last event.');
    if (!isNonNegative(nav.amount)) add('nav.amount', 'Must be ≥ 0.');
  }

  return issues;
}

export function assertValid(input: FundInput): void {
  const issues = validate(input);
  if (issues.length > 0) throw new ValidationError(issues);
}
