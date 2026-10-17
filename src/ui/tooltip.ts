/** One shared tooltip element for every chart on every page. */
const tooltip = () => document.getElementById('tooltip')!;

export function showTooltipHtml(e: MouseEvent, html: string): void {
  const t = tooltip();
  t.innerHTML = html;
  t.hidden = false;
  // Keep it on screen: flip to the left of the cursor near the right edge.
  const pad = 14;
  const { width, height } = t.getBoundingClientRect();
  const left = e.clientX + pad + width > window.innerWidth ? e.clientX - pad - width : e.clientX + pad;
  const top = Math.min(e.clientY + pad, window.innerHeight - height - 8);
  t.style.left = `${Math.max(8, left)}px`;
  t.style.top = `${top}px`;
}

export function hideTooltip(): void {
  tooltip().hidden = true;
}
