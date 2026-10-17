# Fee Explorer

A personal learning project: how closed-ended private equity funds charge **management fees** and
**carried interest** (the performance fee), one idea at a time. It's a static site: the engine runs
in the browser, with no backend. Live at https://royceho.com/fee-explorer/.

- **Learn:** a short course of one-idea lessons, each with a small interactive, a predict-then-check
  question and a takeaway. Every predict answer is verified by the engine in `tests/lessons.test.ts`.
- **Explore:** the full playground: tier chart, step-through, gross-to-net bridge, fees, European vs
  American with clawback, and funds rebuilt from public pension data.
- **Under the hood:** an illustrative pipeline from terms to stored rows, with JSON, DDL and
  generated rows for every stage, and re-runs that never overwrite history.

- **Plan and milestones:** [docs/PLAN.md](docs/PLAN.md)
- **Concepts, in plain English:** [docs/concepts.md](docs/concepts.md)
- **Hand-worked test cases:** [tests/fixtures/hand-worked.md](tests/fixtures/hand-worked.md)

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # hand-worked cases, property tests, XIRR vs pyxirr
npm run build      # static site in dist/
```

## Publish to GitHub Pages

`.github/workflows/pages.yml` tests, builds and publishes the site on every push to `main`.
One-time setup: push the repository to GitHub, then in **Settings → Pages** set the source to
**GitHub Actions**. The site works from any sub-path because Vite builds with relative paths.

## Regenerate the XIRR oracle (optional)

```bash
python -m venv .venv
.venv/Scripts/pip install pyxirr          # macOS/Linux: .venv/bin/pip
.venv/Scripts/python scripts/xirr_oracle.py
```

## Layout

| Path | What |
|---|---|
| `src/engine/` | Pure waterfall engine: no DOM, no clock. The UI imports only `src/engine/index.ts`. |
| `src/pipeline/` | Pure Tab 2 pipeline: terms → approval → cash flows → run → fees → allocations → reports, into append-only tables. |
| `src/learn/` | The course: lessons as data, their widgets, the lesson shell and the landing page. |
| `src/ui/` | Plain TypeScript and SVG. State → engine → render. Hash routing in `router.ts`. |
| `src/scenarios/` | Preset funds, and the calibration that rebuilds two of them from public pension data (see `sources.md`). |
| `tests/fixtures/` | Language-neutral expected results (JSON), shared with any future engine. |
