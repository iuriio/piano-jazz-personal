import { Chord, Note } from 'tonal'
import { spellPc } from '../analysis'
import { COLLECTION_SIG, type KeyMode } from './keyEstimate'
import { pcOf, rng, subSeed } from './played'

// The chart: what the band plays next, decided before it plays it.
//
// The unit is a phrase of 4 bars. There is always the phrase being played and
// the one after it on screen; the next one is planned when the current one
// starts its last bar. Phrases make a little tune, A A′ B A″ (16 bars), so the
// harmony has a shape instead of a random walk, and each section gets its own
// rhythm patterns (patterns.ts), as iReal varies its choruses.
//
// A phrase stores roman numerals, not chord names. The names are rendered from
// them at the current complexity, so moving "simple ↔ rich" redraws every bar
// that is not locked yet. A bar locks when it starts playing: you may already be
// aiming at the chord it promised.

export type Fn = 'T' | 'SD' | 'D'
export type Complexity = 1 | 2 | 3 | 4
export type Section = 'A' | 'A′' | 'B' | 'A″'
export const SECTIONS: Section[] = ['A', 'A′', 'B', 'A″']

export type PlanKey = { collectionPc: number; center: number; mode: KeyMode }

/** One chord as planned: a roman numeral and how long it lasts. */
export type Slot = {
  /** "ii", "V", "bVII7", "iiø". "VI7|vi" = VI7 when rich enough, vi otherwise. */
  token: string
  beats: number
  /** The previous bar's chord, still going (a chart's "%"). */
  hold?: boolean
}

/** One chord as it will sound. */
export type PlanChord = {
  /** ASCII symbol, root spelled in the key: "Bbmaj7", "Cm9", "F13". */
  symbol: string
  root: number
  /** Pitch classes, root first. */
  tones: number[]
  fn: Fn
  beats: number
  token: string
  hold: boolean
}

export type PlanBar = {
  slots: Slot[]
  /** Fixed once the bar has started; complexity no longer touches it. */
  locked: PlanChord[] | null
}

export type Phrase = {
  index: number
  section: Section
  key: PlanKey
  bars: PlanBar[]
}

export type PlanOpts = {
  seed: number
  /** Bars per chord: 1, or 2 when you play sparsely or fast. */
  density: 1 | 2
  beatsPerBar: number
}

// --- templates ----------------------------------------------------------------
//
// Minor keys are written with explicit flats (bIII, bVI, bVII), so a numeral
// always means the same distance from the tonic in every mode.

type Templates = { A: string[][]; B: string[][]; turn: string[][] }

const TEMPLATES: Record<KeyMode, Templates> = {
  major: {
    A: [
      ['I', 'vi', 'ii', 'V'],
      ['I', 'IV', 'I', 'V'],
      ['I', 'V', 'vi', 'IV'],
    ],
    B: [
      ['IV', 'iv|ii', 'I', 'I'],
      ['iii', 'VI7|vi', 'ii', 'V'],
      ['IV', 'V', 'iii', 'vi'],
    ],
    turn: [
      ['iii', 'vi', 'ii', 'V'],
      ['ii', 'V', 'I', 'I'],
    ],
  },
  minor: {
    A: [
      ['i', 'iv', 'i', 'V'],
      ['i', 'bVI', 'bIII', 'bVII7'],
    ],
    B: [['iv', 'bVII7', 'bIII', 'bVI']],
    turn: [['iiø', 'V', 'i', 'i']],
  },
  dorian: {
    A: [['i', 'IV7', 'i', 'IV7']],
    B: [['bVII', 'IV7', 'bVII', 'IV7']],
    turn: [['i', 'i', 'i', 'IV7']],
  },
  mixolydian: {
    A: [['I7', 'bVII', 'I7', 'bVII']],
    B: [['IV', 'I7', 'IV', 'I7']],
    turn: [['I7', 'I7', 'IV', 'bVII']],
  },
}

/** Same-function alternatives, for the live swap. */
const BY_FUNCTION: Record<KeyMode, Record<Fn, string[]>> = {
  major: { T: ['I', 'vi', 'iii'], SD: ['IV', 'ii'], D: ['V', 'viiø'] },
  minor: { T: ['i', 'bIII', 'bVI'], SD: ['iv', 'iiø'], D: ['V', 'bVII7'] },
  dorian: { T: ['i'], SD: ['IV7', 'bVII'], D: ['v'] },
  mixolydian: { T: ['I7'], SD: ['IV', 'bVII'], D: ['v'] },
}

// --- numerals -----------------------------------------------------------------

type Family = 'maj' | 'min' | 'dom' | 'hdim' | 'dim'
type Numeral = { degree: number; family: Family }

const NUMERAL: Record<string, number> = { I: 0, II: 2, III: 4, IV: 5, V: 7, VI: 9, VII: 11 }

/** "bVII7" -> { degree: 10, family: 'dom' }. */
export function parseNumeral(token: string): Numeral {
  const m = /^(b|#)?([ivIV]+)(ø|°|7)?$/.exec(token)
  if (!m) throw new Error(`bad numeral ${token}`)
  const upper = m[2].toUpperCase()
  const degree = (NUMERAL[upper] + (m[1] === 'b' ? -1 : m[1] === '#' ? 1 : 0) + 12) % 12
  const lower = m[2] === m[2].toLowerCase()
  const family: Family =
    m[3] === 'ø' ? 'hdim' : m[3] === '°' ? 'dim' : m[3] === '7' ? 'dom' : lower ? 'min' : upper === 'V' && !m[1] ? 'dom' : 'maj'
  return { degree, family }
}

/** "VI7|vi": the rich form from complexity 3, the plain one below it. */
function pickToken(token: string, complexity: Complexity): string {
  const [rich, plain] = token.split('|')
  return plain && complexity < 3 ? plain : rich
}

export function functionOf(token: string): Fn {
  const { degree, family } = parseNumeral(token.split('|')[0])
  if (family === 'dom' && degree !== 0) return 'D'
  if (degree === 7 || degree === 11) return 'D'
  if (degree === 2 || degree === 5 || degree === 10) return 'SD'
  return 'T'
}

const SUFFIX: Record<Family, [string, string, string]> = {
  maj: ['', 'maj7', 'maj9'],
  min: ['m', 'm7', 'm9'],
  dom: ['', '7', '13'],
  hdim: ['dim', 'm7b5', 'm7b5'],
  dim: ['dim', 'dim7', 'dim7'],
}

const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

/** The scale of a key, as pitch classes from its tonic's collection. */
export function scalePcs(key: PlanKey): number[] {
  const major = [0, 2, 4, 5, 7, 9, 11]
  return major.map((s) => (key.collectionPc + s) % 12)
}

/** Root spelled for the key: its own letter when diatonic, a flat when borrowed (D♭7, never C♯7, as a subV of C). */
export function spellRoot(pc: number, key: PlanKey): string {
  if (scalePcs(key).includes(pc)) return spellPc(pc, COLLECTION_SIG[key.collectionPc])
  return FLAT_NAMES[pc]
}

/** The symbol for a numeral at a complexity. `resolvesToMinor` adds the ♭9 a dominant wants there. */
export function symbolFor(token: string, key: PlanKey, complexity: Complexity, resolvesToMinor = false): string {
  const { degree, family } = parseNumeral(token)
  const root = (key.center + degree) % 12
  const level = Math.min(3, complexity) - 1
  let suffix = SUFFIX[family][level]
  if (level === 2) {
    // A ninth over iii is the ♭9 of a phrygian chord: an avoid note, so stop at the seventh.
    if (family === 'min' && (root - key.collectionPc + 12) % 12 === 4) suffix = 'm7'
    if (family === 'dom' && (resolvesToMinor || (key.mode === 'minor' && degree === 7))) suffix = '7b9'
    else if (family === 'dom' && degree !== 7) suffix = '9'
  }
  return `${spellRoot(root, key)}${suffix}`
}

function chordOf(symbol: string, token: string, beats: number, hold: boolean, fn: Fn = functionOf(token)): PlanChord {
  const c = Chord.get(symbol)
  const root = Note.chroma(c.tonic ?? 'C') ?? 0
  const tones = c.notes.map((n) => Note.chroma(n) ?? 0)
  return { symbol, root, tones, fn, beats, token, hold }
}

// --- planning -----------------------------------------------------------------

/** The section a phrase plays in the A A′ B A″ form. */
export function sectionOf(index: number): Section {
  return SECTIONS[((index % 4) + 4) % 4]
}

/**
 * Plans phrase `index` in a key. Pure: the same seed and index always give the
 * same phrase, which is what lets the chart show it before it plays.
 */
export function planPhrase(key: PlanKey, index: number, opts: PlanOpts): Phrase {
  const t = TEMPLATES[key.mode]
  // Templates are drawn once per 16-bar cycle, so A, A′ and A″ belong together.
  const cycle = Math.floor(index / 4)
  const r = rng(subSeed(opts.seed, cycle))
  const pick = <T,>(xs: T[], not?: T) => {
    const pool = xs.length > 1 && not !== undefined ? xs.filter((x) => x !== not) : xs
    return pool[Math.floor(r() * pool.length)]
  }
  const a = pick(t.A)
  const a2 = pick(t.A, a)
  const b = pick(t.B)
  const turn = pick(t.turn)
  const section = sectionOf(index)
  const tokens = { A: a, 'A′': a2, B: b, 'A″': turn }[section]

  const beats = opts.beatsPerBar
  const bars: PlanBar[] =
    opts.density === 1
      ? tokens.map((token) => ({ slots: [{ token, beats }], locked: null }))
      : // One chord per two bars: keep the first and the last, so the phrase still lands where it should.
        [tokens[0], tokens[0], tokens[3], tokens[3]].map((token, i) => ({
          slots: [{ token, beats, hold: i % 2 === 1 }],
          locked: null,
        }))
  return { index, section, key, bars }
}

/**
 * Chord names for every bar of a phrase. Locked bars come back as they were;
 * the rest are rendered at `complexity`. At 4, substitutions come in: a
 * secondary dominant into a chord that is not the tonic, a tritone sub on a
 * dominant falling a fifth, the backdoor ♭VII7 into the tonic.
 *
 * `after` is the phrase that follows, so the last bar knows where it is going.
 */
export function renderPhrase(p: Phrase, complexity: Complexity, seed: number, after?: Phrase): PlanChord[][] {
  // Plain chords first: the substitutions need to know where each one goes.
  const plain = p.bars.map((bar) =>
    bar.slots.map((s) => {
      const token = pickToken(s.token, complexity)
      return { token, beats: s.beats, hold: !!s.hold }
    }),
  )
  const nextAfter = after ? pickToken(after.bars[0].slots[0].token, complexity) : null
  const following = (bar: number): string | null =>
    bar + 1 < plain.length ? plain[bar + 1][0].token : nextAfter

  return p.bars.map((bar, i) => {
    if (bar.locked) return bar.locked
    const next = following(i)
    const nextMinor = next ? parseNumeral(next).family === 'min' || parseNumeral(next).family === 'hdim' : false
    const out: PlanChord[] = []
    for (const s of plain[i]) {
      out.push(chordOf(symbolFor(s.token, p.key, complexity, nextMinor && s.token !== 'V'), s.token, s.beats, s.hold))
    }
    if (complexity < 4 || !next || out.length !== 1 || out[0].hold) return out
    return substitute(out[0], next, p, i, complexity, seed)
  })
}

function substitute(chord: PlanChord, next: string, p: Phrase, bar: number, complexity: Complexity, seed: number): PlanChord[] {
  const r = rng(subSeed(seed, p.index * 16 + bar))
  const roll = r()
  const target = parseNumeral(next)
  const targetRoot = (p.key.center + target.degree) % 12
  const fallsAFifth = (chord.root - targetRoot + 12) % 12 === 7
  const half = chord.beats / 2

  // A dominant falling a fifth: half the time, its tritone substitute.
  if (parseNumeral(chord.token).family === 'dom' && fallsAFifth && roll < 0.5) {
    const sub = (chord.root + 6) % 12
    return [chordOf(`${spellRoot(sub, p.key)}7`, chord.token, chord.beats, false)]
  }
  // Into the tonic from the subdominant: the backdoor ♭VII7 on the second half.
  if (target.degree === 0 && chord.fn === 'SD' && roll < 0.4) {
    const bVII = (p.key.center + 10) % 12
    return [
      { ...chord, beats: half },
      chordOf(`${spellRoot(bVII, p.key)}9`, 'bVII7', half, false, 'D'),
    ]
  }
  // Into anything but the tonic: its own dominant on the second half.
  if (target.degree !== 0 && chord.root !== (targetRoot + 7) % 12 && roll < 0.7) {
    const dom = (targetRoot + 7) % 12
    const minor = target.family === 'min' || target.family === 'hdim'
    return [{ ...chord, beats: half }, chordOf(`${spellRoot(dom, p.key)}${minor ? '7b9' : '7'}`, `V7/${next}`, half, false, 'D')]
  }
  return [chord]
}

/** Locks bar `bar` (and everything before it) to what it renders now. Pure. */
export function lockThrough(p: Phrase, bar: number, rendered: PlanChord[][]): Phrase {
  return {
    ...p,
    bars: p.bars.map((b, i) => (i <= bar && !b.locked ? { ...b, locked: rendered[i] } : b)),
  }
}

// --- the live swap --------------------------------------------------------------

/**
 * How well a chord sits under what you played: +1 for each chord tone, +0.3 for
 * an available tension, −0.7 for an avoid note (a scale tone a half step above a
 * chord tone: the 4th over IΔ, the ♭9 over iii). Weighted by how much you played
 * each pitch class.
 */
export function fitScore(tones: number[], key: PlanKey, weights: number[]): number {
  const scale = scalePcs(key)
  let score = 0
  for (let pc = 0; pc < 12; pc++) {
    const w = weights[pc]
    if (!w) continue
    if (tones.includes(pc)) score += w
    else if (tones.some((t) => (t + 1) % 12 === pc) && scale.includes(pc)) score -= 0.7 * w
    else if (scale.includes(pc)) score += 0.3 * w
  }
  return score
}

/** How far the best alternative must be ahead, as a share of what you played. */
const SWAP_MARGIN = 0.25

/**
 * Before a bar locks: if what you have been playing fits another chord of the
 * same function clearly better, that one plays instead. The function — and so
 * the shape of the phrase — is kept; only the colour follows you. Pure.
 */
export function refineBar(p: Phrase, bar: number, weights: number[]): Phrase {
  const b = p.bars[bar]
  if (!b || b.locked || b.slots.length !== 1 || b.slots[0].hold) return p
  const total = weights.reduce((a, x) => a + x, 0)
  if (total <= 0) return p
  const slot = b.slots[0]
  const current = pickToken(slot.token, 2)
  const fn = functionOf(current)
  const score = (token: string) => {
    const c = chordOf(symbolFor(token, p.key, 2), token, slot.beats, false)
    return fitScore(c.tones, p.key, weights)
  }
  const mine = score(current)
  let best = current
  let bestScore = mine
  for (const alt of BY_FUNCTION[p.key.mode][fn]) {
    if (functionOf(alt) !== fn) continue
    const s = score(alt)
    if (s > bestScore) (best = alt), (bestScore = s)
  }
  if (best === current || bestScore - mine < SWAP_MARGIN * total) return p
  // A held bar after this one is the same chord carrying on: it changes with it.
  const bars = p.bars.map((x, i) => {
    if (i === bar) return { ...x, slots: [{ ...slot, token: best }] }
    if (i === bar + 1 && x.slots[0]?.hold && !x.locked) return { ...x, slots: [{ ...x.slots[0], token: best }] }
    return x
  })
  return { ...p, bars }
}

/** Center + degree as a pitch class, for tests and the chart's key line. */
export function degreePc(key: PlanKey, token: string): number {
  return pcOf(key.center + parseNumeral(token).degree)
}

