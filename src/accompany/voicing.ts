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
//
// And under all three, the low end belongs to the bass. An arranger's low
// interval limits keep the voicing clear: nothing under C3, no third or
// seventh under D3, no close seconds low down. When your left hand is already
// in that space, the piano thins to a shell or moves up into the gap between
// your hands; it never dives under C3 to get out of your way.

export type Window = { low: number; high: number }
export type Register = {
  piano: Window
  bass: Window
  shellOnly: boolean
  /**
   * How much of the bass to play, 0.5..1: lighter once you play your own bass
   * notes. A gain multiplier for the bass part.
   */
  bassLevel: number
}

/** C3..C5: the comping register. Close voicings get muddy under C3. */
export const PIANO_FLOOR = 48
export const PIANO_CEIL = 72
/** D3: the third and the seventh, the notes that name the chord, sit at or over it. */
export const GUIDE_FLOOR = 50
/** E1..B2: the bass's own octave and a half, wholly under the piano's floor. */
export const BASS_FLOOR = 28
export const BASS_CEIL = 47
/** Narrowest window that still takes a four-note voicing. */
const MIN_SPAN = 12
/** Narrowest window a shell goes in without poking out the top: any 3rd–7th pair fits in 11. */
const SHELL_SPAN = 11
/** Semitones the piano keeps clear of your notes, and the bass under your low notes. */
const PIANO_GAP = 3
const BASS_GAP = 5
/**
 * Your 10th percentile from E3 down to E2: the bass backs off from full to
 * half as you take over its register. Going up out of your way would put it
 * among the piano's guide tones and turn your chord over; lighter keeps the
 * root under you without doubling your line.
 */
const YOUR_BASS_FROM = 52
const YOUR_BASS_TO = 40
const BASS_LEVEL_MIN = 0.5

/**
 * Low interval limits, by interval in semitones: the lowest an interval's
 * bottom note may sit before it turns to mud (the arranger's table: a minor
 * second no lower than E3, a minor third C3, a fifth B♭1). Index 0 is unused.
 */
export const LOW_INTERVAL_LIMIT = [0, 52, 51, 48, 46, 46, 47, 34, 43, 41, 41, 41]

/** True if every interval in the voicing sits at or above its low interval limit. Pure. */
export function clearOfMud(voicing: number[]): boolean {
  const v = [...voicing].sort((a, b) => a - b)
  for (let i = 0; i + 1 < v.length; i++) {
    const iv = v[i + 1] - v[i]
    if (iv > 0 && iv < 12 && v[i] < LOW_INTERVAL_LIMIT[iv]) return false
  }
  return true
}

/**
 * Where the band may play, from where you have been playing (the last ~8 s of
 * notes). The piano's top note stays 3 semitones under your 10th percentile,
 * down to C3; the bass 5 under it, inside its own E1..B2.
 *
 * When there is not an octave of room between C3 and your low notes, your left
 * hand is in the comping register. The piano then sits in the gap between your
 * hands if there is one wide enough, full voicings in an octave of it, a shell
 * in less; otherwise it plays a quiet two-note shell from D3 up.
 */
export function registerFor(yours: number[]): Register {
  if (yours.length === 0) {
    return { piano: { low: 48, high: 67 }, bass: { low: 33, high: BASS_CEIL }, shellOnly: false, bassLevel: 1 }
  }
  const p10 = percentile(yours, 0.1)
  const bassTop = Math.min(BASS_CEIL, p10 - BASS_GAP)
  const bass = bassTop - BASS_FLOOR >= MIN_SPAN ? { low: BASS_FLOOR, high: bassTop } : { low: BASS_FLOOR, high: BASS_FLOOR + MIN_SPAN }
  const t = Math.max(0, Math.min(1, (YOUR_BASS_FROM - p10) / (YOUR_BASS_FROM - YOUR_BASS_TO)))
  const band = { bass, bassLevel: 1 - (1 - BASS_LEVEL_MIN) * t }

  const top = Math.min(PIANO_CEIL, p10 - PIANO_GAP)
  if (top - PIANO_FLOOR >= MIN_SPAN) {
    // Not lower than it needs to be: an octave and a half under you at most.
    return { piano: { low: Math.max(PIANO_FLOOR, top - 17), high: top }, shellOnly: false, ...band }
  }
  const gap = gapBetween(yours)
  if (gap && gap.high - gap.low >= MIN_SPAN) return { piano: gap, shellOnly: false, ...band }
  if (gap && gap.high - gap.low >= SHELL_SPAN) return { piano: gap, shellOnly: true, ...band }
  return { piano: { low: GUIDE_FLOOR, high: GUIDE_FLOOR + SHELL_SPAN }, shellOnly: true, ...band }
}

/**
 * The widest stretch of the comping register with none of your notes in it,
 * kept 3 semitones clear of them on both sides: the room between your hands.
 * Null when there is none. Pure.
 */
export function gapBetween(yours: number[]): Window | null {
  const notes = [...new Set(yours)].sort((a, b) => a - b)
  let best: Window | null = null
  for (let i = 0; i + 1 < notes.length; i++) {
    const low = Math.max(PIANO_FLOOR, notes[i] + PIANO_GAP)
    const high = Math.min(PIANO_CEIL, notes[i + 1] - PIANO_GAP)
    if (high > low && (!best || high - low > best.high - best.low)) best = { low, high }
  }
  return best
}

/**
 * Pitch classes to voice, and which of them are guide tones (the 3rd and the
 * 7th). `guides` rides along off the array's enumerable keys, so the result
 * still reads, sorts and compares as a plain list of pitch classes.
 */
export type Tones = number[] & { readonly guides?: readonly number[] }

function withGuides(pcs: number[], chord: number[]): Tones {
  const guides = [chord[1], chord[3]].filter((pc) => pc !== undefined && pcs.includes(pc))
  return Object.defineProperty(pcs, 'guides', { value: guides, enumerable: false })
}

/** The pitch classes to voice, root first in the chord's own order. */
export function voiceTones(chord: PlanChord, complexity: Complexity, shellOnly: boolean): Tones {
  const t = chord.tones
  const fifth = (chord.root + 7) % 12
  if (shellOnly) {
    // 3rd and 7th: the two notes that make the quality. A triad keeps its fifth instead.
    const third = t[1]
    return withGuides(t.length >= 4 ? [third, t[3]] : [third, t[2] ?? fifth], t)
  }
  if (complexity === 1) return withGuides(t.slice(0, 3), t)
  if (complexity === 2) return withGuides(t.slice(0, 4), t)
  let rootless = t.length >= 5 ? t.slice(1) : t
  if (rootless.length > 4) rootless = rootless.filter((pc) => pc !== fifth)
  return withGuides(rootless.slice(0, 4), t)
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
 * window, among those clear of mud (see clearOfMud; with `pcs` from
 * voiceTones, also no guide tone under D3). A window with no clear shape keeps
 * the muddier one rather than leaving it. Pure.
 *
 * The same chord again (a held bar, a vamp, a push re-struck) is re-voiced:
 * the nearest OTHER inversion, leaning back toward the middle of the window so
 * a long vamp rocks between two or three shapes instead of creeping up the
 * keyboard. A pianist does not strike the identical block four bars running.
 * `revoice: false` keeps the plain nearest-voicing rule.
 */
export function voice(pcs: Tones, prev: number[] | null, win: Window, revoice = true): number[] {
  const guides = pcs.guides ?? []
  const clear = (v: number[]) => clearOfMud(v) && v.every((m) => m >= GUIDE_FLOOR || !guides.includes(pcOf(m)))
  let candidates = closedVoicings(pcs, win)
  if (candidates.length === 0) {
    // A window too narrow for the shape: let the top poke out rather than go silent.
    candidates = closedVoicings(pcs, { low: win.low, high: win.high + 12 })
  }
  if (candidates.length === 0) return []
  if (candidates.some(clear)) candidates = candidates.filter(clear)
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
