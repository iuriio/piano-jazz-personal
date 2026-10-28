// What the accompaniment knows about your playing, in the one shape every pure
// module here reads. The listener builds these from the raw MIDI stream; the
// fixtures build them from a seed. Nothing in this folder that estimates or
// plans touches MIDI or the clock directly, so all of it runs in a test.

export type PlayedNote = {
  midi: number
  velocity: number
  /** performance.now() of the note-on. */
  on: number
  /** performance.now() of the moment it stopped sounding (pedal included). NaN while it sounds. */
  off: number
  /** Lowest note sounding at the moment it was struck: what a bass line is made of. */
  lowest: boolean
}

export const pcOf = (midi: number) => ((midi % 12) + 12) % 12

/**
 * Small seeded generator (mulberry32). Everything that chooses — the fixtures,
 * the planner, the patterns, the humanisation — draws from one of these, so the
 * same seed always gives the same music and a test can pin it down.
 */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Mixes a seed with a counter, for a fresh but reproducible stream per bar or phrase. */
export function subSeed(seed: number, n: number): number {
  return (Math.imul(seed ^ 0x9e3779b9, 31) + Math.imul(n + 1, 0x85ebca6b)) >>> 0
}

export function median(xs: number[]): number {
  if (xs.length === 0) return Number.NaN
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return Number.NaN
  const s = [...xs].sort((a, b) => a - b)
  const i = Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))
  return s[i]
}
