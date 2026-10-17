import type { ISODate } from './types';

const MS_PER_DAY = 86_400_000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Days since 1970-01-01 for an ISO date.
 *
 * We use Date.UTC so there are no time zones or daylight-saving jumps. `new Date('2025-03-30')`
 * in local time can be 23 or 25 hours from the previous day, which would break day counts.
 */
export function dayNumber(date: ISODate): number {
  const m = ISO_RE.exec(date);
  if (!m) throw new Error(`Invalid ISO date: ${date}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  // Date.UTC quietly rolls 2025-02-30 over to 2025-03-02. Checking the round trip catches that.
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    throw new Error(`Invalid calendar date: ${date}`);
  }
  return ms / MS_PER_DAY;
}

export function isValidDate(date: ISODate): boolean {
  try {
    dayNumber(date);
    return true;
  } catch {
    return false;
  }
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return dayNumber(to) - dayNumber(from);
}

/**
 * Year fraction under ACT/365F ("actual over 365, fixed"): actual days divided by 365, even in
 * leap years. It's the most common convention for hurdle accrual and it's what Excel's XIRR
 * uses, so the hurdle and the IRR measure time the same way.
 */
export function yearFraction(from: ISODate, to: ISODate): number {
  return daysBetween(from, to) / 365;
}

/**
 * Add calendar months, clamping to the month end: 2025-01-31 + 1 month = 2025-02-28.
 * Fee billing dates are always computed from the start date (start + 3k months), never by chaining
 * (date + 3 months, + 3 more, ...). Chaining would drift: Jan 31 → Apr 30 → Jul 30.
 */
export function addMonths(date: ISODate, months: number): ISODate {
  dayNumber(date); // validates
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total % 12; // 0-based
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const nd = Math.min(d, lastDay);
  return `${String(ny).padStart(4, '0')}-${String(nm + 1).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}
