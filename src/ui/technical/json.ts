import { esc } from '../format';

/** Pretty-printed JSON with light syntax colouring (keys, strings, numbers, true/false/null). */
export function jsonHtml(value: unknown): string {
  const text = esc(JSON.stringify(value, null, 2) ?? 'null');
  // After escaping, quotes are &quot;. Match a string, optionally followed by ":" (then it's a key).
  return text.replace(
    /(&quot;(?:[^&]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/g,
    (m, str: string | undefined, colon: string | undefined, lit: string | undefined, num: string | undefined) => {
      if (str) return colon ? `<span class="j-key">${str}</span>${colon}` : `<span class="j-str">${str}</span>`;
      if (lit) return `<span class="j-lit">${lit}</span>`;
      if (num) return `<span class="j-num">${num}</span>`;
      return m;
    },
  );
}
