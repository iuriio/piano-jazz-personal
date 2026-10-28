import type { Hit } from './patterns'
import { median, type PlayedNote } from './played'

// How the band plays what the patterns say: the touch, not the notes.
//
// patterns.ts decides WHEN the band plays; this decides HOW HARD and HOW
// TOGETHER. A human pianist behind a soloist does four things a sequencer does
// not, and each is a rule here, not noise:
//
// 1. The phrase breathes. Four bars build into the third and relax at the
//    cadence; the B section of the little tune sits a notch higher; the end of
//    the 16 bars falls away. (arcFor)
// 2. The band listens. Play louder or busier and it rises with you; go sparse
//    and soft and it thins out and gets out of the way. (energyOf)
// 3. A chord is not one event. It rolls up from the bottom by a few ms, the top
//    note sings over the inner ones, and a ghost is a brush of two notes, not a
//    full block. (spread)
// 4. Timing has a personality per part: the piano a little behind, the bass on
//    the beat and leaning into the downbeat. (feel, in patterns.ts)
//
// All of it is pure: the same seed and the same playing give the same music.

/** Neutral energy: what the band assumes when it has heard nothing to follow. */
export const NEUTRAL_ENERGY = 0.5

/** Velocity multiplier per bar of a 4-bar phrase: settle, move, build, relax at the cadence. */
const BAR_ARC = [0.94, 1.0, 1.12, 0.9]
/** Per section of A A′ B A″: the B lifts, the last A comes home. */
const SECTION_ARC = [0.95, 1.0, 1.08, 1.02]

/**
 * The phrase's dynamic shape, as a velocity multiplier for a bar. Phrase index
 * runs through the 16-bar form (A A′ B A″); the very last bar of the form
 * drops further, so a chorus ends like a breath out rather than a wall.
 */
export function arcFor(phrase: number, bar: number): number {
  const section = ((phrase % 4) + 4) % 4
  const b = Math.max(0, Math.min(3, bar))
  const endOfForm = section === 3 && b === 3 ? 0.92 : 1
  return BAR_ARC[b] * SECTION_ARC[section] * endOfForm
}

/** Velocity multiplier for an energy (0..1): 0.78 when you whisper, 1.22 when you dig in. */
export function energyScale(energy: number): number {
  return 0.78 + 0.44 * clamp01(energy)
}

/**
 * How hard and how busy you are playing, 0..1, from the notes of the last
 * `windowMs`. Half from how many attacks a second (6+ is everything), half from
 * your median velocity (30 → 0, 110 → 1). Silence is 0: the band thins out
 * when you stop. Pure.
 */
export function energyOf(played: PlayedNote[], now: number, windowMs = 4000): number {
  const recent = played.filter((n) => n.on <= now && now - n.on <= windowMs)
  if (recent.length === 0) return 0
  // Notes struck together (a chord) are one attack.
  const ons = recent.map((n) => n.on).sort((a, b) => a - b)
  let attacks = 0
  let prev = Number.NEGATIVE_INFINITY
  for (const t of ons) {
    if (t - prev >= 50) attacks++
    prev = t
  }
  const rate = attacks / (windowMs / 1000)
  const density = clamp01(rate / 6)
  const loud = clamp01((median(recent.map((n) => n.velocity)) - 30) / 80)
  return clamp01(0.5 * density + 0.5 * loud)
}

/** One note of a chord, as it should sound. */
export type ChordNote = {
  midi: number
  /** After the hit's own time: the roll. */
  delayMs: number
  velocity: number
}

/** The widest a chord ever rolls, bottom note to top, in ms. */
export const MAX_ROLL_MS = 25

/**
 * A voicing played by hands, not by a sequencer. Pure given `rand`.
 *
 * - Roll: bottom to top, the spread scaled to the gesture — a ghost or a short
 *   stab nearly together (≤ 8 ms), a held chord 8–18 ms, a long or pad-style
 *   chord up to 25 ms. One time in eight the hands land together.
 * - Balance: the top note (the one you hear as the comping's melody) a bit
 *   louder, the inner voices softer, the bottom in between.
 * - A ghost is just the top two notes: a brush, not a block.
 */
export function spread(voicing: number[], hit: Hit, velocity: number, rand: () => number): ChordNote[] {
  const sorted = [...voicing].sort((a, b) => a - b)
  if (sorted.length === 0) return []
  const notes = hit.ghost ? sorted.slice(-2) : sorted
  const n = notes.length
  const [lo, hi] = hit.ghost || hit.dur <= 0.6 ? [2, 8] : hit.dur >= 2 || hit.part === 'pad' ? [12, MAX_ROLL_MS] : [8, 18]
  const together = rand() < 0.125
  const total = n < 2 || together ? 0 : lo + rand() * (hi - lo)
  // Uneven steps, but always upward: cumulative random weights normalised to the total.
  const steps = notes.map((_, i) => (i === 0 ? 0 : 0.6 + rand() * 0.8))
  const sum = steps.reduce((a, b) => a + b, 0) || 1
  let acc = 0
  return notes.map((midi, i) => {
    acc += steps[i]
    const top = i === n - 1
    const bottom = i === 0
    const weight = n === 1 || top ? 1.1 : bottom ? 0.97 : 0.86
    return {
      midi,
      delayMs: (acc / sum) * total,
      velocity: Math.round(Math.max(1, Math.min(127, velocity * weight))),
    }
  })
}

function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0
}
