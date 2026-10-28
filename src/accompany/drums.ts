import { arcFor, energyScale } from './groove'
import type { Style } from './patterns'
import { rng, subSeed } from './played'

// What the drummer plays in a bar. Pure: the same seed and the same playing
// give the same groove.
//
// A drummer behind a piano trio is mostly time and colour, not fills. So, per
// style:
//
// - pad: in free time nothing (there is no grid to keep). With a pulse, a soft
//   ride on 1 (and 3 once you play with some weight), the hi-hat foot joining
//   on 2 and 4 when you dig in. A ballad, not a beat.
// - even: straight eighths on a closed hat, kick on 1 and 3 (sometimes the
//   "and" of 2), a cross-stick on 2 and 4 that turns into a light snare when
//   you play harder. The phrase's last bar opens the hat on the "and" of 4.
// - comp: the jazz ride ("ding, ding-a, ding, ding-a") with 2 and 4
//   accented, the hi-hat foot on 2 and 4, a feathered kick on every beat
//   (felt more than heard), and now and then a quiet snare comp on an off-beat
//   — more of them the busier you play.
// - walk: the same ride, leaning harder on 2 and 4, with a little more snare
//   chatter, and a drop on the "and" of 4 into the next phrase.
//
// Positions are written straight, in beats from the bar's start; the caller
// swings the off-beats (swungAt) with the same swing as the band, which is the
// player's measured swing when there is one.

export type DrumPiece = 'kick' | 'snare' | 'rim' | 'hat' | 'chick' | 'open' | 'ride' | 'bell'

export type DrumHit = {
  /** Beats from the bar's start, straight. */
  at: number
  piece: DrumPiece
  /** MIDI velocity, 1..127. */
  velocity: number
  /** Lean against the grid, ms: negative on top of the beat, positive behind. */
  lateMs: number
}

export type DrumBarOpts = {
  style: Style
  /** Free time: the pad plays rubato, and drums have nothing to keep. */
  free: boolean
  /** Phrase index in the form, and bar (0..3) inside it: the dynamic arc. */
  phrase: number
  bar: number
  /** Bars since the band started: what makes each bar's dice its own. */
  barCount: number
  /** How hard and busy you are playing, 0..1 (groove.ts energyOf). */
  energy: number
  /** The band's base velocity (about half your touch). */
  baseVel: number
  seed: number
}

/** The touch each piece keeps relative to the kit's base, before accents. */
const WEIGHT: Record<DrumPiece, number> = {
  kick: 0.8,
  snare: 0.7,
  rim: 0.75,
  hat: 0.6,
  chick: 0.6,
  open: 0.6,
  ride: 0.7,
  bell: 0.6,
}

/** Below this a hit is not worth sounding: the floor per piece keeps feathering audible. */
const FLOOR: Partial<Record<DrumPiece, number>> = { kick: 16, chick: 18, snare: 14, ride: 18, hat: 14 }

const RIDE: [number, number][] = [
  // [at, accent]: 2 and 4 lean, the skip notes sit under them.
  [0, 0.86],
  [1, 1.06],
  [1.5, 0.62],
  [2, 0.86],
  [3, 1.06],
  [3.5, 0.62],
]

export function drumBar(o: DrumBarOpts): DrumHit[] {
  if (o.free) return []
  const r = rng(subSeed(o.seed, 7000 + o.barCount))
  const energy = Math.max(0, Math.min(1, Number.isFinite(o.energy) ? o.energy : 0.5))
  // A drummer's touch, from the band's: cymbals and drums carry over a piano.
  const base = Math.max(40, Math.min(100, o.baseVel * 1.4)) * arcFor(o.phrase, o.bar) * energyScale(energy)
  const lastBar = o.bar === 3
  const hits: DrumHit[] = []
  const add = (at: number, piece: DrumPiece, accent: number, lean = 0) => {
    const v = base * WEIGHT[piece] * accent + (r() * 2 - 1) * 4
    hits.push({
      at,
      piece,
      velocity: Math.round(Math.max(FLOOR[piece] ?? 1, Math.min(127, v))),
      lateMs: lean + (r() * 2 - 1) * 2,
    })
  }

  switch (o.style) {
    case 'pad': {
      add(0, 'ride', 0.62, -1)
      if (energy >= 0.35) add(2, 'ride', 0.5, -1)
      if (energy >= 0.5) {
        add(1, 'chick', 0.45)
        add(3, 'chick', 0.45)
      }
      break
    }
    case 'even': {
      for (let i = 0; i < 8; i++) {
        const at = i / 2
        if (lastBar && at === 3.5) add(at, 'open', 0.8)
        else add(at, 'hat', i % 2 === 0 ? 0.95 : 0.7)
      }
      add(0, 'kick', 1)
      add(2, 'kick', 0.85)
      if (r() < 0.35 + 0.3 * energy) add(2.5, 'kick', 0.6)
      const back: DrumPiece = energy >= 0.55 ? 'snare' : 'rim'
      add(1, back, 0.95, 2)
      add(3, back, 0.95, 2)
      break
    }
    case 'comp':
    case 'walk': {
      const walk = o.style === 'walk'
      for (const [at, accent] of RIDE) add(at, 'ride', walk && at % 2 === 1 ? accent * 1.06 : accent, -2)
      add(1, 'chick', 0.85)
      add(3, 'chick', 0.85)
      // Feathered: every beat, barely.
      for (let b = 0; b < 4; b++) add(b, 'kick', 0.3)
      // Snare comping: quiet off-beat answers, more of them when you are busy.
      const chance = (walk ? 0.3 : 0.18) + 0.45 * energy
      const spots = [0.5, 1.5, 2.5]
      const max = walk ? 2 : 1
      let n = 0
      for (const at of spots) {
        if (n >= max) break
        if (r() < chance / spots.length) {
          add(at, 'snare', 0.42, 4)
          n++
        }
      }
      // Into the next phrase: a drop on the "and" of 4.
      if (lastBar && (walk || r() < 0.5)) add(3.5, 'snare', 0.62, 3)
      break
    }
  }
  return hits.sort((a, b) => a.at - b.at)
}

/**
 * The velocity the sampled kit is played at, for a groove velocity.
 *
 * Compressed into 40..127 on purpose. The kit's recordings keep their real
 * dynamics (a pp hi-hat is 30 dB under an ff one) and smplr squares velocity
 * on top of that; uncompressed, a feathered kick or a soft ride falls out of
 * hearing entirely. The kit's preset writes its velocity layers in this same
 * compressed range, and evens out its layers' levels to 4 dB steps.
 */
export function kitVelocity(v: number): number {
  return Math.round(40 + (Math.max(0, Math.min(127, v)) * 87) / 127)
}

/**
 * How long each piece is let ring, in beats (null: the whole sample). The
 * ride is choked short of its natural wash so a steady pattern does not build
 * into a roar; the open hat closes on the next beat, as a foot would.
 */
export const DRUM_RING_BEATS: Record<DrumPiece, number | null> = {
  kick: null,
  snare: null,
  rim: null,
  hat: null,
  chick: null,
  open: 0.9,
  ride: 2.5,
  bell: 2,
}
