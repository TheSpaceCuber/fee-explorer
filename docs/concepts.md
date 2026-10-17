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

## The European waterfall (M1–M2)

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

Compound is more LP-friendly. The engine supports four conventions:

| Convention | Hurdle balance after t years | Effective annual rate at r = 8% |
|---|---|---|
| simple | only capital earns: pref += C · r · t | — (unpaid pref earns nothing) |
| annual | H · (1 + r)^t | 8.00% |
| quarterly | H · (1 + r/4)^(4t) | 8.24% |
| daily | H · (1 + r/365)^(365t) | 8.33% |

More frequent compounding means more pref owed, so a little less carry.

**Unpaid pref compounds.** Hand-worked case A5: after one year the LP gets 60 of its 100
back, so it is still owed 40 of capital and 10 of pref. In year two the 10% hurdle accrues on
all 50, so the pref owed becomes 15, not 14.

### What carry looks like without catch-up

With no catch-up, the GP gets 20% of profit **above the hurdle** only, not 20% of all profit.
Case A1: profit is 50 (150 back on 100 in), but the GP gets 8 = 20% of the 40 above the
hurdle. That's 16% of total profit. The catch-up is the tier that closes this gap.

### The catch-up (M2)

After the pref, the GP has received 0% of the profit but is entitled to its carry rate c of
**all** of it, including the pref. In the catch-up tier the GP takes a share k of each dollar
(the LP gets 1 − k) until it has caught up.

```
Π = profit paid so far (pref + catch-up + split, LP and GP)     G = carry paid so far
The tier ends when  G + k·x = c·(Π + x)   →   x* = (c·Π − G) / (k − c)
```

Case B1 (100% catch-up): pref 10 → x* = 0.2 × 10 / 0.8 = 2.5 to the GP. The GP now has 2.5 of
12.5 = 20%, and everything after is split 80/20. The GP ends with 10 = 20% of the 50 profit.

| Catch-up k | Meaning | Market usage |
|---|---|---|
| 0 | no catch-up tier. The pref is carry-free | LP-friendly funds |
| 50% | GP and LP share the catch-up dollars | common compromise |
| 80% | GP takes 80% | the ILPA model LPA's bracketed figure |
| 100% | "full" catch-up: GP takes everything until caught up | GP-friendly, common in buyout |

**Why k must be above c.** With k ≤ c the GP gets at most c of each new dollar while starting
from 0%, so it can never reach c of the total. x* is infinite or negative. Validation rejects it.

**The catch-up zone.** If the fund's cash runs out while the GP is still catching up (case B4,
preset "Ending in the catch-up zone"), the GP ends with less than c. With a 100% catch-up every
dollar in that zone goes to the GP, so **the LP's return is stuck at exactly the hurdle**. The
preset shows a net IRR of 8.0% at an 8% hurdle. This is why LPs care about the catch-up rate.

**The hurdle can reopen.** If new capital is called after the GP has caught up (case B6), it
earns pref again. Paying that pref pushes the GP below c, so a small catch-up happens again.
The formula handles this because it works on running totals.

## The American (deal-by-deal) waterfall (M4)

In a **European** waterfall, *all* contributed capital plus the hurdle must come back before the
GP earns any carry. In an **American** one, only the capital of deals that have been **sold** is
due. So the GP can take carry on an early winner while other deals are still held, and some of
those may turn out to be losers.

### How the engine models it

- Every deal has its own hurdle account (its capital plus pref accruing on it). So do the fees.
- A distribution says which deal it came from and how much **cost** it sold. That share of the
  deal's account (capital + its pref) moves into a **due** account. So does a matching share of
  the fees (cost sold ÷ all cost outstanding).
- The usual tiers (ROC → pref → catch-up → split) run against *due*, exactly as in European.
- A **write-off** is a distribution of 0 that sells the deal's whole cost: its capital becomes due
  and nothing pays it.

### Loss recovery

| Setting | What happens to a written-off deal's capital | Who it favours |
|---|---|---|
| Recovered first (`realized`) | stays due: later winners must pay it back before more carry | LPs |
| Ignored (`none`) | forgiven: each deal stands alone ("pure" deal-by-deal) | GP |

### Clawback

Because American can pay carry the whole fund never earns, LPAs add a **clawback**. At the end of
the fund the GP compares what it received with what a whole-fund (European) calculation would
give on the same cash flows, and pays back the excess:

```
clawback = max(0, American carry − European carry)        (per partner)
GP keeps = min(American, European)
```

With NAV still held, the comparison uses the hypothetical sale ("if sold today"), so the clawback
is an **exposure**, like accrued carry. Real clawbacks are usually capped at carry *after the GP's
taxes*, and often backed by escrow or personal guarantees. This model ignores taxes.

### Three things the cases teach

1. **Clawback restores the money, not the time value.** In the first version of the American
   preset the GP returned all $6m of carry, but four years late, so the LP's net IRR (5.0%) still
   trailed the gross (5.2%).
2. **American is not always more carry.** Case H4 and the American preset with losses
   "recovered first" both pay the GP *less* than European. Each deal's capital keeps earning pref
   until *that* deal is sold, while European stops pref on capital as soon as any distribution
   returns it. What American reliably gives the GP is **earlier** carry.
3. **Without loss recovery, carry can be earned on a losing fund** (case H2N): a write-off then a
   winner, total out < total in, yet the GP gets carry on the winner. The clawback takes it all
   back at the end.

## Accrued carry and hypothetical liquidation (M2)

While a fund still holds investments (NAV), the GP hasn't been paid carry on them yet, but it
would be if they were sold at that value. The engine asks "if we sold everything at NAV today,
how would the waterfall split it?" by pushing the NAV through the same tiers as a pretend
distribution. The real ledger is left untouched.

- The GP's part is the **accrued carry**. Funds book it as a liability, and LP statements report
  NAV **net** of it.
- **Net NAV** = NAV − accrued carry. TVPI and net IRR use net NAV.

Case A8: NAV 80, with 50 of capital and 10 of pref still owed → ROC 50, PREF 10, split 20 →
accrued carry 4, net NAV 76, TVPI 1.26 (it would be 1.30 gross).

The step-through lets you walk this pretend distribution like a real one ("NAV, if sold").

## Management fees (M3)

The **management fee** pays the GP to run the fund: salaries, offices, deal sourcing. It's
charged whether or not the fund makes money. Carry, by contrast, is only earned on profit.

### A typical schedule

| Phase | Rate | Basis | Why |
|---|---|---|---|
| Investment period (often 5 years) | ~2% a year | **commitment** | The GP is busy finding deals, so the fee is on the whole fund size |
| After that | ~1.5% a year | **net invested capital** | The GP is harvesting. The fee shrinks as deals are sold |

**Net invested capital** = investment called − cost of investments sold (or written off). Cost,
not proceeds: a deal bought for 12 and sold for 20 reduces the basis by 12. That's why each
distribution in this tool has a "cost sold" field.

The engine bills **quarterly in advance**: on each billing date (fee start + 0, 3, 6, … months)
it charges `rate / 4 × basis`. Hand-worked case F2 walks through a step-down.

### Fees are paid by calling capital, and that matters for carry

The LPs pay the fee by funding a capital call. So fee dollars are **contributed capital**:
- they come back to the LP first, in the ROC tier,
- they earn the pref like any other contributed dollar (case F6: pref 8.12 vs about 8.05),
- so the fund has to earn back its fees before the GP sees carry.

Turning fees on in the full-fund preset lowers GP carry from $17.6m to $15.7m, and a property
test checks that adding fees never increases carry.

### Different LPs, different fees

- **Size discount (fee ratchet):** big commitments pay less. Two common conventions:
  - *whole*: if you commit ≥ $40m, your whole commitment gets the lower rate,
  - *marginal*: only the slice above $40m does, like tax brackets (case F4).
- **Side letter:** a negotiated deal for one LP, often a lower rate for early or strategic investors.
- **Fee-free LP:** e.g. employees or affiliates investing alongside.
- **GP commitment:** the GP invests its own money (often 1–2%) alongside the LPs. It pays no fees
  and no carry (it would be paying itself). Its return is the deals' gross return, which makes a
  neat check: in the full-fund preset its IRR equals the gross deal IRR.

Because each partner pays different fees, each has a different hurdle account, different carry
and a different net IRR. That's why the engine runs the waterfall **per partner** and adds up.

### From gross to net

```
gross profit   = distributions + NAV − investment called       (what the deals made)
− management fees
− carry paid
− accrued carry (on the NAV)
= net profit to partners
```

This always adds up exactly: every distributed dollar goes to a partner or to carry, and fees are
money paid in on top of the investment. The same story in IRR terms: **gross IRR → IRR after fees
→ net IRR**. The gaps are the "fee drag" and "carry drag" LPs talk about. In the full-fund preset
that's 16.9% → 14.8% → 12.9%.

## Performance metrics

- **Paid-in:** total contributed capital (investment + fees). LP metrics cover LP investors only,
  not the GP's own commitment.
- **DPI (distributions to paid-in):** LP distributions ÷ paid-in. Cash actually returned. A DPI
  of 1.0x means the LPs have their money back.
- **TVPI (total value to paid-in):** (LP distributions + net NAV) ÷ paid-in. Realized plus unrealized.
- **Net IRR:** the XIRR of the LP's cash flows (calls negative, distributions positive, net NAV
  as a final positive flow). "Net" means after carry, and from M3 after fees.
- **GP share of profit:** (carry paid + accrued carry) ÷ (all distributions + NAV − paid-in).
  It equals the carry rate once the GP has fully caught up, and stays below it with no catch-up
  or inside the catch-up zone.

**XIRR** finds the annual rate r where Σ amount_i / (1 + r)^(days_i / 365) = 0. There's no
formula for r, so the engine searches for it: Newton's method first, then bisection if Newton
goes out of range. The result is checked against `pyxirr`, which matches Excel.

## Validation rules (so far)

| Rule | Why |
|---|---|
| Events are in date order | The waterfall is path-dependent. Order changes the answer, so the caller has to decide it. |
| No distribution before the first capital call | It would meet an empty hurdle account and become carry on money no LP put in. |
| Carry rate in [0, 1) | A rate of 1 or more would give the GP everything. |
| Catch-up is 0, or above the carry rate and at most 1 | Otherwise the GP never catches up and the tier never ends. |
| Compounding is one of simple / annual / quarterly / daily | |
| Fee periods are valid and don't overlap; rates between 0 and 10% | |
| A partner's fee class must exist; the GP commitment can't have one | The GP doesn't charge itself fees. |
| Total cost sold ≤ total investment called | Invested capital (the fee basis) can't go negative. |
| American: every investment call and distribution names a deal; a deal can't sell more cost than was invested in it | Otherwise there is nothing to make due. |

## Numbers and rounding

The engine works in floating point and never rounds. `100 × 1.1 − 100` comes out as
`10.000000000000014`, so tests compare with a tolerance (1e-9). Rounding to cents is a
reporting decision. In the Tab 2 pipeline (M7), it's a separate step that keeps every
distribution summing to the cent.

## Testing lesson: generators must reach the interesting cases

The first M2 property tests passed even against a deliberately broken catch-up formula.
fast-check's `fc.double` favours edge values (0, tiny numbers, min/max), so almost every
generated hurdle and carry rate was about 0. Out of 745 random funds with a catch-up, **none**
paid one. The fix was to generate rates in whole basis points and amounts in whole cents, plus a
**coverage test** that fails if fewer than a set number of random funds pay pref, catch-up and
carry, or end mid-catch-up. A property is only as good as the inputs it sees.

## Testing lesson 2: a property test found a real bug

When fees were added, the "no allocation is ever negative" property failed with an allocation of
−0.0000000029. Tiny, but money shouldn't go negative. The shrunk counterexample showed a NAV valued
on 31 Jan while the fee schedule kept billing until October. Those later fee calls moved the
ledger's clock past the NAV date, so the hypothetical liquidation accrued pref over **−0.67 years**.
Validation only compared the NAV date with the events you entered. It couldn't see the fee calls,
because the engine generates them later.

The fix: fees after the NAV date aren't billed (the NAV is a valuation as of that date), and the
accrual now throws if time ever runs backwards, so this kind of bug fails loudly. Hand-worked
case F7 pins it down. No hand-picked example would have found it. The random funds did.

## Testing lesson 3: hand-worked cases catch mistakes in both directions

Writing the M4 cases, I made three arithmetic slips in the fixture: an LP total, and two cash flows
on a day when a fee was paid and a distribution received. The engine disagreed with the fixture, and
working through each disagreement showed the **fixture** was wrong, not the engine. That's the
point of independent expected values: when the two disagree, you have to reason it out, and either
side can be at fault. The property-test generator also needed two fixes of its own: a $0 capital
call that named a deal, and rounding "cost sold" up past what a deal had left.
