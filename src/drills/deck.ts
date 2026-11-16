// The order of a speed drill: every item once per pass, in random order, and an
// item you missed comes back a few questions later instead of a whole pass later.

export function shuffle<T>(items: readonly T[], rand: () => number = Math.random): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Takes the next item off the queue. A queue that ran out (or whose items were
 * all switched off) refills with a fresh shuffle, and the same item is never
 * asked twice in a row when there is another one to ask.
 */
export function draw<T>(
  queue: readonly T[],
  all: readonly T[],
  last: T | null,
  rand: () => number = Math.random,
): { item: T; queue: T[] } {
  let q = queue.filter((x) => all.includes(x))
  if (q.length === 0) q = shuffle(all, rand)
  if (q[0] === last && q.length > 1) {
    const other = q.findIndex((x) => x !== last)
    ;[q[0], q[other]] = [q[other], q[0]]
  }
  return { item: q[0], queue: q.slice(1) }
}

/** Puts an item back `gap` questions from now, replacing any later place it had. */
export function requeue<T>(queue: readonly T[], item: T, gap: number): T[] {
  const q = queue.filter((x) => x !== item)
  q.splice(Math.min(gap, q.length), 0, item)
  return q
}
