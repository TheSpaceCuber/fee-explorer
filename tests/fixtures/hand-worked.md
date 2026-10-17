# Hand-worked cases: Milestone 1 (European, no catch-up)

These were worked out by hand **before** the engine was written. `hand-worked.json` holds the same
numbers in machine-readable form. Both the TS tests and a future Python engine run against that file.

## Common terms

| Term | Value |
|---|---|
| Structure | European (whole of fund) |
| Hurdle rate | 10% per year |
| Compounding | annual, IRR-equivalent: `growth = (1 + r)^t`, `t = days / 365` |
| Catch-up | none (0%) |
| Carry rate | 20% |

The dates are 1 January in 2025, 2026 and 2027. Each gap is 365 days, so `t` is exactly 1.0.

## How one distribution is split

The engine keeps two numbers per partner:

- **C**, capital outstanding: what the LP has put in and not yet received back.
- **P**, pref accrued: hurdle return earned but not yet paid.

The **hurdle account** is H = C + P. Between events it grows at the hurdle rate:
`H_new = H × (1 + r)^t`, so `P_new = H_new − C`.

When a distribution D arrives, it is paid out in tiers, in order:

1. **ROC** (return of capital) = min(D, C). The LP gets it all. C falls.
2. **PREF** (preferred return) = min(what's left, P). The LP gets it all. P falls.
3. **SPLIT** = whatever is left. LP 80%, GP 20% (carry).

---

## A1 — one contribution, one distribution, above the hurdle
Contribute 100 on 2025-01-01. Distribute 150 on 2026-01-01.

- Accrue: H = 100 × 1.1 = 110 → P = 10
- ROC 100 → C = 0, 50 left
- PREF 10 → P = 0, 40 left
- SPLIT 40 → LP 32, GP 8

**LP 142, GP 8.** LP IRR = 142/100 − 1 = **42%**. DPI = TVPI = 1.42.

## A2 — distribution below capital
Same as A1, but the distribution is 80.

- ROC 80 → C = 20. Nothing reaches PREF.

**LP 80, GP 0.** After the event: C = 20 and P = 10 are still owed. IRR = **−20%**.

## A3 — distribution covers capital and part of the pref
The distribution is 105.

- ROC 100, PREF 5, so P = 5 is still owed. No SPLIT.

**LP 105, GP 0.** IRR = **5%**.

## A4 — distribution lands exactly on the hurdle
The distribution is 110.

- ROC 100, PREF 10, SPLIT 0.

**LP 110, GP 0.** IRR = **10%**, exactly the hurdle rate. This is the point of the
IRR-equivalent convention: clearing the hurdle means the LP has earned exactly r.

## A5 — two distributions, unpaid pref carries forward
Contribute 100 on 2025-01-01. Distribute 60 on 2026-01-01 and 100 on 2027-01-01.

Distribution 1 (60):
- Accrue: H = 110 → P = 10
- ROC 60 → C = 40. Nothing left for PREF, so P = 10 is still owed.

Distribution 2 (100):
- Accrue: H = (40 + 10) × 1.1 = 55 → P = 55 − 40 = **15**. The unpaid 10 earned interest too.
- ROC 40, PREF 15, SPLIT 45 → LP 36, GP 9

**LP 60 + 91 = 151, GP 9.** Check: 151 + 9 = 160 = total distributed.
LP IRR: −100, +60 after 1 year, +91 after 2 years. Solve 91v² + 60v − 100 = 0 with v = 1/(1+x):
v = (−60 + √40 000)/182 = 140/182, so 1 + x = 1.3 → **30%**.

## A6 — two contributions
Contribute 50 on 2025-01-01 and 50 on 2026-01-01. Distribute 165 on 2027-01-01.

- 2026-01-01: H = 50 × 1.1 = 55 (P = 5). The second contribution adds 50 → C = 100, H = 105
- 2027-01-01: H = 105 × 1.1 = 115.5 → P = 15.5
- ROC 100, PREF 15.5, SPLIT 49.5 → LP 39.6, GP 9.9

**LP 155.1, GP 9.9.** IRR from the Python oracle.

## A7 — two LPs (A1 flows, commitments 60 / 40)
Each LP gets a share of every flow in proportion to its commitment, and runs its own waterfall:

| | ROC | PREF | SPLIT LP | SPLIT GP | LP total |
|---|---|---|---|---|---|
| LP-A (60%) | 60 | 6 | 19.2 | 4.8 | 85.2 |
| LP-B (40%) | 40 | 4 | 12.8 | 3.2 | 56.8 |
| Fund | 100 | 10 | 32 | 8 | 142 |

The fund row equals A1. With identical terms, splitting the fund result pro rata gives the same
answer. From M3, LPs with different fee rates will make these diverge.

## A8 — remaining NAV
Contribute 100 on 2025-01-01. Distribute 50 on 2026-01-01. NAV is 80 on 2026-01-01.

- ROC 50. The LP is still owed C = 50 and P = 10.

**DPI = 0.5, TVPI = (50 + 80)/100 = 1.3.** IRR treats the NAV as if it were paid out on the
as-of date: (50 + 80)/100 − 1 = **30%**. In M1 the NAV is gross. M2 deducts the carry the GP
would earn if that NAV were realised (hypothetical liquidation).

## A9 — part-year accrual
Contribute 100 on 2025-01-01. Distribute 150 on 2025-07-02, which is 182 days later.

- t = 182/365 = 0.498630…, growth = 1.1^t = 1.048671923 → P = 4.867192264
- ROC 100, PREF 4.867192264, SPLIT 45.132807736 → LP 36.106246189, GP 9.026561547

**LP 140.973438453, GP 9.026561547.** This checks day counting. A calculator was used, not
round numbers.

## A10 — validation: catch-up not available yet
Terms with `catchUpRate: 1` must be **rejected** in M1 with a clear error. Catch-up arrives in M2.

## A11 — validation: distribution before any capital call
A distribution of 10 on 2024-06-30, then a call of 100 on 2025-01-01. This must be **rejected**.
With nothing contributed, C = P = 0, so the whole 10 would fall into the SPLIT tier and the GP
would earn 2 of carry on money no LP put in. This was found by trying it in the UI and added
here afterwards.
