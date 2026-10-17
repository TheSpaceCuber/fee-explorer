# Hand-worked cases

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

**Changed in M2.** TVPI and IRR now use the **net** NAV: the NAV minus the carry the GP would
earn if the fund sold everything at that value on the NAV date (a *hypothetical liquidation*).
Run 80 through the waterfall on 2026-01-01, starting from C = 50 and P = 10:

- ROC 50, PREF 10, SPLIT 20 → GP 4. **Accrued carry = 4**, so the net NAV is 76.

**DPI = 0.5, TVPI = (50 + 76)/100 = 1.26.** IRR = (50 + 76)/100 − 1 = **26%**.
(In M1 this case was gross: TVPI 1.3, IRR 30%.)

## A9 — part-year accrual
Contribute 100 on 2025-01-01. Distribute 150 on 2025-07-02, which is 182 days later.

- t = 182/365 = 0.498630…, growth = 1.1^t = 1.048671923 → P = 4.867192264
- ROC 100, PREF 4.867192264, SPLIT 45.132807736 → LP 36.106246189, GP 9.026561547

**LP 140.973438453, GP 9.026561547.** This checks day counting. A calculator was used, not
round numbers.

## A10 — validation: catch-up rate at or below the carry rate
**Changed in M2** (in M1 this case rejected any catch-up). `catchUpRate: 0.15` with
`carryRate: 0.20` must be **rejected**. The GP would take only 15% of each catch-up dollar while
trying to reach 20% of all profit, and it started at 0%, so it would never get there. Valid
values are 0 (no catch-up tier) or anything above the carry rate, up to 1.

## A11 — validation: distribution before any capital call
A distribution of 10 on 2024-06-30, then a call of 100 on 2025-01-01. This must be **rejected**.
With nothing contributed, C = P = 0, so the whole 10 would fall into the SPLIT tier and the GP
would earn 2 of carry on money no LP put in. This was found by trying it in the UI and added
here afterwards.

---

# Milestone 2

## The catch-up tier

After PREF, the GP has received 0% of the profit but is entitled to c = 20% of all of it.
The catch-up tier gives the GP a share k of each dollar until it has caught up:

```
Π = profit paid so far (PREF + CATCHUP + SPLIT, both LP and GP parts, including this distribution's PREF)
G = GP carry paid so far (CATCHUP GP + SPLIT GP)

The tier ends when  G + k·x = c·(Π + x)   →   x* = (c·Π − G) / (k − c)
Pay x = min(cash left, max(0, x*)).   GP gets k·x, LP gets (1 − k)·x.
```

That's why k must be greater than c: otherwise x* is infinite or negative.

All B cases use the A1 setup (100 in on 2025-01-01, 10% hurdle annual, 20% carry) unless stated.

## B1 — 100% catch-up, fully caught up
Distribution 150 on 2026-01-01.
- ROC 100, PREF 10 → Π = 10, G = 0
- x* = (0.2 × 10 − 0)/(1 − 0.2) = **2.5** → GP 2.5
- SPLIT 37.5 → LP 30, GP 7.5

**LP 140, GP 10.** The GP has 10 of the 50 profit = exactly 20%. Compare A1, where it had 8 (16%).

## B2 — 50% catch-up
- x* = 2/(0.5 − 0.2) = 6.6667 → GP 3.3333, LP 3.3333
- SPLIT 33.3333 → LP 26.6667, GP 6.6667

**LP 140, GP 10.** Same end point as B1. A slower catch-up only needs a longer zone.

## B3 — 80% catch-up (the ILPA model's bracketed figure)
- x* = 2/(0.8 − 0.2) = 3.3333 → GP 2.6667, LP 0.6667
- SPLIT 36.6667 → LP 29.3333, GP 7.3333

**LP 140, GP 10.**

## B4 — distribution ends inside the catch-up zone (100%)
Distribution 111.
- ROC 100, PREF 10, then 1 left. x* = 2.5 but only 1 is available → CATCHUP GP 1. No SPLIT.

**LP 110, GP 1.** The GP has 1/11 ≈ 9.1% of profit: "in the catch-up zone."

## B5 — catch-up resumes on the next distribution (100%)
As B4, plus a distribution of 20 on 2027-01-01.
- After B4: C = 0, P = 0, Π = 11, G = 1. Nothing accrues on a zero balance.
- ROC 0, PREF 0. x* = (0.2 × 11 − 1)/0.8 = **1.5** → GP 1.5. Now Π = 12.5, G = 2.5 (20%)
- SPLIT 18.5 → LP 14.8, GP 3.7

**LP 124.8, GP 6.2.** Profit is 31 and 6.2 is exactly 20% of it.

## B6 — the hurdle reopens after new capital (100%)
100 in on 2025-01-01, 150 out on 2026-01-01 (as B1), 50 more in on 2027-01-01, 70 out on 2028-01-01.
- After d1: LP 140, GP 10. Π = 50, G = 10. The hurdle account is empty.
- 2027-01-01: H stays 0, then the call adds 50 → C = 50
- 2028-01-01 (365 days): H = 55 → P = 5
- d2: ROC 50, PREF 5 → Π = 55. x* = (0.2 × 55 − 10)/0.8 = **1.25** → GP 1.25
- SPLIT 13.75 → LP 11, GP 2.75

**LP 206, GP 14.** Total profit = 220 out − 150 in = 70, and 14 is 20% of it. The new pref
pushed the GP below 20% again, so a little catch-up was needed.

## The compounding conventions

| Convention | Growth of the hurdle balance over t years | Notes |
|---|---|---|
| simple | only capital earns: P += C · r · t | unpaid pref does not earn pref |
| annual | H · (1 + r)^t | IRR-equivalent: H = 0 exactly when LP IRR = r |
| quarterly | H · (1 + r/4)^(4t) | effective annual rate (1 + r/4)⁴ − 1 |
| daily | H · (1 + r/365)^(365t) | effective annual rate (1 + r/365)³⁶⁵ − 1 |

## C1 — quarterly (A1 flows)
P = 100 × (1.025⁴ − 1) = 10.3812890625 → SPLIT 39.6187109375 → GP 7.9237421875.
**LP 142.0762578125, GP 7.9237421875.** More pref than A1's 10, so slightly less carry.

## C2 — simple (A5 flows: 100 in, 60 out after 1 year, 100 out after 2)
- Year 1: P = 100 × 0.1 = 10. ROC 60 → C = 40, P = 10 still owed.
- Year 2: P += 40 × 0.1 = 4 → **14** (A5 had 15: under simple, the unpaid 10 earns nothing)
- ROC 40, PREF 14, SPLIT 46 → LP 36.8, GP 9.2

**LP 150.8, GP 9.2.**

## C3 — daily (A1 flows)
P = 100 × ((1 + 0.1/365)³⁶⁵ − 1) = 10.515578161623… → SPLIT 39.484421838… → GP 7.896884368…
**LP 142.103115632…, GP 7.896884368…**

## C4 — simple, part year (A9 flows: 182 days)
P = 100 × 0.1 × 182/365 = 4.986301369863… (A9's compound version was 4.867…)
**LP 140.997260274…, GP 9.002739726…**

## Accrued carry on NAV (hypothetical liquidation)

## D1 — A8 with 100% catch-up
Run the NAV of 80 through the waterfall on 2026-01-01, from C = 50, P = 10, Π = 0, G = 0:
- ROC 50, PREF 10, CATCHUP 2.5 (GP), SPLIT 17.5 → GP 3.5
- **Accrued carry = 6**, net NAV = 74

**DPI 0.5, TVPI (50 + 74)/100 = 1.24, IRR 24%.**
