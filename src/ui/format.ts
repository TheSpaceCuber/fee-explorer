/** Display helpers. Only the UI rounds numbers. The engine keeps full precision. */

export const money = (x: number, digits = 1) => {
  const text = Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  // Sign before the currency (−$85.0m, not $-85.0m), and no sign on a rounded zero.
  return `${x < 0 && Number(text.replace(/,/g, '')) !== 0 ? '−' : ''}$${text}m`;
};

export const pct = (x: number | null, digits = 1) => {
  if (x === null || !Number.isFinite(x)) return '—';
  const v = (x * 100).toFixed(digits);
  // toFixed(-0.00001) gives "-0.0"; a sign on a rounded zero is just noise.
  return `${Number(v) === 0 ? (0).toFixed(digits) : v}%`;
};

export const multiple = (x: number | null) => (x === null || !Number.isFinite(x) ? '—' : `${x.toFixed(2)}x`);

export const shortDate = (iso: string) => {
  const [y, m] = iso.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[Number(m) - 1]} ${y}`;
};

/** Escape user-typed text (LP names) before it goes into innerHTML. */
export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
