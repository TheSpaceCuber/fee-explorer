/**
 * Which lessons you've finished, kept in this browser only (localStorage).
 * Storage can be unavailable (private windows, blocked site data), so every access is wrapped:
 * the course works fine without it, it just won't remember.
 */
const KEY = 'fee-explorer:done';

function read(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

let done = read();

export const isDone = (slug: string) => done.has(slug);

export function markDone(slug: string): void {
  done.add(slug);
  try {
    localStorage.setItem(KEY, JSON.stringify([...done]));
  } catch {
    /* storage unavailable: keep the in-memory copy only */
  }
}

export function resetProgress(): void {
  done = new Set();
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
