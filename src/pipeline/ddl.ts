/**
 * Illustrative table definitions (PostgreSQL flavour). Generic names only: these are teaching
 * sketches, not any real system's schema.
 *
 * Patterns to notice:
 *  - Every table is insert-only. Nothing is ever UPDATEd or DELETEd by a calculation.
 *  - Configuration is versioned by content: fund_terms is keyed by terms_version_id (a hash).
 *  - Derived data (fees, allocations, clawbacks, reports) hangs off calc_run, so every number can
 *    be traced to the exact terms, cash flows and engine version that produced it.
 *  - Money is NUMERIC(18,2) (exact decimal), never FLOAT. Rates are NUMERIC(9,6).
 */
export type TableName =
  | 'fund_terms'
  | 'fee_schedule'
  | 'partner'
  | 'terms_approval'
  | 'deal'
  | 'cash_flow_event'
  | 'calc_run'
  | 'fee_accrual'
  | 'waterfall_allocation'
  | 'clawback'
  | 'report_snapshot';

export const DDL: Record<TableName, string> = {
  fund_terms: `CREATE TABLE fund_terms (
  terms_version_id  TEXT PRIMARY KEY,          -- hash of the terms: same terms, same id
  fund_id           TEXT NOT NULL,
  structure         TEXT NOT NULL CHECK (structure IN ('european','american')),
  hurdle_rate       NUMERIC(9,6) NOT NULL,
  compounding       TEXT NOT NULL,
  catch_up_rate     NUMERIC(9,6) NOT NULL,
  carry_rate        NUMERIC(9,6) NOT NULL,
  loss_recovery     TEXT,                      -- american only
  created_seq       BIGINT NOT NULL            -- a real system: created_at TIMESTAMPTZ
);`,
  fee_schedule: `CREATE TABLE fee_schedule (
  terms_version_id  TEXT NOT NULL REFERENCES fund_terms,
  fee_class         TEXT NOT NULL,
  period_no         INT  NOT NULL,
  period_from       DATE NOT NULL,
  period_to         DATE NOT NULL,             -- exclusive
  annual_rate       NUMERIC(9,6) NOT NULL,
  basis             TEXT NOT NULL CHECK (basis IN ('commitment','invested_capital')),
  discount_mode     TEXT,                      -- whole | marginal | NULL
  discount_min      NUMERIC(18,2),
  discount_cut      NUMERIC(9,6),
  PRIMARY KEY (terms_version_id, fee_class, period_no)
);`,
  partner: `CREATE TABLE partner (
  terms_version_id  TEXT NOT NULL REFERENCES fund_terms,
  partner_id        TEXT NOT NULL,
  role              TEXT NOT NULL CHECK (role IN ('LP','GP')),
  commitment        NUMERIC(18,2) NOT NULL,
  fee_class         TEXT,                      -- NULL: pays no management fee
  PRIMARY KEY (terms_version_id, partner_id)
);`,
  terms_approval: `CREATE TABLE terms_approval (
  approval_id       TEXT PRIMARY KEY,
  terms_version_id  TEXT NOT NULL REFERENCES fund_terms,
  decision          TEXT NOT NULL CHECK (decision IN ('approved','rejected')),
  issues            JSONB NOT NULL,            -- validation messages, empty when approved
  decided_seq       BIGINT NOT NULL
);
-- Approval is a new row, not an UPDATE of fund_terms.status:
-- the history of who approved what, and when, is kept for free.`,
  deal: `CREATE TABLE deal (
  fund_id   TEXT NOT NULL,
  deal_id   TEXT NOT NULL,
  PRIMARY KEY (fund_id, deal_id)
);`,
  cash_flow_event: `CREATE TABLE cash_flow_event (
  batch_id       TEXT NOT NULL,                -- hash of the whole ingested batch
  event_id       TEXT NOT NULL,
  fund_id        TEXT NOT NULL,
  deal_id        TEXT,
  kind           TEXT NOT NULL CHECK (kind IN ('capital_call','distribution')),
  event_date     DATE NOT NULL,
  seq_in_day     INT  NOT NULL,                -- same-day order matters to the waterfall
  amount         NUMERIC(18,2) NOT NULL,
  cost_realized  NUMERIC(18,2),
  PRIMARY KEY (batch_id, event_id)
);`,
  calc_run: `CREATE TABLE calc_run (
  run_id             TEXT PRIMARY KEY,
  fund_id            TEXT NOT NULL,
  terms_version_id   TEXT NOT NULL REFERENCES fund_terms,
  batch_id           TEXT NOT NULL,
  engine_version     TEXT NOT NULL,
  input_hash         TEXT NOT NULL,            -- terms + cash flows + engine: same hash, same answer
  as_of_date         DATE NOT NULL,
  supersedes_run_id  TEXT REFERENCES calc_run,
  reason             TEXT NOT NULL,
  created_seq        BIGINT NOT NULL
);
-- Which run is current is a VIEW, not a flag that gets updated:
CREATE VIEW v_current_run AS
SELECT r.* FROM calc_run r
WHERE NOT EXISTS (SELECT 1 FROM calc_run n WHERE n.supersedes_run_id = r.run_id);`,
  fee_accrual: `CREATE TABLE fee_accrual (
  run_id         TEXT NOT NULL REFERENCES calc_run,
  partner_id     TEXT NOT NULL,
  billing_date   DATE NOT NULL,
  period_no      INT  NOT NULL,
  basis          TEXT NOT NULL,
  basis_amount   NUMERIC(18,2) NOT NULL,
  annual_rate    NUMERIC(9,6)  NOT NULL,       -- after any size discount
  amount         NUMERIC(18,2) NOT NULL,
  PRIMARY KEY (run_id, partner_id, billing_date)
);`,
  waterfall_allocation: `CREATE TABLE waterfall_allocation (
  run_id      TEXT NOT NULL REFERENCES calc_run,
  event_id    TEXT NOT NULL,                   -- the distribution
  partner_id  TEXT NOT NULL,
  tier        TEXT NOT NULL CHECK (tier IN ('ROC','PREF','CATCHUP','SPLIT')),
  tier_seq    INT  NOT NULL,                   -- 1..4, payment order
  lp_amount   NUMERIC(18,2) NOT NULL,          -- to the partner
  gp_amount   NUMERIC(18,2) NOT NULL,          -- carry to the GP
  PRIMARY KEY (run_id, event_id, partner_id, tier)
);
-- One row per tier, zeros included: a missing row would be ambiguous
-- ("zero" or "not computed?"), and zeros compress to almost nothing.`,
  clawback: `CREATE TABLE clawback (
  run_id           TEXT NOT NULL REFERENCES calc_run,
  partner_id       TEXT NOT NULL,
  american_carry   NUMERIC(18,2) NOT NULL,
  european_carry   NUMERIC(18,2) NOT NULL,
  clawback_amount  NUMERIC(18,2) NOT NULL,
  settle_date      DATE NOT NULL,
  PRIMARY KEY (run_id, partner_id)
);`,
  report_snapshot: `CREATE TABLE report_snapshot (
  run_id       TEXT NOT NULL REFERENCES calc_run,
  report_seq   BIGINT NOT NULL,
  scope        TEXT NOT NULL,                  -- 'fund' or a partner_id
  metrics      JSONB NOT NULL,                 -- DPI, TVPI, IRR … as published
  PRIMARY KEY (run_id, scope)
);
-- A published report points at the run it came from, so a later re-run
-- never silently changes numbers that were already sent to investors.`,
};
