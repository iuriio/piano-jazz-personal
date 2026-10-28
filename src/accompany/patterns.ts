import { NEUTRAL_ENERGY, arcFor, energyScale } from './groove'
import { pcOf, rng, subSeed } from './played'
import type { Window } from './voicing'

// When the band plays inside a bar.
//
// A vocabulary, not dice: the Charleston (1 and the "and" of 2), its reverse,
// the push on the "and" of 4 into the next chord, stabs on 2 and 4, a long
// note, and space. One or two attacks a bar is plenty behind a soloist. Each
// phrase draws a few patterns from its style's set for its tempo band (iReal's
// < 100 / 100–139 / 140+), and no bar repeats the rhythm of the bar before it.
//
// Then the bar is PLAYED, not pasted (perform): the phrase's dynamic arc and
// your energy set the touch; a push into the next bar ties over the bar line,
// so the next bar does not strike that chord again; the last bar of a phrase
// may end in a little fill; soft, sparse playing thins the band out, busy
// playing brings in ghost notes; and each bar picks its articulation — short
// stabs, written lengths, or legato holds. All seeded, all pure.

export type Style = 'pad' | 'even' | 'comp' | 'walk'
export const STYLES: Style[] = ['pad', 'even', 'comp', 'walk']

export type Part = 'piano' | 'bass' | 'pad'

export type Hit = {
  /** Beats from the start of the bar, written straight; swing moves the off-beats when scheduled. */
  at: number
  dur: number
  part: Part
  /** Relative weight, 1 = the bar's normal touch. */
  vel: number
  /** What to play: the voicing, the root, the fifth, or the n-th note of a walking line. */
  what: 'chord' | 'root' | 'fifth' | 'walk'
  /** Plays the NEXT bar's chord: the push into the change. Held over the bar line. */
  ahead?: boolean
  /** A ghost: barely there. With spread() (groove.ts) only the top two notes sound. */
  ghost?: boolean
  /** A fixed lean for this hit, ms: negative pushes, positive lays back. Added by feel(). */
  shiftMs?: number
}

export type BarPattern = { id: string; hits: Hit[] }

export type PatternOpts = {
  /** How hard and busy you are playing, 0..1 (groove.ts energyOf). Default: neutral. */
  energy?: number
}

const p = (at: number, dur: number, vel = 1, ahead = false): Hit => ({ at, dur, part: 'piano', vel, what: 'chord', ahead })
const b = (at: number, dur: number, what: 'root' | 'fifth' = 'root', vel = 1): Hit => ({ at, dur, part: 'bass', vel, what })
const pad = (at: number, dur: number): Hit => ({ at, dur, part: 'pad', vel: 1, what: 'chord' })
const walk: Hit[] = [0, 1, 2, 3].map((at) => ({ at, dur: 0.9, part: 'bass', vel: at % 2 ? 0.92 : 1, what: 'walk' }))
const twoFeel = [b(0, 1.9), b(2, 1.9, 'fifth', 0.92)]
/** A push: the next chord on the "and" of 4, held over the bar line. */
const push = (vel = 0.9) => p(3.5, 1.9, vel, true)

const PATTERNS: Record<string, BarPattern> = Object.fromEntries(
  (
    [
      // pad: a held chord, with the piano now and then touching it, answering
      // it, or lifting into the next bar; the bass holds or says root–fifth.
      ['pad-hold', [pad(0, 4), b(0, 3.9)]],
      ['pad-two', [pad(0, 4), b(0, 1.9), b(2, 1.9, 'fifth', 0.9)]],
      ['pad-bell', [pad(0, 4), p(0, 2.4, 0.8), b(0, 3.9)]],
      ['pad-answer', [pad(0, 4), p(2, 1.9, 0.75), b(0, 1.9), b(2, 1.9, 'fifth', 0.88)]],
      ['pad-lift', [pad(0, 3.4), push(0.8), b(0, 3.4)]],
      ['pad-breath', [pad(0, 2.9), b(0, 2.9)]],
      // even: straight eighths, light, root–fifth underneath.
      ['even-push', [p(0, 1.4), p(1.5, 0.45, 0.8), p(2, 1.4), push(0.85), b(0, 1.4), b(1.5, 0.45, 'root', 0.8), b(2, 1.9, 'fifth')]],
      ['even-quarters', [p(0, 0.9), p(1, 0.5, 0.75), p(2, 0.9), p(3, 0.5, 0.75), ...twoFeel]],
      ['even-dotted', [p(0, 2.4), p(2.5, 1.4, 0.85), b(0, 2.4), b(2.5, 1.4, 'fifth')]],
      ['even-tresillo', [p(0, 1.4), p(1.5, 1.4, 0.85), p(3, 0.9, 0.9), b(0, 1.4), b(1.5, 1.4, 'fifth', 0.85), b(3, 0.9, 'root', 0.9)]],
      ['even-offbeats', [p(0.5, 0.45, 0.8), p(1.5, 0.45, 0.75), p(2.5, 0.45, 0.8), p(3.5, 0.45, 0.75), b(0, 1.9), b(2, 1.9)]],
      ['even-whole', [p(0, 3.8), ...twoFeel]],
      ['even-sync', [p(0, 0.9), p(1.5, 0.9, 0.8), p(3, 0.4, 0.7), b(0, 1.4), b(1.5, 0.4, 'root', 0.7), b(2, 1.9, 'fifth')]],
      ['even-backbeat', [p(1, 0.6, 0.85), p(3, 0.6, 0.85), b(0, 1.9), b(2, 1.4, 'fifth'), b(3.5, 0.4, 'root', 0.75)]],
      ['even-breath', [p(0, 1.9), push(0.85), b(0, 2.9)]],
      // comp: swing vocabulary over a two-feel bass.
      ['charleston', [p(0, 0.6), p(1.5, 0.45, 0.85), ...twoFeel]],
      ['reverse', [p(0.5, 0.45, 0.85), p(2, 0.9), ...twoFeel]],
      ['push', [p(0, 0.9), push(0.85), ...twoFeel]],
      ['space', [p(2, 0.9, 0.85), ...twoFeel]],
      ['long', [p(0, 2.9), ...twoFeel]],
      ['offbeat', [p(1.5, 0.45, 0.85), p(3, 0.7), ...twoFeel]],
      ['two-four', [p(1, 0.4, 0.9), p(3, 0.4, 0.9), ...twoFeel]],
      ['and-of-two', [p(1.5, 1.4, 0.9), ...twoFeel]],
      ['late-push', [p(2.5, 0.45, 0.8), push(0.9), ...twoFeel]],
      // walk: the same comping, sparser, over a walking line; sometimes the bass alone.
      ['walk-charleston', [p(0, 0.6), p(1.5, 0.45, 0.8), ...walk]],
      ['walk-space', [p(2, 0.9, 0.8), ...walk]],
      ['walk-push', [push(0.8), ...walk]],
      ['walk-reverse', [p(0.5, 0.45, 0.8), ...walk]],
      ['walk-two-four', [p(1, 0.4, 0.8), p(3, 0.4, 0.8), ...walk]],
      ['walk-and-of-two', [p(1.5, 1.4, 0.8), ...walk]],
      ['walk-long', [p(0, 1.9, 0.8), ...walk]],
      ['walk-rest', [...walk]],
    ] as [string, Hit[]][]
  ).map(([id, hits]) => [id, { id, hits }]),
)

/** Pattern sets per style, per tempo band: < 100, 100–139, 140+. */
const SETS: Record<Style, [string[], string[], string[]]> = {
  pad: [
    ['pad-hold', 'pad-two', 'pad-bell', 'pad-answer', 'pad-lift', 'pad-breath'],
    ['pad-hold', 'pad-two', 'pad-bell', 'pad-answer', 'pad-lift', 'pad-breath'],
    ['pad-hold', 'pad-two', 'pad-bell', 'pad-lift'],
  ],
  even: [
    ['even-push', 'even-quarters', 'even-dotted', 'even-tresillo', 'even-offbeats', 'even-sync', 'even-breath'],
    ['even-push', 'even-dotted', 'even-tresillo', 'even-offbeats', 'even-whole', 'even-sync', 'even-backbeat', 'even-breath'],
    ['even-dotted', 'even-whole', 'even-quarters', 'even-backbeat', 'even-breath'],
  ],
  comp: [
    ['charleston', 'reverse', 'long', 'push', 'space', 'and-of-two', 'two-four'],
    ['charleston', 'reverse', 'push', 'space', 'offbeat', 'two-four', 'and-of-two', 'late-push'],
    ['charleston', 'push', 'space', 'two-four', 'and-of-two'],
  ],
  walk: [
    ['walk-charleston', 'walk-space', 'walk-push', 'walk-reverse', 'walk-long', 'walk-and-of-two', 'walk-rest'],
    ['walk-charleston', 'walk-space', 'walk-push', 'walk-reverse', 'walk-two-four', 'walk-and-of-two', 'walk-rest'],
    ['walk-space', 'walk-push', 'walk-charleston', 'walk-two-four', 'walk-rest'],
  ],
}

export function tempoBand(bpm: number): 0 | 1 | 2 {
  return bpm < 100 ? 0 : bpm < 140 ? 1 : 2
}

/** The patterns a phrase draws on: three from its set, chosen by the phrase's seed. */
export function phraseSet(style: Style, bpm: number, phrase: number, seed: number): string[] {
  const all = SETS[style][tempoBand(bpm)]
  if (all.length <= 3) return all
  const r = rng(subSeed(seed, 1000 + phrase))
  const pool = [...all]
  const out: string[] = []
  while (out.length < 3) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0])
  return out
}

/** The written pattern a bar draws, before it is performed: never the previous bar's. Pure. */
export function basePatternFor(style: Style, bpm: number, phrase: number, bar: number, prevId: string | null, seed: number): BarPattern {
  const set = phraseSet(style, bpm, phrase, seed)
  const pool = set.length > 1 ? set.filter((id) => id !== prevId) : set
  const r = rng(subSeed(seed, phrase * 16 + bar))
  return PATTERNS[pool[Math.floor(r() * pool.length)]]
}

/**
 * The pattern for one bar, performed: the written pattern with this bar's
 * touch, ties, fill, space, ghosts and articulation. Pure: the same seed,
 * phrase, bar and energy always give the same bar. The id is the written
 * pattern's, which is what the no-repeat rule compares.
 */
export function patternFor(
  style: Style,
  bpm: number,
  phrase: number,
  bar: number,
  prevId: string | null,
  seed: number,
  opts: PatternOpts = {},
): BarPattern {
  const base = basePatternFor(style, bpm, phrase, bar, prevId, seed)
  return perform(base, style, phrase, bar, prevId, seed, opts.energy ?? NEUTRAL_ENERGY)
}

export function patternById(id: string): BarPattern | undefined {
  return PATTERNS[id]
}

// --- performing a bar -------------------------------------------------------------

/** A fresh, reproducible coin per bar and purpose. */
function coin(seed: number, phrase: number, bar: number, purpose: number): number {
  return rng(subSeed(seed ^ Math.imul(purpose + 1, 0x27d4eb2d), 20000 + phrase * 16 + bar))()
}

const isPiano = (h: Hit) => h.part === 'piano'
const attacks = (hits: Hit[]) => hits.filter((h) => isPiano(h) && !h.ghost).length

/**
 * How a bar ends: a fill (last bar of a phrase, more often at the end of the
 * form), an added push into the next chord, the written pattern's own push, or
 * nothing. Independent of energy, so the next bar can work out whether a chord
 * is already tied over into it. Pure.
 */
export function barEnding(style: Style, phrase: number, bar: number, base: BarPattern, seed: number): 'fill' | 'push' | 'written' | null {
  if (bar === 3 && coin(seed, phrase, bar, 1) < (((phrase % 4) + 4) % 4 === 3 ? 0.7 : 0.35)) return 'fill'
  if (base.hits.some((h) => h.ahead)) return 'written'
  const lateHit = base.hits.some((h) => isPiano(h) && h.at >= 3)
  const room = style === 'even' || attacks(base.hits) < 2
  const chance = (bar === 3 ? 0.35 : 0.15) * (style === 'pad' ? 0.6 : 1)
  if (!lateHit && room && coin(seed, phrase, bar, 2) < chance) return 'push'
  return null
}

/** Whether the bar before this one tied a pushed chord into it. */
export function tiedFrom(style: Style, phrase: number, bar: number, prevId: string | null, seed: number): boolean {
  const prev = prevId ? PATTERNS[prevId] : undefined
  if (!prev) return false
  const [ph, br] = bar > 0 ? [phrase, bar - 1] : [phrase - 1, 3]
  if (ph < 0) return false
  return barEnding(style, ph, br, prev, seed) !== null
}

function perform(base: BarPattern, style: Style, phrase: number, bar: number, prevId: string | null, seed: number, energy: number): BarPattern {
  const r = rng(subSeed(seed, 5000 + phrase * 16 + bar))
  const e = Math.max(0, Math.min(1, energy))
  let hits = base.hits.map((h) => ({ ...h }))
  const ending = barEnding(style, phrase, bar, base, seed)

  // 1. A chord pushed over the bar line is not struck again on 1.
  if (tiedFrom(style, phrase, bar, prevId, seed)) hits = hits.filter((h) => !(isPiano(h) && h.at < 0.25))

  // 2. How the bar ends.
  if (ending === 'fill') {
    if (style === 'pad') {
      // The pad lets go so the piano's lift into the next phrase is heard.
      hits = hits.filter((h) => !(isPiano(h) && h.at >= 2))
      for (const h of hits) if (h.part !== 'piano') h.dur = Math.min(h.dur, 3.4 - h.at)
      hits.push(push(0.85))
    } else {
      // Keep the downbeat, clear the middle, then a kick into the next phrase,
      // with a ghost before it unless you are playing quietly.
      hits = hits.filter((h) => !(isPiano(h) && h.at >= 1))
      if (e >= 0.25) hits.push({ ...p(2.5, 0.25, 0.5), ghost: true, shiftMs: 3 })
      hits.push(push(1.05))
    }
  } else if (ending === 'push') {
    hits.push(push(0.9))
  }

  // 3. Space: soft, sparse playing thins the band. Never the push, never the last attack.
  const thin = Math.max(0, 0.45 - 0.6 * e)
  for (const h of hits.filter((x) => isPiano(x) && !x.ahead && !x.ghost && x.at > 0)) {
    if (attacks(hits) > 1 && r() < thin) hits = hits.filter((x) => x !== h)
  }

  // 4. Ghosts: busy, loud playing brings a brush on a free off-beat.
  if (style !== 'pad' && ending !== 'fill' && r() < Math.max(0, 0.8 * e - 0.15)) {
    const free = [0.5, 1.5, 2.5].filter((at) => !hits.some((h) => isPiano(h) && Math.abs(h.at - at) < 0.4))
    if (free.length) hits.push({ ...p(free[Math.floor(r() * free.length)], 0.25, 0.5), ghost: true, shiftMs: 3 })
  }

  // 5. The bass, when it plays a two-feel, varies it.
  if ((style === 'comp' || style === 'even') && isTwoFeel(hits)) hits = bassVariant(hits, bar, e, r)
  if (style === 'walk') {
    // Feathered: not every quarter the same length.
    for (const h of hits) if (h.part === 'bass') h.dur = 0.72 + r() * 0.22
  }

  // 6. Articulation, per bar: stabs, as written, or legato.
  const stab = style === 'pad' ? 0 : 0.2 + 0.3 * e
  const legato = style === 'pad' ? 1 : 0.35 - 0.2 * e
  const roll = r()
  const mode = roll < stab ? 'stab' : roll < stab + legato ? 'legato' : 'written'
  const piano = hits.filter((h) => isPiano(h) && !h.ahead && !h.ghost).sort((x, y) => x.at - y.at)
  for (const h of piano) {
    const next = hits.filter((x) => isPiano(x) && x.at > h.at + 1e-6).reduce((m, x) => Math.min(m, x.at), 4)
    if (mode === 'stab') h.dur = Math.min(h.dur, 0.3 + r() * 0.2)
    else if (mode === 'legato') h.dur = Math.max(h.dur, Math.min(3, next - h.at - 0.05))
    else h.dur = h.dur * (0.9 + r() * 0.2)
  }

  // 7. Touch: the phrase's arc, your energy, and a little life per hit.
  const touch = arcFor(phrase, bar) * energyScale(e) * (0.96 + r() * 0.08)
  for (const h of hits) {
    const accent = h.ahead ? 1.08 : 1
    h.vel = round3(h.vel * touch * accent * (h.ghost ? 1 : 0.97 + r() * 0.06))
  }

  // 8. Timing personality: pop sits on the beat, a ballad leans back, pushes are eager.
  for (const h of hits) {
    if (!isPiano(h) || h.shiftMs !== undefined) continue
    h.shiftMs = h.ahead ? -4 : style === 'even' ? -5 : style === 'pad' ? 6 : 0
  }

  return { id: base.id, hits: hits.sort((x, y) => x.at - y.at || partOrder(x) - partOrder(y)) }
}

function isTwoFeel(hits: Hit[]): boolean {
  const bass = hits.filter((h) => h.part === 'bass')
  return bass.length === 2 && bass[0].at === 0 && bass[1].at === 2 && bass[0].dur > 1.5
}

/** Two-feel, varied: held whole when you are quiet, a skip on the "and" of 2, a pickup into the next bar. */
function bassVariant(hits: Hit[], bar: number, e: number, r: () => number): Hit[] {
  const rest = hits.filter((h) => h.part !== 'bass')
  const [one, three] = hits.filter((h) => h.part === 'bass')
  const v = r()
  if (e < 0.2 && v < 0.5) return [...rest, { ...one, dur: 3.9 }]
  if (v < 0.2 + 0.3 * e) return [...rest, { ...one, dur: 1.4 }, b(1.5, 0.35, 'root', 0.6), three]
  if (bar === 3 || v > 0.85) return [...rest, one, { ...three, dur: 1.4 }, b(3.5, 0.4, 'fifth', 0.7)]
  return hits
}

const partOrder = (h: Hit) => (h.part === 'bass' ? 0 : h.part === 'pad' ? 1 : 2)
const round3 = (x: number) => Math.round(x * 1000) / 1000

/**
 * Swing ratio by tempo: 0.66 up to 120, flattening to 0.58 by 200 (fast swing
 * is straighter). Given the swing it heard in your eighths (pulseEstimate's
 * `swing`, 0.5 straight .. 0.67 triplet), it meets you halfway, so the band's
 * off-beats sit where yours do instead of a textbook ratio.
 */
export function swingFor(bpm: number, heard?: number | null): number {
  const byTempo = bpm <= 120 ? 0.66 : bpm >= 200 ? 0.58 : 0.66 - ((bpm - 120) / 80) * 0.08
  if (heard == null || !Number.isFinite(heard) || heard < 0.55) return byTempo
  const yours = Math.min(0.75, heard)
  return Math.max(0.56, Math.min(0.72, (byTempo + yours) / 2))
}

/** Where a written position lands in time, in beats, with swing applied to the off-beats. */
export function swungAt(at: number, swing: number | null): number {
  if (swing === null) return at
  const beat = Math.floor(at)
  const frac = at - beat
  return Math.abs(frac - 0.5) < 1e-6 ? beat + swing : at
}

/**
 * A walking bar: 1 the root, 2 a chord tone, 3 a passing note, 4 a half or
 * whole step from where the next bar starts. Notes stay in the window; the
 * line keeps moving rather than jumping back to the same octave. Pure.
 */
export function walkingLine(
  root: number,
  tones: number[],
  nextRoot: number,
  prev: number | null,
  win: Window,
  seed: number,
): number[] {
  const r = rng(seed)
  const inWin = (pc: number, near: number) => {
    let best = -1
    for (let m = win.low; m <= win.high; m++) {
      if (pcOf(m) === pc && (best < 0 || Math.abs(m - near) < Math.abs(best - near))) best = m
    }
    return best < 0 ? win.low : best
  }
  const one = inWin(root, prev ?? win.low + 5)
  // Where the next bar's root will be: the octave closest to here.
  const target = inWin(nextRoot, one)
  const third = tones[1] ?? (root + 4) % 12
  const fifth = tones[2] ?? (root + 7) % 12
  // Head toward the target: the chord tone on its side.
  const up = target >= one
  const two = inWin(r() < 0.5 ? third : fifth, one + (up ? 3 : -3))
  // Approach from the side the line is coming from, a half step or a whole step.
  const side = two <= target ? -1 : 1
  const step = r() < 0.65 ? 1 : 2
  let four = target + side * step
  if (four < win.low || four > win.high) four = target - side * step
  // Beat 3 sits between 2 and 4: the fifth or another chord tone near the middle.
  const mid = (two + four) / 2
  let three = inWin(fifth, mid)
  if (three === two || three === four) three = inWin(third, mid)
  if (three === two || three === four) three = Math.round(mid)
  return [one, two, three, four]
}

/** Microtiming and touch for one note: a real player's habits, not noise. */
export type Feel = { lateMs: number; velocity: number }

/**
 * Where a hit leans, as a velocity multiplier. Swung: the piano digs into 2
 * and 4 and the swung "and"s, the way a comper answers the hi-hat. Straight:
 * the downbeat leads, 3 a little, the off-beats lighter. The bass leans on 1
 * in every style (and a touch on 2 and 4 when walking in swing). Pure.
 */
export function accentFor(hit: Hit, swung: boolean): number {
  const frac = hit.at - Math.floor(hit.at)
  const offbeat = Math.abs(frac - 0.5) < 1e-6
  if (hit.part === 'piano') {
    if (swung) return hit.at === 1 || hit.at === 3 ? 1.22 : offbeat ? 1.1 : 1
    return hit.at === 0 ? 1.1 : hit.at === 2 ? 1.04 : offbeat ? 0.92 : 1
  }
  if (hit.part === 'bass') return hit.at === 0 ? 1.08 : swung && (hit.at === 1 || hit.at === 3) ? 1.04 : 1
  return 1
}

/** The quietest a ghost goes, and the quietest anything else goes. */
const GHOST_FLOOR = 12
const FLOOR = 20

/**
 * Piano a little behind the beat (+6..+12 ms), bass on it (0..+3) and leaning
 * a hair ahead on the downbeat, a few ms of noise on both, plus the hit's own
 * lean (shiftMs: a pop comp sits on the beat, a ballad lays back, a push is
 * eager). Velocity: the bar's touch (already in hit.vel: phrase arc, your
 * energy) × the accent for where it falls, ±5 of noise. The `bar` argument is
 * kept for callers; the phrase arc now lives in patternFor. Pure given `rand`.
 */
export function feel(hit: Hit, base: number, _bar: number, swung: boolean, rand: () => number): Feel {
  const noise = () => rand() * 2 - 1
  const own = hit.part === 'bass' ? (hit.at === 0 ? -3 + rand() * 2 : rand() * 3) : hit.part === 'pad' ? 0 : 6 + rand() * 6
  const lateMs = own + (hit.shiftMs ?? 0) + noise() * 4
  const floor = hit.ghost ? GHOST_FLOOR : FLOOR
  const velocity = Math.round(Math.max(floor, Math.min(110, base * hit.vel * accentFor(hit, swung) + noise() * 5)))
  return { lateMs: Math.max(-10, lateMs), velocity }
}

/** Default style from what was heard: rubato or slow → pad, swung → comp, straight → even. */
export function autoStyle(bpm: number | null, swung: boolean): Style {
  if (bpm === null || bpm < 70) return 'pad'
  return swung ? 'comp' : 'even'
}
