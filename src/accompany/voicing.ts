import type { Complexity, PlanChord } from './progression'
import { pcOf, percentile } from './played'

// Which notes the band's piano and bass actually play.
//
// Three rules, in order of how much they matter behind a soloist:
// 1. Stay out of your way: the piano lives under your lowest notes, the bass
//    under that, and any voicing note a semitone off a note you are holding
//    (that is not in the chord) is dropped on the spot.
// 2. Move as little as possible: from all inversions in the window, the one
//    nearest the previous voicing. Common tones stay, the rest step.
// 3. Say the chord with few notes: a triad, a seventh chord, or the rootless
//    3-5-7-9 / 7-9-3-5 shapes once it is rich — the bass already has the root.

export type Window = { low: number; high: number }
export type Register = { piano: Window; bass: Window; shellOnly: boolean }

/** E2..C5: the comping register. */
export const PIANO_FLOOR = 40
export const PIANO_CEIL = 72
/** E1..C3. */
export const BASS_FLOOR = 28
export const BASS_CEIL = 48
/** Narrowest window that still takes a four-note voicing. */
const MIN_SPAN = 12

/**
 * Where the band may play, from where you have been playing (the last ~8 s of
 * notes). The piano's top note stays 3 semitones under your 10th percentile;
 * the bass 5 under it. If you are all over the keyboard, the piano drops to a
 * quiet two-note shell and the bass goes down an octave.
 */
export function registerFor(yours: number[]): Register {
  if (yours.length === 0) {
    return { piano: { low: 48, high: 67 }, bass: { low: 33, high: BASS_CEIL }, shellOnly: false }
  }
  const p10 = percentile(yours, 0.1)
  const top = Math.min(PIANO_CEIL, p10 - 3)
  if (top - PIANO_FLOOR >= MIN_SPAN) {
    // Not lower than it needs to be: close voicings get muddy under C3.
    const piano = { low: Math.max(PIANO_FLOOR, top - 17), high: top }
    return { piano, bass: { low: BASS_FLOOR, high: Math.min(BASS_CEIL, p10 - 5) }, shellOnly: false }
  }
  return { piano: { low: 45, high: 57 }, bass: { low: BASS_FLOOR, high: BASS_FLOOR + 12 }, shellOnly: true }
}

/** The pitch classes to voice, root first in the chord's own order. */
export function voiceTones(chord: PlanChord, complexity: Complexity, shellOnly: boolean): number[] {
  const t = chord.tones
  const fifth = (chord.root + 7) % 12
  if (shellOnly) {
    // 3rd and 7th: the two notes that make the quality. A triad keeps its fifth instead.
    const third = t[1]
    return t.length >= 4 ? [third, t[3]] : [third, t[2] ?? fifth]
  }
  if (complexity === 1) return t.slice(0, 3)
  if (complexity === 2) return t.slice(0, 4)
  let rootless = t.length >= 5 ? t.slice(1) : t
  if (rootless.length > 4) rootless = rootless.filter((pc) => pc !== fifth)
  return rootless.slice(0, 4)
}

/** Every close-position inversion of `pcs` that fits in the window. */
export function closedVoicings(pcs: number[], win: Window): number[][] {
  const out: number[][] = []
  const uniq = [...new Set(pcs)]
  for (let r = 0; r < uniq.length; r++) {
    const rot = [...uniq.slice(r), ...uniq.slice(0, r)]
    // Order the rotation by pitch above its bottom note, so it stacks closed.
    const bottom = rot[0]
    const order = [...rot].sort((a, b) => ((a - bottom + 12) % 12) - ((b - bottom + 12) % 12))
    for (let base = win.low - 12; base <= win.high; base++) {
      if (pcOf(base) !== bottom) continue
      const stack = order.map((pc) => base + ((pc - bottom + 12) % 12))
      if (stack[0] >= win.low && stack[stack.length - 1] <= win.high) out.push(stack)
    }
  }
  return out
}

/** Total semitones moved, voice by voice. Uneven counts match each new note to its nearest old one. */
export function movement(from: number[], to: number[]): number {
  if (from.length === to.length) {
    const a = [...from].sort((x, y) => x - y)
    const b = [...to].sort((x, y) => x - y)
    return a.reduce((s, x, i) => s + Math.abs(x - b[i]), 0)
  }
  return to.reduce((s, x) => s + Math.min(...from.map((y) => Math.abs(x - y))), 0)
}

const sameNotes = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i])
const samePcs = (a: number[], b: number[]) => {
  const s = (xs: number[]) => [...new Set(xs.map(pcOf))].sort((x, y) => x - y).join()
  return s(a) === s(b)
}
const meanOf = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length

/**
 * The voicing for a chord: the inversion nearest the previous one, inside the
 * window. Pure.
 *
 * The same chord again (a held bar, a vamp, a push re-struck) is re-voiced:
 * the nearest OTHER inversion, leaning back toward the middle of the window so
 * a long vamp rocks between two or three shapes instead of creeping up the
 * keyboard. A pianist does not strike the identical block four bars running.
 * `revoice: false` keeps the plain nearest-voicing rule.
 */
export function voice(pcs: number[], prev: number[] | null, win: Window, revoice = true): number[] {
  let candidates = closedVoicings(pcs, win)
  if (candidates.length === 0) {
    // A window too narrow for the shape: let the top poke out rather than go silent.
    candidates = closedVoicings(pcs, { low: win.low, high: win.high + 12 })
  }
  if (candidates.length === 0) return []
  const center = (win.low + win.high) / 2
  const cost = (v: number[]) =>
    prev && prev.length ? movement(prev, v) : Math.abs(meanOf(v) - center)
  if (revoice && prev && prev.length && samePcs(prev, pcs)) {
    const others = candidates.filter((v) => !sameNotes(v, [...prev].sort((x, y) => x - y)))
    if (others.length) {
      const near = (v: number[]) => movement(prev, v) + 0.25 * Math.abs(meanOf(v) - center)
      return others.reduce((best, v) => (near(v) < near(best) ? v : best))
    }
  }
  return candidates.reduce((best, v) => (cost(v) < cost(best) ? v : best))
}

/**
 * Drops any voicing note a semitone (or a semitone and an octave) from a note
 * you are holding, when your note is not in the chord: a ♭9 rub against your
 * melody is the one sound a band must never add. Pure.
 */
export function avoidClashes(voicing: number[], held: number[], chordTones: number[]): number[] {
  const foreign = held.filter((h) => !chordTones.includes(pcOf(h)))
  return voicing.filter((v) => !foreign.some((h) => [1, 13].includes(Math.abs(v - h))))
}

/** The bass note for a root: nearest the previous one, inside the window. */
export function bassNote(rootPc: number, win: Window, prev: number | null): number {
  const options: number[] = []
  for (let m = win.low; m <= win.high; m++) if (pcOf(m) === rootPc) options.push(m)
  if (options.length === 0) return win.low + ((rootPc - pcOf(win.low) + 12) % 12)
  // Without a previous note, the lower octave: a bass sits low.
  const target = prev ?? win.low
  return options.reduce((best, m) => (Math.abs(m - target) < Math.abs(best - target) ? m : best))
}
