# Waterfall Explorer

A personal learning project for visualizing how private equity fees and distribution waterfalls
work. It's a static site: the waterfall engine runs in the browser, with no backend.
All data is synthetic.

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
| `src/ui/` | Plain TypeScript and SVG. State → engine → render. |
| `src/scenarios/` | Preset funds. |
| `tests/fixtures/` | Language-neutral expected results (JSON), shared with any future engine. |
