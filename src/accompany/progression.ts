import { Chord, Note } from 'tonal'
import { spellPc } from '../analysis'
import { COLLECTION_SIG, type KeyMode } from './keyEstimate'
import { pcOf, rng, subSeed } from './played'

// The chart: what the band plays next, decided before it plays it.
//
// The unit is a phrase of 4 bars. There is always the phrase being played and
// the one after it on screen; the next one is planned when the current one
// ends. Phrases make a little tune, A A′ B A″ (16 bars), drawn once per session
// and then repeated chorus after chorus, the way a standard is: you can learn it
// and know what is coming. Each section gets its own rhythm patterns
// (patterns.ts), as iReal varies its choruses. What is on the chart plays as
// shown: nothing on screen is re-decided while you play over it.
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
  /** A written progression to play instead of a drawn tune. */
  chart?: Chart
}

// --- charts -------------------------------------------------------------------
//
// A written progression, for practising over changes you chose: the band plays
// it as written, chorus after chorus. Nothing is drawn and the density setting
// does not apply.

/**
 * Four bars of a chart, in numerals from a major tonic. A bar holds one chord
 * or two ("ii V"). `shift` moves these four bars' key by semitones; `minor`
 * puts them in the parallel minor.
 */
export type ChartPhrase = { bars: [string, string, string, string]; shift?: number; minor?: boolean }

export type Chart = { id: string; phrases: ChartPhrase[] }

/** The key four bars of a chart are in, from the tonic the chart is played in. */
export function chartKey(tonicPc: number, ph: ChartPhrase): PlanKey {
  const center = pcOf(tonicPc + (ph.shift ?? 0))
  return ph.minor
    ? { center, mode: 'minor', collectionPc: pcOf(center + 3) }
    : { center, mode: 'major', collectionPc: center }
}

/**
 * A chart is played in sevenths or with extensions: triads would take the
 * guide tones out of the chords, and substitutions would not be the changes
 * you asked for.
 */
export function chartComplexity(c: Complexity): Complexity {
  return c < 2 ? 2 : c > 3 ? 3 : c
}

function chartPhrase(chart: Chart, tonicPc: number, index: number, beats: number): Phrase {
  const n = chart.phrases.length
  const ph = chart.phrases[((index % n) + n) % n]
  const bars: PlanBar[] = ph.bars.map((bar) => {
    const tokens = bar.split(' ')
    return { slots: tokens.map((token) => ({ token, beats: beats / tokens.length })), locked: null }
  })
  return { index, section: sectionOf(index), key: chartKey(tonicPc, ph), bars }
}

/** Every phrase of a chart as it will sound in a key, in order: for showing it before the band starts. */
export function renderChart(chart: Chart, tonicPc: number, complexity: Complexity): PlanChord[][][] {
  const opts: PlanOpts = { seed: 0, density: 1, beatsPerBar: 4, chart }
  const base: PlanKey = { center: tonicPc, mode: 'major', collectionPc: tonicPc }
  const phrases = chart.phrases.map((_, i) => planPhrase(base, i, opts))
  const c = chartComplexity(complexity)
  return phrases.map((p, i) => renderPhrase(p, c, 0, phrases[(i + 1) % phrases.length]))
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
  return SECTIONS[sectionIndex(index)]
}

const sectionIndex = (index: number) => ((index % 4) + 4) % 4

/**
 * Plans phrase `index` in a key. Pure: the same seed and index always give the
 * same phrase, which is what lets the chart show it before it plays.
 */
export function planPhrase(key: PlanKey, index: number, opts: PlanOpts): Phrase {
  if (opts.chart) return chartPhrase(opts.chart, key.center, index, opts.beatsPerBar)
  const t = TEMPLATES[key.mode]
  // Templates are drawn once per session: every chorus of the tune is the same tune.
  const r = rng(subSeed(opts.seed, 0))
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
    const minor = (token: string | null) =>
      token ? parseNumeral(token).family === 'min' || parseNumeral(token).family === 'hdim' : false
    const out: PlanChord[] = []
    plain[i].forEach((s, j) => {
      // Where this chord goes: the next one in its bar (a written chart may have two), else the next bar.
      const goesToMinor = minor(plain[i][j + 1]?.token ?? next)
      out.push(chordOf(symbolFor(s.token, p.key, complexity, goesToMinor && s.token !== 'V'), s.token, s.beats, s.hold))
    })
    if (complexity < 4 || !next || out.length !== 1 || out[0].hold) return out
    return substitute(out[0], next, p, i, complexity, seed)
  })
}

function substitute(chord: PlanChord, next: string, p: Phrase, bar: number, complexity: Complexity, seed: number): PlanChord[] {
  // By place in the form, not by phrase: the same bar of the next chorus gets the same substitution.
  const r = rng(subSeed(seed, sectionIndex(p.index) * 16 + bar))
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

/** Center + degree as a pitch class, for tests and the chart's key line. */
export function degreePc(key: PlanKey, token: string): number {
  return pcOf(key.center + parseNumeral(token).degree)
}

