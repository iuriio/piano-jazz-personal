import { Chord, Note } from 'tonal'
import type { Chart } from '../accompany/progression'
import { noteAbove } from './spell'
import { KEY_CHAIN } from './twoFiveOne'

// The three improvisation exercises: never stop, land on a guide tone, repeat
// and change. Each one trains a single thing a solo needs — thinking fast
// enough, knowing where the harmony is, tying one phrase to the next — over a
// progression the band plays.
//
// Everything here is pure: what you played comes in as notes stamped with the
// clock, the band's bars come in the same way, and a verdict comes out. The
// component (ImprovDrill.tsx) only feeds it and shows what it says.

// ---- the changes ------------------------------------------------------------
//
// Written in numerals from a major tonic, four bars a line, one chord or two a
// bar. To add a progression, add it to this table.

export type ImprovChart = Chart & { label: string; note: string }

const TWO_FIVE_ONE: [string, string, string, string] = ['ii', 'V', 'I', 'I']

export const CHARTS: ImprovChart[] = [
  {
    id: 'major',
    label: '2-5-1, major',
    note: 'Four bars, round and round. The place to start.',
    phrases: [{ bars: TWO_FIVE_ONE }],
  },
  {
    id: 'minor',
    label: '2-5-1, minor',
    note: 'The same four bars in the minor key of the same name.',
    phrases: [{ bars: ['iiø', 'V', 'i', 'i'], minor: true }],
  },
  {
    id: 'fifths',
    label: '2-5-1, major then relative minor',
    note: 'Eight bars falling in fifths the whole way, so each guide tone line only ever stays or steps down.',
    phrases: [{ bars: ['ii', 'V', 'I', 'IV'] }, { bars: ['viiø', 'III7', 'vi', 'vi'] }],
  },
  {
    id: 'keys',
    label: '2-5-1 through all 12 keys',
    note: "The 2-5-1 drill's walk: the one turns minor and is the two of the next key.",
    phrases: KEY_CHAIN.map((shift) => ({ bars: TWO_FIVE_ONE, shift })),
  },
  {
    id: 'turnaround',
    label: '1-6-2-5 turnaround',
    note: 'Two chords a bar: the changes come twice as fast.',
    phrases: [{ bars: ['I vi', 'ii V', 'iii VI7', 'ii V'] }],
  },
  {
    id: 'blues',
    label: 'jazz blues',
    note: 'Twelve bars, with a 2-5 into the top.',
    phrases: [
      { bars: ['I7', 'IV7', 'I7', 'I7'] },
      { bars: ['IV7', 'IV7', 'I7', 'VI7'] },
      { bars: ['ii', 'V', 'I7 VI7', 'ii V'] },
    ],
  },
]

export const CHART_BY_ID = new Map(CHARTS.map((c) => [c.id, c]))

// ---- guide tones --------------------------------------------------------------
//
// The third and the seventh of a chord: the two notes that say what the chord
// is. A phrase that ends on one of them ends inside the harmony.

export type Tone = 'third' | 'seventh' | 'ninth'

export const TONE_LABEL: Record<Tone, string> = { third: '3rd', seventh: '7th', ninth: '9th' }

/** What a phrase has to land on: a guide tone, or the natural ninth for the adventurous. */
export type Target = 'guide' | 'ninth'

export type GuideTones = {
  /** Note names, spelled from the chord's root (ASCII). A triad has no seventh. */
  third: string | null
  seventh: string | null
  /** The natural ninth, whatever the chord's own ninth is. */
  ninth: string
}

export function guideTones(symbol: string): GuideTones | null {
  const c = Chord.get(symbol)
  if (c.empty || !c.tonic) return null
  const tonic = c.tonic
  // "3m", "3M", "7m", "7M", "7d": the number comes first, so "13M" is not a third.
  const above = (n: string) => {
    const iv = c.intervals.find((i) => i.startsWith(n))
    return iv ? noteAbove(tonic, iv) : null
  }
  return { third: above('3'), seventh: above('7'), ninth: noteAbove(tonic, '2M') }
}

const pcOfName = (name: string | null): number | null => (name ? (Note.chroma(name) ?? null) : null)

/** The names a phrase may land on over a chord, for the screen: "F", "C". */
export function targetNames(symbol: string, target: Target): string[] {
  const g = guideTones(symbol)
  if (!g) return []
  return (target === 'ninth' ? [g.ninth] : [g.third, g.seventh]).filter((n): n is string => n !== null)
}

/** The pitch classes of those names. */
export function targetPcs(symbol: string, target: Target): number[] {
  return targetNames(symbol, target)
    .map(pcOfName)
    .filter((pc): pc is number => pc !== null)
}

/** Which target tone of the chord a pitch class is, if any. */
export function toneOf(pc: number, symbol: string, target: Target): Tone | null {
  const g = guideTones(symbol)
  if (!g) return null
  if (target === 'ninth') return pcOfName(g.ninth) === pc ? 'ninth' : null
  if (pcOfName(g.third) === pc) return 'third'
  if (pcOfName(g.seventh) === pc) return 'seventh'
  return null
}

const around = (a: number, b: number) => Math.min((((a - b) % 12) + 12) % 12, (((b - a) % 12) + 12) % 12)

/**
 * The two guide tone lines through a run of chords: for each chord its third
 * and seventh, put in the order that moves least from the chord before. Over
 * chords falling in fifths the third of one is the seventh of the next, so each
 * line stays or steps down.
 */
export function guideLines(symbols: readonly string[]): [string | null, string | null][] {
  const out: [string | null, string | null][] = []
  for (const symbol of symbols) {
    const g = guideTones(symbol)
    const pair: [string | null, string | null] = [g?.third ?? null, g?.seventh ?? null]
    const prev = out[out.length - 1]
    const [a, b] = pair.map(pcOfName)
    const [pa, pb] = prev ? prev.map(pcOfName) : [null, null]
    if (a !== null && b !== null && pa !== null && pb !== null) {
      const straight = around(a, pa) + around(b, pb)
      const crossed = around(b, pa) + around(a, pb)
      if (crossed < straight) pair.reverse()
    }
    out.push(pair)
  }
  return out
}

// ---- where the band is ----------------------------------------------------------

/** A bar the band played: when it began, how long a beat was, what was in it. */
export type Span = {
  start: number
  beatMs: number
  chords: readonly { symbol: string; beats: number }[]
  next: { symbol: string } | null
}

export type Place = {
  symbol: string
  /** The chord after this one. */
  next: string | null
  /** Beats left until it. */
  toChange: number
  beatInBar: number
}

/** The chord sounding at a moment, from the bars the band played. Null outside them. */
export function placeAt(bars: readonly Span[], t: number): Place | null {
  for (let i = bars.length - 1; i >= 0; i--) {
    const bar = bars[i]
    if (t < bar.start) continue
    const total = bar.chords.reduce((sum, c) => sum + c.beats, 0)
    const beat = (t - bar.start) / bar.beatMs
    // Only the newest bar can run out: the band stopped under you.
    if (i === bars.length - 1 && beat >= total + 0.5) return null
    const at = Math.min(beat, total - 1e-6)
    let acc = 0
    for (let j = 0; j < bar.chords.length; j++) {
      acc += bar.chords[j].beats
      if (at < acc) {
        return {
          symbol: bar.chords[j].symbol,
          next: bar.chords[j + 1]?.symbol ?? bar.next?.symbol ?? null,
          toChange: acc - at,
          beatInBar: at,
        }
      }
    }
    return null
  }
  return null
}

// ---- the solo line --------------------------------------------------------------

/** A note as it was played: the clock at its start and at its end (NaN while it sounds). */
export type Struck = { midi: number; on: number; off: number }

/** Notes this close together were struck as one: a chord, a grip. */
const TOGETHER_MS = 40

/**
 * What counts as the solo: the notes from `lowest` up, since `since`, with
 * anything struck together heard as one attack, its top note. A left hand
 * comping below `lowest` is not part of the line.
 */
export function soloLine(notes: readonly Struck[], lowest: number, since: number): Struck[] {
  const line: Struck[] = []
  const mine = notes.filter((n) => n.midi >= lowest && n.on >= since).sort((a, b) => a.on - b.on)
  for (const n of mine) {
    const last = line[line.length - 1]
    if (last && n.on - last.on <= TOGETHER_MS) {
      const off = Number.isNaN(last.off) || Number.isNaN(n.off) ? Number.NaN : Math.max(last.off, n.off)
      line[line.length - 1] = { midi: Math.max(last.midi, n.midi), on: last.on, off }
    } else {
      line.push({ midi: n.midi, on: n.on, off: n.off })
    }
  }
  return line
}

// ---- phrases --------------------------------------------------------------------
//
// A phrase ends at a pause: a beat of silence, or — if you hold the last note,
// or the pedal — two beats without a new one.

export const PAUSE_SILENT_BEATS = 1
export const PAUSE_HELD_BEATS = 2
/** Fewer notes than this is not a phrase: one note on a guide tone proves nothing. */
export const MIN_PHRASE_NOTES = 3

export type SoloPhrase = {
  notes: Struck[]
  /** Followed by a pause: nothing more can join it. */
  closed: boolean
}

function isPause(lastOn: number, quietFrom: number, t: number, beatMs: number): boolean {
  if (t - lastOn >= PAUSE_HELD_BEATS * beatMs) return true
  return !Number.isNaN(quietFrom) && t - quietFrom >= PAUSE_SILENT_BEATS * beatMs
}

export function splitPhrases(line: readonly Struck[], beatMs: number, now: number): SoloPhrase[] {
  const out: SoloPhrase[] = []
  let cur: Struck[] = []
  // When the phrase so far stopped sounding; NaN while any of it still rings.
  let quietFrom = Number.NEGATIVE_INFINITY
  for (const n of line) {
    if (cur.length && isPause(cur[cur.length - 1].on, quietFrom, n.on, beatMs)) {
      out.push({ notes: cur, closed: true })
      cur = []
      quietFrom = Number.NEGATIVE_INFINITY
    }
    cur.push(n)
    quietFrom = Number.isNaN(n.off) || Number.isNaN(quietFrom) ? Number.NaN : Math.max(quietFrom, n.off)
  }
  if (cur.length) out.push({ notes: cur, closed: isPause(cur[cur.length - 1].on, quietFrom, now, beatMs) })
  return out
}

// ---- 1. never stop ----------------------------------------------------------------
//
// Play without stopping, in swung eighths, then in triplets. What you play
// does not matter; that you keep going does.

export type Sub = 'eighths' | 'triplets'

export const PER_BEAT: Record<Sub, number> = { eighths: 2, triplets: 3 }

/**
 * The silence that counts as a stop: two and a half notes of the subdivision.
 * A quarter note among eighths passes; anything longer is a stop.
 */
export function stopAfterMs(sub: Sub, beatMs: number): number {
  return (2.5 / PER_BEAT[sub]) * beatMs
}

/** A run only counts as stopped once it was a run: a note or two is not playing yet. */
const RUN_NOTES = 4

export type Flow = {
  /** First and last attack of the run in progress; null between runs. */
  start: number | null
  last: number | null
  notes: number
  stops: number
  /** The longest run so far, in ms. */
  longest: number
  /** How long the run that last stopped had been going, in ms. */
  ended: number
}

export const NEW_FLOW: Flow = { start: null, last: null, notes: 0, stops: 0, longest: 0, ended: 0 }

/** Takes the new attacks, in order, and the time; returns where the run stands. */
export function flowStep(flow: Flow, onsets: readonly number[], now: number, limitMs: number): Flow {
  let { start, last, notes, stops, longest, ended } = flow
  const end = () => {
    if (notes >= RUN_NOTES && start !== null && last !== null) {
      stops++
      ended = last - start
    }
    start = null
    notes = 0
  }
  for (const t of onsets) {
    if (start !== null && last !== null && t - last > limitMs) end()
    if (start === null) start = t
    last = t
    notes++
    if (notes >= RUN_NOTES) longest = Math.max(longest, last - start)
  }
  if (start !== null && last !== null && now - last > limitMs) end()
  return { start, last, notes, stops, longest, ended }
}

// ---- 2. land on a guide tone --------------------------------------------------------

/** How long before a change a note may land on the chord it is about to become. */
const ANTICIPATION_BEATS = 0.75

export type Landing = {
  /** The last note of the phrase. */
  midi: number
  /** The chord it is judged against: the one sounding, or the next when it lands just ahead of it. */
  symbol: string
  tone: Tone | null
  /** Landed on the next chord's tone, just before the change. */
  ahead: boolean
}

/** Where a phrase ended. Null when the band was not playing under its last note. */
export function judgeLanding(notes: readonly Struck[], bars: readonly Span[], target: Target): Landing | null {
  const last = notes[notes.length - 1]
  if (!last) return null
  const place = placeAt(bars, last.on)
  if (!place) return null
  const pc = ((last.midi % 12) + 12) % 12
  const here = toneOf(pc, place.symbol, target)
  if (here) return { midi: last.midi, symbol: place.symbol, tone: here, ahead: false }
  if (place.next && place.toChange <= ANTICIPATION_BEATS) {
    const there = toneOf(pc, place.next, target)
    if (there) return { midi: last.midi, symbol: place.next, tone: there, ahead: true }
  }
  return { midi: last.midi, symbol: place.symbol, tone: null, ahead: false }
}

// ---- 3. repeat and change ---------------------------------------------------------------
//
// Play a phrase, then play it again with one thing changed: a note, the
// rhythm, the speed, where it sits, which way up it is. Two phrases are
// compared as notes and beats, and the answer names what changed.

/** A note of a phrase: its pitch, and its place in beats from the phrase's first note. */
export type MotifNote = { midi: number; beat: number }

export type Relation = {
  /** 'same' = nothing changed; 'varied' = the same phrase, changed; 'new' = another phrase. */
  kind: 'same' | 'varied' | 'new'
  changes: string[]
}

/** How far apart two gaps may be and still be the same rhythm: human hands are not a grid. */
const RHYTHM_SLACK = 0.2
const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(RHYTHM_SLACK, 0.2 * Math.max(a, b))

const gaps = (m: readonly MotifNote[]) => m.slice(1).map((n, i) => n.beat - m[i].beat)
const steps = (m: readonly number[]) => m.slice(1).map((n, i) => n - m[i])
/** A rhythm with a shape: even notes all the way are no rhythm to recognise. */
const shaped = (g: readonly number[]) => g.length >= 2 && Math.max(...g) - Math.min(...g) > 0.3
/** How many notes may differ in a phrase of n and it still be that phrase. */
const leeway = (n: number) => Math.max(1, Math.floor(n / 3))
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

const DISTANCE = [
  '',
  'a half step',
  'a whole step',
  'a minor 3rd',
  'a major 3rd',
  'a 4th',
  'a tritone',
  'a 5th',
  'a minor 6th',
  'a major 6th',
  'a minor 7th',
  'a major 7th',
]

function distance(semitones: number): string {
  const n = Math.abs(semitones)
  const octaves = Math.floor(n / 12)
  const rest = n % 12
  const oct = octaves === 1 ? 'an octave' : `${octaves} octaves`
  if (octaves === 0) return DISTANCE[rest]
  return rest === 0 ? oct : `${oct} and ${DISTANCE[rest]}`
}

function rhythmChange(a: readonly MotifNote[], b: readonly MotifNote[]): string | null {
  const ga = gaps(a)
  const gb = gaps(b)
  if (ga.every((g, i) => near(g, gb[i]))) return null
  const la = a[a.length - 1].beat
  const k = la > 0 ? b[b.length - 1].beat / la : 1
  if ((k >= 1.4 || k <= 0.72) && ga.every((g, i) => near(g * k, gb[i]))) return k > 1 ? 'slowed down' : 'sped up'
  return 'rhythm changed'
}

/** What happened to the notes, for two phrases of the same length. Null = nothing; undefined = not the same phrase. */
function pitchChange(a: readonly number[], b: readonly number[]): string | null | undefined {
  const n = a.length
  const d = b.map((p, i) => p - a[i])
  if (d.every((x) => x === 0)) return null
  if (d.every((x) => x === d[0])) return `moved ${d[0] > 0 ? 'up' : 'down'} ${distance(d[0])}`
  const differ = d.filter((x) => x !== 0).length
  if (differ <= leeway(n)) return `${plural(differ, 'note')} changed`

  const sa = steps(a)
  const sb = steps(b)
  if (n >= 3) {
    const back = [...a].reverse()
    const shift = b[0] - back[0]
    if (b.every((p, i) => p - back[i] === shift)) return 'played backwards'
    if (sa.some((x) => x !== 0) && sa.every((x, i) => sb[i] === -x)) return 'turned upside down'
  }
  // The same shape on other notes: a sequence through the key, where a step may
  // be a half step wider or narrower.
  if (sa.every((x, i) => Math.sign(x) === Math.sign(sb[i]) && Math.abs(x - sb[i]) <= 2)) {
    const lift = d.reduce((sum, x) => sum + x, 0)
    return `same shape, ${lift > 0 ? 'higher' : 'lower'}`
  }
  // Moved, and a note or two changed on the way.
  const counts = new Map<number, number>()
  for (const x of d) counts.set(x, (counts.get(x) ?? 0) + 1)
  const [by, most] = [...counts].sort((x, y) => y[1] - x[1])[0]
  if (by !== 0 && n - most <= leeway(n)) return `moved ${by > 0 ? 'up' : 'down'} ${distance(by)}, ${plural(n - most, 'note')} changed`
  return undefined
}

function editDistance(a: readonly number[], b: readonly number[]): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const next = [i]
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    row = next
  }
  return row[b.length]
}

function contains(long: readonly number[], short: readonly number[]): boolean {
  if (short.length === 0) return false
  for (let i = 0; i + short.length <= long.length; i++) {
    if (short.every((x, j) => long[i + j] === x)) return true
  }
  return false
}

/** For two phrases of different lengths: what was done, or undefined when they are not the same phrase. */
function lengthChange(a: readonly number[], b: readonly number[]): string | undefined {
  const longer = Math.max(a.length, b.length)
  const by = Math.abs(a.length - b.length)
  const what = b.length > a.length ? `${plural(by, 'note')} added` : `${plural(by, 'note')} left out`
  const own = editDistance(a, b)
  if (own <= leeway(longer)) return own > by ? `${what}, ${plural(own - by, 'note')} changed` : what
  const sa = steps(a)
  const sb = steps(b)
  if (Math.min(sa.length, sb.length) >= 2 && editDistance(sa, sb) <= leeway(longer)) return `moved, ${what}`
  if (b.length < a.length && sb.length >= 2 && contains(sa, sb)) return 'a piece of it'
  if (b.length > a.length && sa.length >= 2 && contains(sb, sa)) return 'carried on further'
  return undefined
}

/**
 * Is `b` the phrase `a` again, and what changed? `moved` says it started on
 * another beat of the bar: on its own that is a change too.
 */
export function compareMotif(a: readonly MotifNote[], b: readonly MotifNote[], moved = false): Relation {
  const pa = a.map((n) => n.midi)
  const pb = b.map((n) => n.midi)
  if (a.length !== b.length) {
    const change = lengthChange(pa, pb)
    return change ? { kind: 'varied', changes: [change] } : { kind: 'new', changes: [] }
  }
  const pitch = pitchChange(pa, pb)
  const rhythm = rhythmChange(a, b)
  if (pitch === undefined) {
    // Other notes on the same rhythm is the phrase again, if the rhythm is one you could recognise.
    return rhythm === null && shaped(gaps(a)) ? { kind: 'varied', changes: ['same rhythm, new notes'] } : { kind: 'new', changes: [] }
  }
  const changes = [pitch, rhythm].filter((c): c is string => c !== null)
  if (changes.length) return { kind: 'varied', changes }
  return moved ? { kind: 'varied', changes: ['starts on another beat'] } : { kind: 'same', changes: [] }
}

/** A played phrase as the comparison reads it. */
export function motifOf(notes: readonly Struck[], beatMs: number): MotifNote[] {
  const t0 = notes[0]?.on ?? 0
  return notes.map((n) => ({ midi: n.midi, beat: (n.on - t0) / beatMs }))
}

/** Whether two places in the bar are different beats (half a beat apart or more, going round the bar). */
export function movedInBar(a: number | null, b: number | null, beatsPerBar = 4): boolean {
  if (a === null || b === null) return false
  const d = (((a - b) % beatsPerBar) + beatsPerBar) % beatsPerBar
  return Math.min(d, beatsPerBar - d) >= 0.4
}

export type MotifRun = {
  /** The phrase the next one is compared with. */
  last: { notes: MotifNote[]; beatInBar: number | null } | null
  /** Times in a row the current phrase has been played again with a change. */
  developed: number
}

export const NEW_MOTIF: MotifRun = { last: null, developed: 0 }

export type MotifVerdict = {
  /**
   * 'first' = a phrase to work on; 'varied' = it again, changed; 'same' = it
   * again, unchanged; 'early' = another phrase before this one was developed.
   */
  kind: 'first' | 'varied' | 'same' | 'early'
  changes: string[]
}

/**
 * Takes the next phrase. `want` is how many times a phrase should come back
 * changed before a new one is welcome.
 */
export function motifStep(
  run: MotifRun,
  phrase: { notes: MotifNote[]; beatInBar: number | null },
  want: number,
): { run: MotifRun; verdict: MotifVerdict } {
  if (!run.last) return { run: { last: phrase, developed: 0 }, verdict: { kind: 'first', changes: [] } }
  const rel = compareMotif(run.last.notes, phrase.notes, movedInBar(run.last.beatInBar, phrase.beatInBar))
  if (rel.kind === 'same') return { run, verdict: { kind: 'same', changes: [] } }
  if (rel.kind === 'varied') {
    return { run: { last: phrase, developed: run.developed + 1 }, verdict: { kind: 'varied', changes: rel.changes } }
  }
  const kind = run.developed >= want ? 'first' : 'early'
  return { run: { last: phrase, developed: 0 }, verdict: { kind, changes: [] } }
}
