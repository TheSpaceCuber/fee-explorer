import { computeMetrics, runFund, type FundInput } from '../engine';
import { PRESETS } from '../scenarios/presets';
import { renderBridge } from '../ui/business/bridge';
import { renderComparison } from '../ui/business/comparison';
import { renderNetToGross } from '../ui/business/netgross';
import { money, pct, shortDate } from '../ui/format';
import { exampleFund, writeOffFund } from './funds';
import { keepFocus, onInput, onRadio, segmented, slider, stat, type Widget } from './widget-kit';

/** Widgets for Parts 4–5: fund structures, then everything together. */

const firstCarryDate = (input: FundInput, allocations: { eventId: string; gp: number }[]) => {
  const id = allocations.find((a) => a.gp > 1e-9)?.eventId;
  return id ? input.events.find((e) => e.id === id)!.date : null;
};

// ------------------------------------------------------------------ 12. European vs American

interface StructureP {
  lossRecovery: 'none' | 'realized';
}

const structure: Widget<StructureP> = {
  init: () => ({ lossRecovery: 'realized' }),
  input: (p) => writeOffFund({ lossRecovery: p.lossRecovery }),
  render(root, p, set) {
    keepFocus(root, () => {
      const input = structure.input(p);
      const r = runFund(input);
      const c = r.comparison!;
      const am = firstCarryDate(input, r.allocations);
      const eu = firstCarryDate(input, c.european.allocations);
      root.innerHTML = `
        ${segmented('st-loss', 'American: losses on deals already sold are', [['realized', 'recovered first'], ['none', 'ignored']], p.lossRecovery)}
        <div class="tiles pairs">
          ${stat('American: first carry', am ? shortDate(am) : 'never', 'deal by deal')}
          ${stat('European: first carry', eu ? shortDate(eu) : 'never', 'whole fund')}
          ${stat('American: carry paid', money(c.americanCarry, 1))}
          ${stat('European: carry paid', money(c.europeanCarry, 1))}
        </div>
        <div class="chart" id="st-chart"></div>`;
      renderComparison(root.querySelector('#st-chart')!, input, r);
      onRadio(root, 'st-loss', (v) => set({ lossRecovery: v as StructureP['lossRecovery'] }));
    });
  },
};

// ------------------------------------------------------------------ 13. clawback

interface ClawbackP {
  dealC: number;
}

const clawback: Widget<ClawbackP> = {
  init: () => ({ dealC: 45 }),
  input: (p) => writeOffFund({ lossRecovery: 'none', dealCProceeds: p.dealC }),
  render(root, p, set) {
    keepFocus(root, () => {
      const input = clawback.input(p);
      const r = runFund(input);
      const c = r.comparison!;
      root.innerHTML = `
        ${slider('cb-c', 'Deal C (cost $25m) sells for', p.dealC, 30, 70, 5, money(p.dealC, 0))}
        <div class="tiles pairs">
          ${stat('Clawback: the GP pays back at the end', money(c.clawback, 1), `${money(c.americanCarry, 1)} received − ${money(c.europeanCarry, 1)} whole-fund = the dashed drop in the chart`, true)}
          ${stat('Carry the GP received, deal by deal', money(c.americanCarry, 1))}
          ${stat('Carry on the whole fund (European)', money(c.europeanCarry, 1))}
          ${stat('GP keeps', money(c.americanCarry - c.clawback, 1))}
        </div>
        <div class="chart" id="cb-chart"></div>`;
      renderComparison(root.querySelector('#cb-chart')!, input, r);
      onInput(root, 'cb-c', (v) => set({ dealC: v }));
    });
  },
};

// ------------------------------------------------------------------ 14. gross to net

interface GrossNetP {
  fee: number;
  carry: number;
}

const grossNet: Widget<GrossNetP> = {
  init: () => ({ fee: 0.02, carry: 0.2 }),
  input: (p) => exampleFund({ feeRate: p.fee, ipYears: 5, carry: { carryRate: p.carry, hurdleRate: 0.08, catchUpRate: p.carry > 0 ? 0.8 : 0 } }),
  render(root, p, set) {
    keepFocus(root, () => {
      const input = grossNet.input(p);
      const m = computeMetrics(input, runFund(input));
      root.innerHTML = `
        ${slider('gn-fee', 'Management fee (investment period, then two-thirds)', p.fee, 0, 0.025, 0.0025, pct(p.fee, 2))}
        ${slider('gn-carry', 'Carry (8% hurdle, 80% catch-up)', p.carry, 0, 0.3, 0.05, pct(p.carry, 0))}
        <div class="chart" id="gn-bridge"></div>`;
      renderBridge(root.querySelector('#gn-bridge')!, m);
      onInput(root, 'gn-fee', (v) => set({ ...p, fee: v }));
      onInput(root, 'gn-carry', (v) => set({ ...p, carry: v }));
    });
  },
};

// ------------------------------------------------------------------ 15. net to gross

const PUBLIC_PRESET = 'public-advent-vi';

const netGross: Widget<Record<string, never>> = {
  init: () => ({}),
  input: () => PRESETS.find((x) => x.id === PUBLIC_PRESET)!.input,
  render(root) {
    const preset = PRESETS.find((x) => x.id === PUBLIC_PRESET)!;
    const input = preset.input;
    const m = computeMetrics(input, runFund(input));
    root.innerHTML = '<div id="ng-mount"></div>';
    renderNetToGross(root.querySelector('#ng-mount')!, preset, m, false);
  },
};

export const STRUCTURE_WIDGETS = { structure, clawback, grossNet, netGross };
