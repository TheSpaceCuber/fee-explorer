import type { FundInput } from '../engine';

/**
 * The small interactives inside lessons. Each one:
 *   - keeps its own parameters (the few controls the lesson needs),
 *   - turns them into a fund with `input(params)` (also used by tests and "Open in Explore"),
 *   - draws itself with `render`, calling `set` when a control changes.
 * All numbers come from the engine. A widget never calculates money itself.
 */
export interface Widget<P> {
  init: () => P;
  input: (p: P) => FundInput;
  render: (root: HTMLElement, p: P, set: (p: P) => void) => void;
}

// ------------------------------------------------------------------ shared bits

export const slider = (id: string, label: string, value: number, min: number, max: number, step: number, shown: string) => `
  <div class="field">
    <label for="${id}">${label} <span class="value">${shown}</span></label>
    <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}">
  </div>`;

export const segmented = (name: string, label: string, options: [string, string][], current: string) => `
  <div class="field" role="radiogroup" aria-label="${label}">
    <span class="label">${label}</span>
    <div class="segmented">${options
      .map(([v, t]) => `<label><input type="radio" name="${name}" value="${v}" ${v === current ? 'checked' : ''}>${t}</label>`)
      .join('')}</div>
  </div>`;

export const onInput = (root: HTMLElement, id: string, f: (v: number) => void) =>
  root.querySelector<HTMLInputElement>(`#${id}`)!.addEventListener('input', (e) => f(Number((e.target as HTMLInputElement).value)));
export const onRadio = (root: HTMLElement, name: string, f: (v: string) => void) =>
  root.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach((r) => r.addEventListener('change', () => f(r.value)));

export const stat = (label: string, value: string, note = '') =>
  `<div class="tile"><div class="t-label">${label}</div><div class="t-value">${value}</div>${note ? `<div class="t-note">${note}</div>` : ''}</div>`;

/** Keep focus on the control being dragged when the widget re-renders. */
export function keepFocus(root: HTMLElement, draw: () => void) {
  const id = (document.activeElement as HTMLElement | null)?.id;
  draw();
  if (id) root.querySelector<HTMLElement>(`#${id}`)?.focus();
}

