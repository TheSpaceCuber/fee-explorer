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

---

# Milestone 3: management fees

## Conventions

- **Billing:** quarterly in advance, on `fees.start` + 0, 3, 6, … months. Each quarter is charged
  `rate / 4 × basis`. No pro-ration.
- **Period:** a quarter is charged at the period whose `[from, to)` contains its billing date.
  No period covers it → no fee.
- **Basis:** `commitment`, or `invested_capital` = investment called − cost of investments sold
  (`costRealized` on distributions), counting events dated on or before the billing date.
- **Funded by capital calls:** each fee becomes a capital call `{investment: 0, fee}` for that
  partner. On the same date, fee calls come before that day's other events.
- **Size discount:** `whole`: the full commitment gets the largest reduction whose threshold it
  meets. `marginal`: each slice of commitment above a threshold gets that band's reduction.
- **GP commitment:** role `GP`. It shares investment calls and distributions pro rata, pays no fees
  and no carry. Fund metrics (DPI, TVPI, net IRR) cover LP investors only.

F1–F5 use a **0% hurdle** so the fee mechanics are easy to see (everything above capital is split).
Carry 20%, no catch-up. Commitment 100 unless stated. Investment of 80 called on 2025-01-01.

## F1 — 2% on commitment for one year
Fees: 2025-01-01, 04-01, 07-01, 10-01 → 4 × (2%/4 × 100) = 4 × 0.5 = **2**. Paid-in = 82.
Distribution 120 on 2026-01-01: ROC 82, SPLIT 38 → GP 7.6, LP 30.4.
**LP 112.4, GP 7.6.**
Bridge: gross profit 120 − 80 = 40 → − fees 2 → − carry 7.6 → net 30.4 = 112.4 − 82. ✓

## F2 — step-down to invested capital
2% on commitment in 2025, then 1.5% on invested capital in 2026 (period ends 2027-01-01).
Distribution 50 on 2026-06-30 (cost sold 40) and 70 on 2027-01-01 (cost sold 40).

| Billing date | Period | Basis | Fee |
|---|---|---|---|
| 2025-01-01 … 2025-10-01 | 2% · commitment | 100 | 0.5 each → 2 |
| 2026-01-01 | 1.5% · invested | 80 | 0.3 |
| 2026-04-01 | 1.5% · invested | 80 | 0.3 |
| 2026-07-01 | 1.5% · invested | 80 − 40 = 40 | 0.15 |
| 2026-10-01 | 1.5% · invested | 40 | 0.15 |

Total fees **2.9**. Paid-in 82.9.
- d1 (50): capital outstanding 80 + 2 + 0.6 = 82.6 → ROC 50 → C = 32.6
- fees 0.15 + 0.15 → C = 32.9
- d2 (70): ROC 32.9, SPLIT 37.1 → GP 7.42, LP 29.68

**LP 112.58, GP 7.42.** Bridge: 40 − 2.9 − 7.42 = 29.68 = 112.58 − 82.9. ✓

## F3 — two LPs, size discount (whole commitment)
LP-A 60, LP-B 40. 2% on commitment in 2025. Band: commitment ≥ 50 → rate − 0.5%.
- LP-A: 1.5% → 0.225/quarter → fees 0.9. Investment 48. Paid-in 48.9.
  Its share of 120 = 72: ROC 48.9, SPLIT 23.1 → GP 4.62, LP 18.48 → **LP-A 67.38**
- LP-B: 2% → 0.2/quarter → fees 0.8. Investment 32. Paid-in 32.8.
  Its share = 48: ROC 32.8, SPLIT 15.2 → GP 3.04, LP 12.16 → **LP-B 44.96**

**Fund: LP 112.34, GP 7.66, fees 1.7.** The LPs are no longer pro rata. LP-A pays less fee, so
more of its money is "profit" and it pays more carry (4.62/60 > 3.04/40) but still ends better off.

## F4 — same, marginal bands
LP-A: first 50 at 2%, the last 10 at 1.5% → annual fee 1.00 + 0.15 = 1.15 → 0.2875/quarter
(blended rate 1.9167%). Paid-in 49.15. ROC 49.15, SPLIT 22.85 → GP 4.57, LP 18.28 → **LP-A 67.43**.
LP-B as F3. **Fund: LP 112.39, GP 7.61, fees 1.95.**

## F5 — GP commitment
LP 99 (2% on commitment), GP 1 (role GP: no fees, no carry). Investment 80 → LP 79.2, GP 0.8.
- LP: fees 4 × 0.495 = 1.98. Paid-in 81.18. Share of 120 = 118.8: ROC 81.18, SPLIT 37.62
  → carry 7.524, LP keeps 30.096 → **LP 111.276**
- GP commitment: put in 0.8, gets 1.2 back, all of it (no carry on its own money).

Fund allocations: ROC 81.98 (81.18 + 0.8), SPLIT LP 30.496 (30.096 + 0.4), carry 7.524.
Metrics are for LP investors only: paid-in 81.18, DPI 111.276 / 81.18.

## F6 — fees earn pref too (F1 with a 10% hurdle)
Contributions 80.5 on 2025-01-01, then 0.5 on 04-01, 07-01 and 10-01 (275, 184 and 92 days
before 2026-01-01). With annual compounding and no withdrawals in between:
H = 80.5 × 1.1 + 0.5 × (1.1^(275/365) + 1.1^(184/365) + 1.1^(92/365)) = 90.123992… → P = 8.123992…
ROC 82, PREF 8.123992, SPLIT 29.876008 → GP 5.975202, LP 23.900806.
**LP 114.024798…, GP 5.975202…** The fee dollars earn pref just like investment dollars.

## F7 — fees stop at the NAV date (regression)
F1's schedule, but no distribution: the fund is valued at NAV 85 on 2025-06-30.
Only the 2025-01-01 and 2025-04-01 fees are billed. 2025-07-01 is after the valuation date, so
it hasn't happened yet. Fees 1, paid-in 81.
Hypothetical sale of 85: ROC 81, SPLIT 4 → accrued carry 0.8, net NAV 84.2. TVPI = 84.2 / 81.
*Found by a property test:* before the fix, the 07-01 and 10-01 fee calls moved the ledger's
clock past the NAV date, and the liquidation accrued pref over a negative time span.

---

# Milestone 4: American (deal-by-deal) waterfall and clawback

## Conventions

- Investment calls and distributions carry a `dealId`. A **write-off** is a distribution of 0
  whose `costRealized` is the deal's cost.
- Each deal has its own hurdle account (capital + pref, accruing as usual). Fees sit in a separate
  fee account.
- When a distribution realizes cost K of deal d, the fraction K / (deal d's capital) of d's
  account moves into the **due** account. So does the fraction K / (all deals' capital) of the fee
  account. Then ROC → PREF → CATCHUP → SPLIT run against the due account, as before.
- `lossRecovery: 'realized'`: whatever is still due after a distribution stays due (losses on
  realized deals are recovered from later deals before carry). `'none'`: it's forgiven.
- **Clawback** = max(0, American carry − European carry on the same flows), per partner, at the end
  of the fund (last event, or the NAV date with a hypothetical sale). The GP pays it back to the
  LPs on that date, so the GP keeps min(American, European).

Unless stated: one LP, commitment 100, 0% hurdle, no catch-up, 20% carry, no fees.
Deal A: 50 called on 2025-01-01. Deal B: 50 called on 2025-01-01.

## H1 — winner first, then a write-off
A sold for 80 on 2026-01-01 (cost 50). B written off on 2027-01-01.
- d1: A's 50 becomes due. ROC 50, SPLIT 30 → **GP 6**, LP 24.
- d2: B's 50 becomes due, nothing comes in. The 50 stays due (realized loss recovery).
- European on the same flows: 100 in, 80 out → no profit → carry 0.
- **Clawback 6.** The GP gives back all its carry. The LP received 74 (ROC 50 + 24), plus the
  clawback of 6 = **80**, which is everything that came out.

## H2 — write-off first, then a winner (realized loss recovery)
B written off on 2026-01-01, A sold for 80 on 2027-01-01.
- d1: B's 50 becomes due, nothing paid. It stays due.
- d2: A's 50 is added → due 100. ROC 80. Nothing left for carry.
**GP 0, clawback 0.** The loss on B is recovered from A before any carry.

## H2N — same, pure deal-by-deal (no loss recovery)
- d1: B's 50 becomes due, nothing paid, then **forgiven**.
- d2: only A's 50 is due. ROC 50, SPLIT 30 → **GP 6**.
- European carry is 0 → **clawback 6.** Without the clawback, the GP would keep carry on a fund
  that lost money. This is why LPs insist on clawbacks under American waterfalls.

## H3 — profitable fund, carry paid early, part clawed back
A sold for 120 on 2026-01-01, B written off on 2027-01-01.
- American: d1 ROC 50, SPLIT 70 → **GP 14**, LP 56. d2: the 50 loss stays due.
- European: d1 due 100 → ROC 100, SPLIT 20 → GP 4.
- **Clawback 14 − 4 = 10.** The GP keeps 4, the same as European. LP: 106 in 2026 (ROC 50 + 56),
  then the clawback of 10 in 2027 (B's write-off pays nothing) = **116** = 120 − 4.

## H4 — American can pay the GP *less* than European (10% hurdle)
A sold for 80 on 2026-01-01, B sold for 70 on 2027-01-01.
- American, d1: A's account 50 × 1.1 = 55 → ROC 50, PREF 5, SPLIT 25 → GP 5, LP 20.
- American, d2: B's account has run 2 years: 50 × 1.21 = 60.5 → ROC 50, PREF 10.5, SPLIT 9.5 → GP 1.9.
  **American carry 6.9.**
- European, d1: H = 110 → ROC 80 → C = 20, P = 10. d2: H = 30 × 1.1 = 33 → ROC 20, PREF 13,
  SPLIT 37 → GP 7.4. **European carry 7.4.**
- **Clawback 0** (American ≤ European). The GP keeps 6.9.

Why? European returned 80 of capital in year 1, which stopped pref accruing on it. American only
returned A's 50; B's capital kept earning pref for a second year. Total pref: American 15.5,
European 13. More pref means less carry. "American is GP-friendly" is about **timing**: carry
arrives earlier. It isn't guaranteed to be more carry in total.

## H5 — fees allocated to deals by cost
F1's fees (2% on commitment in 2025, 0.5 a quarter). Deal A 40 and deal B 40 called on 2025-01-01.
A sold for 60 on 2025-07-01 (cost 40), B sold for 60 on 2026-01-01 (cost 40).
- d1 (07-01, after that day's fee call): fee account 1.5. A is 40 of 80 cost → half the fees, 0.75,
  become due with A's 40 → due 40.75. ROC 40.75, SPLIT 19.25 → GP 3.85, LP 15.4.
  (The LP's net cash that day is 56.15 received − 0.5 fee paid = 55.65.)
- 10-01 fee 0.5 → fee account 1.25.
- d2: B is the last 40 of 40 → all 1.25 → due 41.25. ROC 41.25, SPLIT 18.75 → GP 3.75, LP 15.
**LP 112.4, GP 7.6**, the same as European on these flows (F1). With a 0% hurdle and every
deal profitable, deal-by-deal and whole-fund agree.
