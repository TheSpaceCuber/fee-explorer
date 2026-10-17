import type { FundMetrics } from '../../engine';
import { solveGross } from '../../scenarios/calibrate';
import type { Preset } from '../../scenarios/presets';
import { NET_TO_GROSS_GRID, typicalBuyoutTerms, type NetToGrossRow } from '../../scenarios/public';
import { esc, money, multiple, pct } from '../format';

/**
 * "Net to gross": for a preset rebuilt from a pension's published (net) figures, show
 *   1. published vs reconstructed, so you can see the calibration holds,
 *   2. the gross story under the assumed terms,
 *   3. on request, the gross return each of nine fee/carry combinations would need to produce the
 *      SAME net figures. The lesson: one net number fits many gross stories.
 */

// Grid results per preset. Solving takes up to a second, so it's done once, on request.
const grids = new Map<string, NetToGrossRow[]>();

export function renderNetToGross(root: HTMLElement, preset: Preset | undefined, m: FundMetrics, edited: boolean): void {
  const cal = preset?.calibration;
  const panel = root.closest('section')!;
  panel.hidden = !cal;
  if (!cal || !preset) return;
  const r = cal.reported;

  const row = (label: string, published: string, now: string) => `<tr><td>${label}</td><td>${published}</td><td>${now}</td></tr>`;
  const grid = grids.get(preset.id);

  root.innerHTML = `
    <p>${esc(r.name)} (${r.vintage} vintage). The pension publishes only <strong>net</strong> figures: what reached it after the GP's
      fees and carry. This reconstruction assumes a cash-flow timing and fund terms, then solves for gross flows that reproduce them.
      ${edited ? '<strong>You have edited the inputs, so the right-hand column has moved away from the published figures.</strong>' : ''}</p>
    <div class="ng-grid">
      <div>
        <h3>Published vs reconstruction</h3>
        <div class="table-scroll"><table>
          <thead><tr><th></th><th>Published (net)</th><th>This reconstruction</th></tr></thead>
          <tbody>
            ${row('Paid in', money(r.contributed), money(m.paidIn))}
            ${row('Distributed', money(r.distributed), money(m.distributedLp))}
            ${row('Remaining value', money(r.nav), money(m.netNav))}
            ${row('TVPI', multiple(r.tvpi), multiple(m.tvpi))}
            ${row('Net IRR', pct(r.irr), pct(m.irr))}
          </tbody>
        </table></div>
      </div>
      <div>
        <h3>The gross story (assumed terms)</h3>
        <div class="table-scroll"><table>
          <tbody>
            ${row('Deals: gross multiple', '', multiple(m.bridge.grossMoic))}
            ${row('Deals: gross IRR', '', pct(m.bridge.grossIrr))}
            ${row('Management fees', '', money(m.bridge.fees, 2))}
            ${row('Carry (paid + accrued)', '', money(m.bridge.carryPaid + m.bridge.accruedCarry, 2))}
          </tbody>
        </table></div>
        <p class="hint">Assumed: 1.5% on commitments for 6 years then 1% on invested capital, 8% hurdle, 100% catch-up, 20% carry.</p>
      </div>
    </div>

    <h3>Other gross stories that fit the same net figures</h3>
    ${
      grid
        ? gridTable(grid)
        : `<p>Different terms would need a different gross return to deliver the same ${multiple(r.tvpi)} and ${pct(r.irr)} net.
            <button id="ng-solve" class="ng-solve">Solve for 9 fee and carry combinations</button></p>`
    }
    <p class="hint">Source: ${esc(cal.source.publisher)}, <a href="${cal.source.url}" target="_blank" rel="noopener noreferrer">${esc(cal.source.document)}</a>.
      The report says its figures are net of fees and that its IRRs aren't approved by the GPs. These reconstructions are teaching examples,
      not estimates of the funds' real gross returns or terms.</p>`;

  root.querySelector<HTMLButtonElement>('#ng-solve')?.addEventListener('click', (e) => {
    const button = e.currentTarget as HTMLButtonElement;
    button.disabled = true;
    solveProgressively(preset, (done) => (button.textContent = `Solving… ${done} of ${NET_TO_GROSS_GRID.length}`), () =>
      renderNetToGross(root, preset, m, edited),
    );
  });
}

/** Solve one combination per tick, so the page stays responsive and shows progress. */
function solveProgressively(preset: Preset, progress: (done: number) => void, finished: () => void) {
  const cal = preset.calibration!;
  const rows: NetToGrossRow[] = [];
  const step = () => {
    const g = NET_TO_GROSS_GRID[rows.length]!;
    rows.push({ ...g, ...solveGross(cal.reported, cal.shape, typicalBuyoutTerms(cal.reported.vintage, g)) });
    progress(rows.length);
    if (rows.length < NET_TO_GROSS_GRID.length) setTimeout(step, 0);
    else {
      grids.set(preset.id, rows);
      finished();
    }
  };
  setTimeout(step, 0);
}

function gridTable(rows: NetToGrossRow[]): string {
  const fees = [...new Set(rows.map((r) => r.feeRate))];
  const carries = [...new Set(rows.map((r) => r.carryRate))];
  const at = (f: number, c: number) => rows.find((r) => r.feeRate === f && r.carryRate === c)!;
  const moics = rows.map((r) => r.grossMoic ?? 0);
  return `<div class="table-scroll"><table class="ng-table">
      <thead><tr><th>Fee in investment period ↓ · carry →</th>${carries.map((c) => `<th>${pct(c, 0)} carry</th>`).join('')}</tr></thead>
      <tbody>${fees
        .map(
          (f) => `<tr><td>${pct(f, 1)} fee</td>${carries
            .map((c) => {
              const x = at(f, c);
              const assumed = f === 0.015 && c === 0.2;
              return `<td class="${assumed ? 'assumed' : ''}"><strong>${multiple(x.grossMoic)}</strong> · ${pct(x.grossIrr)} gross
                <span class="hint">fees ${money(x.fees)}, carry ${money(x.carry)}</span></td>`;
            })
            .join('')}</tr>`,
        )
        .join('')}</tbody>
    </table></div>
    <p>Every cell produces the <em>same</em> published net result, yet the gross multiple it needs ranges from
      ${multiple(Math.min(...moics))} to ${multiple(Math.max(...moics))}. So from an LP report alone you can't tell how well the deals did
      (gross) or how expensive the fund was. You need the terms, which is why LPs and consultants ask for them.
      ${rows.every((r) => r.carry < 0.005) ? 'Here carry never applied, because the fund never cleared its hurdle, so only the fee rate changes the answer. ' : ''}
      The outlined cell is this preset's assumption.</p>`;
}
