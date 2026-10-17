# Concepts

A plain-English glossary that grows each milestone. Each entry says what the term means, how
it shows up in a real fund, and the formula the engine uses. The formulas are written so this
file can serve as the spec for a reimplementation (e.g. a Python engine).

---

## The players

- **LP (limited partner):** an investor in the fund, such as a pension, insurer, endowment or family office.
  LPs provide almost all the capital and have no say in day-to-day decisions.
- **GP (general partner):** the manager. It picks the investments and earns fees and carry.
- **Commitment:** the amount an LP promises to provide over the fund's life. It isn't paid on day
  one. The GP calls it as needed.

## Cash flows

- **Capital call (drawdown):** the GP asks LPs for part of their commitment, each in proportion
  to what they committed. A call pays for investments and (from M3) management fees. Both count
  as **contributed capital**.
- **Distribution:** cash going back to LPs, usually after an investment is sold. The
  **distribution waterfall** decides how much of it the GP keeps as carry.
- **NAV (net asset value):** the estimated value of what the fund still holds. It's an
  estimate, not cash.

## The European waterfall (M1)

"European" (also "whole-of-fund") means the GP earns carry only after the LPs have got back
**all** their contributed capital plus the hurdle on it, across the whole fund. The alternative,
"American" (deal-by-deal, M4), works out carry per deal.

Each distribution is paid out through tiers, in order. Each tier takes what it's owed and
passes the rest down:

| # | Tier | Who gets it | How much |
|---|---|---|---|
| 1 | Return of capital (ROC) | LP | up to the capital still outstanding |
| 2 | Preferred return (PREF) | LP | up to the hurdle accrued and still unpaid |
| 3 | Catch-up (M2) | mostly GP | until the GP has its carry share of all profit |
| 4 | Profit split | LP (1 − c) / GP c | everything left, c = carry rate (e.g. 20%) |

### The hurdle account (how pref accrues)

Think of a **savings account in the LP's name** that pays the hurdle rate r.

- Every capital call is a **deposit**.
- Every ROC or PREF payment is a **withdrawal**.
- With **compound** interest, the balance earns interest on its interest, including on any pref
  that is owed but unpaid.

The engine stores the balance as two parts:

```
H = capitalOutstanding + prefAccrued

between events:   H_new = H × (1 + r)^t          t = days / 365 (ACT/365F)
                  prefAccrued_new = H_new − capitalOutstanding
capital call A:   capitalOutstanding += A
distribution D:   ROC  = min(D, capitalOutstanding)
                  PREF = min(D − ROC, prefAccrued)
                  SPLIT = D − ROC − PREF  →  GP: c × SPLIT,  LP: SPLIT − GP
```

**Why this convention?** H reaches zero at exactly the moment the LP's IRR (counting only the
ROC and PREF payments) equals r. So "cleared the hurdle" and "earned r a year" mean the same
thing. Hand-worked case A4 checks this: $100 in, $110 back one year later at a 10% hurdle →
ROC 100, PREF 10, nothing left to split, IRR exactly 10%.

**Compound vs simple, in one example.** $100 for 2 years at 8%, nothing paid in between:
- compound: 100 × 1.08² = 116.64 → pref owed 16.64
- simple: 100 × (1 + 0.08 × 2) = 116.00 → pref owed 16.00

Compound is more LP-friendly. M2 adds simple and other conventions as options.

**Unpaid pref compounds.** Hand-worked case A5: after one year the LP gets 60 of its 100
back, so it is still owed 40 of capital and 10 of pref. In year two the 10% hurdle accrues on
all 50, so the pref owed becomes 15, not 14.

### What carry looks like without catch-up

With no catch-up, the GP gets 20% of profit **above the hurdle** only, not 20% of all profit.
Case A1: profit is 50 (150 back on 100 in), but the GP gets 8 = 20% of the 40 above the
hurdle. That's 16% of total profit. Catch-up (M2) is the tier that closes this gap.

## Performance metrics

- **Paid-in:** total contributed capital (investment + fees).
- **DPI (distributions to paid-in):** LP distributions ÷ paid-in. Cash actually returned. A DPI
  of 1.0x means the LPs have their money back.
- **TVPI (total value to paid-in):** (LP distributions + NAV) ÷ paid-in. Realized plus unrealized.
- **Net IRR:** the XIRR of the LP's cash flows (calls negative, distributions positive, NAV
  as a final positive flow). "Net" means after carry, and from M3 after fees.

**XIRR** finds the annual rate r where Σ amount_i / (1 + r)^(days_i / 365) = 0. There's no
formula for r, so the engine searches for it: Newton's method first, then bisection if Newton
goes out of range. The result is checked against `pyxirr`, which matches Excel.

## Validation rules (so far)

| Rule | Why |
|---|---|
| Events are in date order | The waterfall is path-dependent. Order changes the answer, so the caller has to decide it. |
| No distribution before the first capital call | It would meet an empty hurdle account and become carry on money no LP put in. |
| Carry rate in [0, 1) | A rate of 1 or more would give the GP everything. |
| Catch-up must be 0 (until M2) | M2 adds: 0 or greater than the carry rate, otherwise the GP never catches up. |

## Numbers and rounding

The engine works in floating point and never rounds. `100 × 1.1 − 100` comes out as
`10.000000000000014`, so tests compare with a tolerance (1e-9). Rounding to cents is a
reporting decision. In the Tab 2 pipeline (M7), it's a separate step that keeps every
distribution summing to the cent.
