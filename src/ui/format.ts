/** Display helpers. Only the UI rounds numbers. The engine keeps full precision. */

export const money = (x: number, digits = 1) =>
  `$${x.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}m`;

export const pct = (x: number | null, digits = 1) =>
  x === null || !Number.isFinite(x) ? '—' : `${(x * 100).toFixed(digits)}%`;

export const multiple = (x: number | null) => (x === null || !Number.isFinite(x) ? '—' : `${x.toFixed(2)}x`);

export const shortDate = (iso: string) => {
  const [y, m] = iso.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[Number(m) - 1]} ${y}`;
};

/** Escape user-typed text (LP names) before it goes into innerHTML. */
export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
