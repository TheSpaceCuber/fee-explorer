# Fund Economics Explorer: Plan (v2)

A static learning site that shows how money moves between investors (LPs) and the manager (GP).
It covers three things: **management fees**, **carried interest** through a distribution waterfall
(European and American), and **performance fees** in evergreen funds. A second tab shows how a
production system would configure, calculate and store all of this.

All data is synthetic, or calibrated to public sources and labelled with its source. Employer
names, products, schemas and internal terms never appear in the repo.

## 0. Purpose

This is a personal **learning project**. Its main job is to help me learn and visualize PE fees
and pricing: management fees, carry, performance fees, and how the cash moves between LPs and the GP.
The UI is a way to explore and understand. It is not meant to be a production tool.

**I may build my own Python engine later.** To keep that easy:

- The test cases are language-neutral. `tests/fixtures/hand-worked.json` holds inputs and expected
  outputs as plain JSON, so a Python engine can run against exactly the same cases as the TS engine.
- The engine's inputs and outputs (terms, events, allocations, trace) are plain JSON-shaped data with
  no TS-only features (no classes, no `Date` objects; dates are ISO strings). That makes them easy to
  map to Python dataclasses or pydantic models.
- `docs/concepts.md` describes each calculation in words and formulas, not only in code, so it can
  serve as the spec for a reimplementation.
- If a Python engine exists later, the UI can load its output as JSON fixtures, and the two engines
  can be checked against each other (differential testing).

---

## 1. Tech stack

| Choice | Why |
|---|---|
| **TypeScript** | Types catch "rate where an amount belongs" and misspelled tier names before tests run. They also document the code for a learning project. |
| **Vite** | One dev dependency. `vite build` produces a static `dist/` for GitHub Pages. |
| **Vitest + fast-check** | Uses the same TS setup as the app. fast-check generates random funds for the property tests. |
| **No UI framework** | Each tab is "state → `render(state)`". Charts are hand-written SVG. Keeps attention on the engine. |
| **Python (oracle only)** | `scripts/xirr_oracle.py` uses `pyxirr` (matches Excel's XIRR) to write expected IRRs to a JSON fixture. |

## 2. Folder structure

```
waterfall/
├─ index.html  package.json  tsconfig.json  vite.config.ts
├─ docs/
│  ├─ PLAN.md
│  └─ concepts.md               # plain-English glossary, grows each milestone
├─ src/
│  ├─ engine/                   # PURE: no DOM, no clock, no randomness
│  │  ├─ types.ts
│  │  ├─ daycount.ts            # ACT/365F year fractions
│  │  ├─ validate.ts            # term rules (e.g. catch-up rate vs carry rate)
│  │  ├─ fees/
│  │  │  ├─ managementFee.ts    # fee periods, basis, step-down, size discounts
│  │  │  └─ feeCalls.ts         # turn fees into capital-call events
│  │  ├─ carry/
│  │  │  ├─ hurdle.ts           # pref accrual ("hurdle account")
│  │  │  ├─ tiers.ts            # ROC, pref, catch-up, split, one function each
│  │  │  ├─ european.ts         # whole-fund waterfall
│  │  │  ├─ american.ts         # deal-by-deal + clawback
│  │  │  └─ liquidation.ts      # hypothetical liquidation → accrued carry on NAV
│  │  ├─ evergreen/
│  │  │  └─ performanceFee.ts   # NAV-based fee, high-water mark, crystallization
│  │  ├─ partners.ts            # per-partner run + fund-level aggregation
│  │  ├─ xirr.ts  metrics.ts    # XIRR, DPI, TVPI, gross→net bridge
│  │  └─ index.ts               # the only module the UI imports
│  ├─ scenarios/
│  │  ├─ presets.ts
│  │  └─ sources.md             # citation for every calibrated preset
│  ├─ pipeline/                 # PURE: engine result → JSON payloads + table rows (Tab 2)
│  ├─ ui/
│  │  ├─ main.ts  state.ts
│  │  ├─ business/              # Tab 1
│  │  └─ technical/             # Tab 2
│  └─ styles.css
├─ tests/
│  ├─ fixtures/hand-worked.md   # the arithmetic, step by step (written first)
│  ├─ fixtures/hand-worked.json # the same expected results, machine-readable
│  ├─ fixtures/xirr-oracle.json
│  └─ *.test.ts
└─ scripts/xirr_oracle.py
```

## 3. Engine data model

### 3.1 Vehicles and partners

```ts
type VehicleKind = 'closed_ended' | 'evergreen' | 'mandate';

interface Partner {
  id: string;
  role: 'LP' | 'GP';
  commitment: number;
  feeClassId: string;        // which fee terms apply (side letters, size discounts)
  carryBearing: boolean;     // GP's own commitment: false
}

interface Vehicle {
  id: string;
  kind: VehicleKind;
  partners: Partner[];
  feeTerms: Record<string, ManagementFeeTerms>;   // keyed by feeClassId
  carryTerms?: CarryTerms;                        // closed-ended
  perfFeeTerms?: PerformanceFeeTerms;             // evergreen
  underlying?: { vehicleId: string; commitment: number }[];  // mandate → funds
}
```

### 3.2 Terms

```ts
interface ManagementFeeTerms {
  periods: { from: ISODate; to: ISODate; rate: number;
             basis: 'commitment' | 'invested_capital' | 'nav' }[];
  billing: 'quarterly_in_advance';
  sizeDiscounts?: { minCommitment: number; rateReduction: number }[];  // fee ratchet by size
}

interface CarryTerms {
  structure: 'european' | 'american';
  hurdleRate: number;                 // 0.08
  compounding: 'simple' | 'annual' | 'quarterly' | 'daily';
  catchUpRate: number;               // 0, or carryRate < k ≤ 1 (UI: 0 / 50 / 80 / 100%)
  carryRate: number;                  // 0.20
  lossRecovery: 'none' | 'realized';  // American only
  clawback: boolean;                  // American only
}

interface PerformanceFeeTerms {      // evergreen
  rate: number;                      // e.g. 0.10 of gains
  hurdleRate?: number;
  highWaterMark: boolean;
  crystallization: 'quarterly' | 'annual';
}
```

### 3.3 Events and the ledger

```ts
type FundEvent =
  | { kind: 'capital_call'; date; investment: number; fee: number }  // fee part from fees/
  | { kind: 'distribution'; date; amount: number; dealId?: string }
  | { kind: 'nav_mark'; date; nav: number }
  | { kind: 'subscription' | 'redemption'; date; partnerId; amount };  // evergreen

interface PartnerLedger {              // one per partner, per vehicle
  asOf: ISODate;
  contributed: { investment: number; fee: number };
  capitalOutstanding: number;
  hurdleBalance: number;               // see concepts.md "hurdle account"
  cumulative: { roc; pref; catchUpGp; catchUpLp; splitLp; splitGp };
}

interface TierAllocation { eventId; partnerId; tier: 'ROC'|'PREF'|'CATCHUP'|'SPLIT'; lp; gp }
interface TraceStep { tier; available; consumed; remaining; explanation: string }
```

### 3.4 How a run works

1. **Fees:** `managementFee(terms, partner, dates)` produces fee amounts. `feeCalls` turns them into the
   fee part of each capital call.
2. **Per-partner waterfall:** each LP has its own ledger and is run separately:
   `events.reduce(applyEvent, initialLedger)`. This is needed because LPs with different fee rates
   contribute different amounts, so their pref and carry differ. Splitting the fund total pro rata
   afterwards only works when every LP has identical terms.
3. **Aggregation:** fund totals are the sum over partners. Property check: Σ partners = fund.
4. **Rounding:** the engine works in float64. Only `pipeline/` rounds to cents, with the leftover cent
   assigned so every event still sums exactly.

## 4. Milestones

Each milestone ends with a git commit, tests passing, and an updated `concepts.md`.

| # | Scope | Done when |
|---|---|---|
| **M1** European carry basics ✅ | Scaffold. Hand-worked cases written **before** the engine. Waterfall: ROC → pref → 80/20 split (no catch-up), annual compounding. Several LPs with identical terms, each run per partner. XIRR, DPI, TVPI, NAV input. Property tests. Minimal Tab 1. | Hand cases and properties pass. XIRR matches the oracle to 1e-6. The page updates live. |
| **M2** Catch-up and step-through ✅ | Catch-up at 0/50/100% with validation. All compounding conventions. Step-through mode with plain-English explanations. Accrued carry on NAV (hypothetical liquidation). Presets: clean European, inside the catch-up zone. Terms based on ILPA's model whole-of-fund waterfall. | Hand cases include one that stops partway through catch-up. |
| **M3** Management fees ✅ | Fee periods (commitment basis during the investment period, invested capital after), step-down, quarterly in advance, funded by capital calls. Size-discount bands (fee ratchet). Fee classes per LP, so per-LP waterfalls now diverge. GP commitment as a fee-free, carry-free partner. Gross → fees → carry → net bridge chart. | A hand-worked fee schedule matches. The bridge reconciles gross to net exactly. |
| **M4** American waterfall ✅ | Deal-by-deal with a `lossRecovery` toggle (`none` vs `realized`), end-of-fund clawback. Side-by-side with European on the same flows. Realized-loss preset. | American carry minus clawback equals European carry on the reference cases. |
| **M5** Evergreen performance fees | NAV series, subscriptions and redemptions, performance fee with high-water mark and optional hurdle, periodic crystallization. Shown next to closed-ended carry. | Hand cases: fee only on new highs, none after a drawdown until recovered. |
| **M6** Mandates (stretch) | A single-investor vehicle that commits into underlying funds. Two layers of fees (mandate-level and underlying-fund-level), looked through to the investor's net. | The look-through bridge reconciles. |
| **M7** Tab 2 pipeline | Terms config → validation and approval → cash-flow ingestion → fee calc → waterfall calc run → allocation output (rounding) → reporting. JSON in/out per stage, generated rows, DDL sketches. Re-run with new terms adds a calc run instead of overwriting one. | Every row shown is generated from the engine, none hard-coded. |
| **M8** Public data and polish | Presets calibrated to public pension fund-level data (cited in `sources.md`, labelled as reconstructions). Net-to-gross panel: many gross outcomes fit one net IRR. Storage trade-off notes. Accessibility. GitHub Pages deploy. | |

### Illustrative tables for Tab 2

`fund_terms`, `fee_schedule`, `partner`, `cash_flow_event`, `calc_run`, `fee_accrual`,
`waterfall_allocation` (per tier, per partner), `performance_fee_crystallization`.

## 5. Decisions taken (from Q&A)

- Several LPs, each with their own ledger. GP commitment is modelled as a partner.
- Management fees and performance fees are in scope (M3, M5).
- Fees: quarterly in advance from a start date, no pro-ration; basis commitment or net invested
  capital (investment − cost sold); paid by capital calls; capped at the NAV date.
- Pref uses the "hurdle account" (IRR-equivalent) convention.
- Catch-up rate must be 0 or greater than the carry rate. This is enforced in validation.
  The ILPA model LPA brackets an 80:20 catch-up, so the UI offers 0 / 50 / 80 / 100%.
- Both European and American waterfalls. American has a loss-recovery toggle.
- American: per-deal hurdle accounts; a distribution's cost sold moves that share into "due";
  fees shared across deals by cost; clawback = max(0, American − European), per partner, at the
  end (or the NAV date, as an exposure).
- NAV input. TVPI includes NAV. Accrued carry on NAV comes in M2.
- Python is used only as the XIRR oracle for now. I may write my own Python engine later, so the
  fixtures and data shapes stay language-neutral (see §0).
- Data: hybrid. Terms are based on ILPA's model provisions. Some presets are calibrated to public data.
  Tests stay synthetic.
