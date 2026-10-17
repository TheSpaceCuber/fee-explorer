/**
 * Deterministic ids and fingerprints.
 *
 * Two kinds of id appear in the pipeline:
 *  - Content-addressed ids (terms versions, cash-flow batches): a hash of the content itself. The
 *    same terms always get the same id, so "did the terms change?" is just "is the id new?".
 *  - Sequence ids (calc runs): run_0001, run_0002, … Runs are events in time, not content, so they
 *    are numbered. A real database would use a sequence or a UUID.
 *
 * The hash is FNV-1a (32-bit): tiny, fast and dependency-free. It's fine for an illustration. A
 * production system would use SHA-256, where accidental collisions are practically impossible.
 */

/** JSON with object keys sorted at every level, so equal data always gives the same string. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as object)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/** FNV-1a 32-bit hash of a string, as 8 hex characters. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    // Multiply by the FNV prime 16777619, kept to 32 bits. Math.imul does 32-bit integer multiply.
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export const fingerprint = (value: unknown) => fnv1a(canonicalJson(value));

export const runId = (n: number) => `run_${String(n).padStart(4, '0')}`;
