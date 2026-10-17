# Fund Economics Explorer: Plan (v3)

A static learning site that shows how money moves between investors (LPs) and the manager (GP) in a
**closed-ended private equity fund**. It covers **management fees** and **carried interest**
through a distribution waterfall, both European (whole-of-fund) and American (deal-by-deal). A second
tab shows how a production system would configure, calculate and store all of this.

**Scope: closed-ended funds only.** Evergreen funds (NAV-based performance fees, subscriptions and
redemptions) and mandates (single-investor vehicles with layered fees) were in the v2 plan and have
been dropped for now. They could come back as separate milestones later. The engine's shapes don't
rule them out.

All data is synthetic, or calibrated to public sources and labelled with its source. Employer
names, products, schemas and internal terms never appear in the repo.

## 0. Purpose

This is a personal **learning project**. Its main job is to help me learn and visualize PE fees
and pricing: management fees, carry, and how the cash moves between LPs and the GP.
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

## 2. Folder structure (as built)

```
waterfall/
├─ index.html  package.json  tsconfig.json  vite.config.ts
├─ docs/
│  ├─ PLAN.md
│  └─ concepts.md               # plain-English explanations and formulas, grows each milestone
├─ src/
│  ├─ engine/                   # PURE: no DOM, no clock, no randomness
│  │  ├─ types.ts
│  │  ├─ daycount.ts            # ACT/365F year fractions, addMonths
│  │  ├─ validate.ts            # every input rule, reported with its field path
│  │  ├─ fees/
│  │  │  └─ managementFee.ts    # billing dates, basis, size discounts, fee calls
│  │  ├─ carry/
│  │  │  ├─ hurdle.ts           # pref accrual ("hurdle account"), four conventions
│  │  │  ├─ tiers.ts            # ROC, pref, catch-up, split: one function each
│  │  │  ├─ european.ts         # whole-fund reducer + shared `distribute`
│  │  │  ├─ american.ts         # deal-by-deal reducer (per-deal accounts)
│  │  │  └─ waterfall.ts        # picks the reducer for the structure
│  │  ├─ partners.ts            # per-partner runs, liquidation, clawback, aggregation
│  │  ├─ xirr.ts  metrics.ts    # XIRR, DPI, TVPI, gross→net bridge
│  │  └─ index.ts               # the only module the UI imports
│  ├─ scenarios/
│  │  ├─ presets.ts
│  │  └─ sources.md             # citation for every preset that follows a public source
│  ├─ pipeline/                 # PURE (M5): engine result → JSON payloads + table rows for Tab 2
│  ├─ ui/
│  │  ├─ main.ts  state.ts  format.ts
│  │  ├─ business/              # Tab 1: inputs, charts, step-through, bridge, comparison
│  │  └─ technical/             # Tab 2 (M5)
│  └─ styles.css
├─ tests/
│  ├─ fixtures/hand-worked.md   # the arithmetic, step by step (written first)
│  ├─ fixtures/hand-worked.json # the same expected results, machine-readable
│  ├─ fixtures/xirr-oracle.json
│  ├─ arbitraries.ts            # random-fund generator for property tests
│  └─ *.test.ts
└─ scripts/xirr_oracle.py
```

## 3. Engine data model (as built)

See `src/engine/types.ts` for the full, commented definitions.

```ts
interface FundInput {
  terms: CarryTerms;            // structure, hurdle, compounding, catch-up, carry, lossRecovery
  partners: Partner[];          // role 'LP' | 'GP' (GP commitment), commitment, feeClassId?
  events: FundEvent[];          // capital calls (investment, dealId?) and distributions (amount, costRealized?, dealId?)
  nav?: NavMark;                // remaining value on a date → hypothetical liquidation
  fees?: ManagementFeeTerms;    // start date + fee classes (periods, basis, size discount)
}

interface WaterfallResult {
  partners: PartnerResult[];    // per partner: ledger, allocations, trace, fees, cash flows, clawback
  allocations: FundAllocation[];// per distribution × tier, LP and GP amounts
  liquidation: …;               // the NAV "if sold today"
  fees: FeeLine[];              // every quarterly fee charge
  comparison: Comparison | null;// American only: European re-run + clawback
}
```

How a run works:
1. **Per partner:** take its commitment share of every investment call and distribution, work out
   its quarterly management fees and add them as capital calls.
2. **Waterfall:** `events.reduce(applyEvent, emptyLedger())` with the European or American reducer.
   Both share the same four tiers.
3. **NAV:** a hypothetical liquidation gives accrued carry and net NAV.
4. **American only:** re-run as European and claw back any excess carry.
5. **Aggregate** partners into fund-level rows; metrics and the bridge are computed from those.
6. **Rounding:** the engine works in float64. Only `pipeline/` (M5) rounds to cents, with the
   leftover cent assigned so every event still sums exactly.

## 4. Milestones

Each milestone ends with a git commit, tests passing, and an updated `concepts.md`.

| # | Scope | Done when |
|---|---|---|
| **M1** European carry basics ✅ | Scaffold. Hand-worked cases written **before** the engine. ROC → pref → 80/20 split, annual compounding. Several LPs, each run per partner. XIRR, DPI, TVPI, NAV. Property tests. Minimal Tab 1. | Hand cases and properties pass. XIRR matches the oracle. |
| **M2** Catch-up and step-through ✅ | Catch-up at 0/50/80/100% with validation. Four compounding conventions. Step-through mode. Accrued carry on NAV. ILPA-style and catch-up-zone presets. | Hand cases include one that stops partway through catch-up. |
| **M3** Management fees ✅ | Commitment basis, then net invested capital; quarterly in advance; funded by capital calls. Size discounts (whole/marginal), side letters, GP commitment. Gross → net bridge. | Fee schedule matches by hand; the bridge reconciles. |
| **M4** American waterfall ✅ | Deal-by-deal with loss-recovery toggle, clawback against European, comparison chart, write-off preset. | GP keeps min(American, European) on every case. |
| **M5** Tab 2 pipeline ✅ | Terms config → validation and approval → cash-flow ingestion → fee calc → waterfall calc run → allocation output (rounding) → reporting. JSON in/out per stage, generated rows, DDL sketches. Re-run with new terms adds a calc run instead of overwriting one. | Every row shown is generated from the engine, none hard-coded. |
| **M6** Public data and polish | Presets calibrated to public pension fund-level data (cited in `sources.md`, labelled as reconstructions). Net-to-gross panel: many gross outcomes fit one net IRR. Storage trade-off notes. Accessibility. GitHub Pages deploy. | |

### Illustrative tables for Tab 2

`fund_terms`, `fee_schedule`, `partner`, `deal`, `cash_flow_event`, `calc_run`, `fee_accrual`,
`waterfall_allocation` (per tier, per partner), `clawback`.

## 5. Decisions taken (from Q&A)

- **Closed-ended funds only.** Evergreens and mandates are out of scope for now.
- Several LPs, each with their own ledger. GP commitment is modelled as a partner.
- Management fees are in scope (M3). Fees: quarterly in advance from a start date, no pro-ration;
  basis commitment or net invested capital (investment − cost sold); paid by capital calls;
  capped at the NAV date.
- Pref uses the "hurdle account" (IRR-equivalent) convention.
- Catch-up rate must be 0 or greater than the carry rate. This is enforced in validation.
  The ILPA model LPA brackets an 80:20 catch-up, so the UI offers 0 / 50 / 80 / 100%.
- Both European and American waterfalls. American has a loss-recovery toggle.
- American: per-deal hurdle accounts; a distribution's cost sold moves that share into "due";
  fees shared across deals by cost; clawback = max(0, American − European), per partner, at the
  end (or the NAV date, as an exposure).
- NAV input. TVPI and net IRR use NAV net of accrued carry.
- Python is used only as the XIRR oracle for now. I may write my own Python engine later, so the
  fixtures and data shapes stay language-neutral (see §0).
- Tab 2: pure `src/pipeline/` over an append-only in-memory database; content-addressed terms
  versions and cash-flow batches; sequential run ids with `supersedes_run_id`; idempotent runs by
  input hash; largest-remainder rounding to cents per distribution; logical sequence numbers
  instead of timestamps.
- Data: hybrid. Terms are based on ILPA's model provisions. Some presets will be calibrated to
  public data (M6). Tests stay synthetic.
