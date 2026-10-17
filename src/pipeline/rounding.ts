/**
 * Rounding to cents without losing a cent.
 *
 * The engine keeps full precision: a 50% catch-up on 10 of pref gives 3.3333… to each side. Money is
 * stored in cents, so every amount must be rounded. Rounding each one on its own can make the
 * rows of a distribution add up to one cent more or less than the cash that actually came in.
 * Then reconciliation reports break.
 *
 * The largest-remainder method fixes that:
 *   1. work in cents and round every amount DOWN,
 *   2. count how many cents are missing against the target (the distribution, rounded once),
 *   3. give one extra cent each to the amounts that lost the most in step 1.
 * Ties go to the earlier item, so the result is repeatable.
 *
 * Example (case B2: 150 split as ROC 100, PREF 10, catch-up 3.333/3.333, split 26.667/6.667):
 *   floors in cents: 10000, 1000, 333, 333, 2666, 666 → 14998, two cents short
 *   largest remainders: .667 (split LP) and .667 (split GP) → 2667 and 667
 *   stored: 100.00, 10.00, 3.33, 3.33, 26.67, 6.67 = 150.00 exactly
 */
export function allocateCents(amounts: number[], targetCents: number): number[] {
  const cents = amounts.map((a) => a * 100);
  const floors = cents.map((c) => Math.floor(c + 1e-9)); // tiny epsilon: 0.29 * 100 = 28.999999999999996
  let missing = targetCents - floors.reduce((s, c) => s + c, 0);

  const order = cents
    .map((c, i) => ({ i, remainder: c - floors[i]! }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);

  const result = [...floors];
  // Hand out missing cents one at a time to the largest remainders. (If the floors overshoot,
  // which can only happen through float noise, take cents back from the smallest remainders.)
  for (let k = 0; missing > 0 && order.length > 0; k = (k + 1) % order.length, missing--) result[order[k]!.i]! += 1;
  for (let k = order.length - 1; missing < 0 && k >= 0; k--) {
    const i = order[k]!.i;
    if (result[i]! > 0) {
      result[i]! -= 1;
      missing++;
    }
  }
  return result;
}

export const toCents = (amount: number) => Math.round(amount * 100);
export const fromCents = (cents: number) => cents / 100;
