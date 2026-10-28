import { Chord, Interval, Note } from 'tonal'
import { rng, type PlayedNote } from './played'

// Synthetic performances for the tests: a scale, a Hanon, a lick, a vamp, a
// progression, rubato — each from a seed, with as much timing jitter as asked.
//
// The estimators are tuned against these, not against recordings, so the
// fixtures try to be honest about what a person does: notes overlap a little
// (legato), the beat gets a slightly heavier touch when asked, and nothing lands
// exactly on the grid.

export const MODE_STEPS = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
} as const

export type FixtureMode = keyof typeof MODE_STEPS

/** Scale degree (0-based, any octave, negatives allowed) to MIDI. */
export function degreeMidi(tonic: number, mode: FixtureMode, degree: number): number {
  const steps = MODE_STEPS[mode]
  const oct = Math.floor(degree / 7)
  return tonic + 12 * oct + steps[((degree % 7) + 7) % 7]
}

export type StreamOpts = {
  bpm: number
  /** Performance clock of the first note, ms. */
  startMs?: number
  seed?: number
  /** Uniform timing noise, ± this many ms. */
  jitterMs?: number
  velocity?: number
  /** Extra velocity on notes that start a beat. 0 = flat touch. */
  accent?: number
  /** Fraction of the gap to the next note the key is held. Over 1 overlaps. */
  legato?: number
  /** Tempo at a beat position, for a ritardando or an accelerando. Overrides `bpm` when set. */
  bpmAt?: (beat: number) => number
}

/** Performance time of a beat position under a tempo curve (midpoint rule, 1/32 beat). */
export function timeOf(pos: number, opts: StreamOpts): number {
  const start = opts.startMs ?? 0
  if (!opts.bpmAt) return start + pos * (60000 / opts.bpm)
  let t = start
  const d = 1 / 32
  let b = 0
  for (; b + d <= pos; b += d) t += (60000 / opts.bpmAt(b + d / 2)) * d
  return t + (60000 / opts.bpmAt((b + pos) / 2)) * (pos - b)
}

/**
 * The building block: one pitch (or chord) per step, each step lasting
 * `beats[i]` beats. Every other generator is a choice of pitches and rhythm.
 */
export function fromRhythm(steps: (number | number[])[], beats: number[], opts: StreamOpts): PlayedNote[] {
  const rand = rng(opts.seed ?? 1)
  const jitter = opts.jitterMs ?? 0
  const vel = opts.velocity ?? 72
  const accent = opts.accent ?? 0
  const legato = opts.legato ?? 0.95
  const out: PlayedNote[] = []
  let pos = 0
  for (let i = 0; i < steps.length; i++) {
    const len = beats[i % beats.length]
    const onBeat = Math.abs(pos - Math.round(pos)) < 1e-6
    const t = timeOf(pos, opts) + (rand() * 2 - 1) * jitter
    const lenMs = timeOf(pos + len, opts) - timeOf(pos, opts)
    const v = Math.max(1, Math.min(127, Math.round(vel + (onBeat ? accent : 0) + (rand() * 2 - 1) * 4)))
    const pitches = Array.isArray(steps[i]) ? (steps[i] as number[]) : [steps[i] as number]
    for (const [j, midi] of pitches.entries()) {
      // A chord's notes never land together: a few ms of spread per finger.
      const on = t + j * (2 + rand() * 6)
      out.push({ midi, velocity: v, on, off: on + lenMs * legato, lowest: false })
    }
    pos += len
  }
  return markLowest(out)
}

/** Flags each note that was the lowest sounding one when it was struck. */
export function markLowest(notes: PlayedNote[]): PlayedNote[] {
  const sorted = [...notes].sort((a, b) => a.on - b.on)
  for (const n of sorted) {
    n.lowest = !sorted.some((m) => m !== n && m.on <= n.on && m.off > n.on && m.midi < n.midi)
  }
  return sorted
}

/** Up and down the scale, `octaves` wide, ending on a held tonic. */
export function scaleRun(
  tonic: number,
  mode: FixtureMode,
  opts: StreamOpts & { octaves?: number; perBeat?: number; repeats?: number },
): PlayedNote[] {
  const span = 7 * (opts.octaves ?? 2)
  const one: number[] = []
  for (let d = 0; d < span; d++) one.push(degreeMidi(tonic, mode, d))
  for (let d = span; d > 0; d--) one.push(degreeMidi(tonic, mode, d))
  const steps: number[] = []
  for (let r = 0; r < (opts.repeats ?? 1); r++) steps.push(...one)
  steps.push(tonic)
  const sub = 1 / (opts.perBeat ?? 4)
  const beats = steps.map((_, i) => (i === steps.length - 1 ? 2 : sub))
  return fromRhythm(steps, beats, opts)
}

/** Hanon no. 1 (the shape 0 2 3 4 5 4 3 2, climbing a step at a time), in sixteenths. */
export function hanon1(tonic: number, opts: StreamOpts & { groups?: number }): PlayedNote[] {
  const shape = [0, 2, 3, 4, 5, 4, 3, 2]
  const steps: number[] = []
  for (let g = 0; g < (opts.groups ?? 14); g++) {
    for (const d of shape) steps.push(degreeMidi(tonic, 'major', d + g))
  }
  return fromRhythm(steps, [0.25], opts)
}

/** A minor lick on any tonic: leans on the root and the fifth, the leading tone on the way home. */
export function minorLick(tonic: number, opts: StreamOpts & { repeats?: number }): PlayedNote[] {
  const deg = [0, 2, 3, 4, 5, 4, 3, 2, 0, -1, 0, 4, 5, 7, 6, 5, 4, 3, 2, 0]
  const rhythm = [0.5, 0.25, 0.25, 0.5, 0.25, 0.25, 0.25, 0.25, 0.5, 0.5, 1, 0.5, 0.25, 0.25, 0.5, 0.25, 0.25, 0.5, 0.5, 2]
  const steps: number[] = []
  const beats: number[] = []
  for (let r = 0; r < (opts.repeats ?? 3); r++) {
    deg.forEach((d, i) => {
      // The leading tone of the harmonic minor on the way back down, as in a real line.
      steps.push(degreeMidi(tonic, d === -1 ? 'harmonicMinor' : 'minor', d))
      beats.push(rhythm[i])
    })
  }
  return fromRhythm(steps, beats, opts)
}

/**
 * A dorian vamp: the tonic held in the bass the whole time, the left hand
 * alternating i7 and IV over it a bar each; the right hand runs the mode,
 * starting and ending its phrases on the tonic.
 */
export function dorianVamp(tonic: number, opts: StreamOpts & { bars?: number }): PlayedNote[] {
  const bars = opts.bars ?? 8
  const lh: number[][] = []
  const rh: number[] = []
  const lines = [
    [0, 2, 4, 5, 4, 3, 1, 0],
    [0, 1, 2, 3, 4, 5, 6, 7],
  ]
  const base = tonic - 24
  for (let b = 0; b < bars; b++) {
    // i7 (root, 3, 5, 7) then IV over the same bass: the raised sixth is the IV's third.
    const upper = b % 2 === 0 ? [12, 15, 19, 22] : [17, 21, 24]
    lh.push([base, ...upper.map((c) => base + c)])
    for (const d of lines[b % 2]) rh.push(degreeMidi(tonic, 'dorian', d))
  }
  const left = fromRhythm(lh, [4], { ...opts, legato: 1 })
  const right = fromRhythm(rh, [0.5], { ...opts, seed: (opts.seed ?? 1) + 1 })
  return markLowest([...left, ...right])
}

/** Block chords from symbols, `beatsEach` beats apiece, voiced close above C3. */
export function chordStream(symbols: string[], opts: StreamOpts & { beatsEach?: number }): PlayedNote[] {
  const steps = symbols.map((s) => {
    const c = Chord.get(s)
    const root = 48 + (Note.chroma(c.tonic ?? 'C') ?? 0)
    return c.intervals.map((iv) => root + (Interval.semitones(iv) ?? 0))
  })
  return fromRhythm(steps, [opts.beatsEach ?? 4], { ...opts, legato: 1 })
}

/** Notes from a scale at random gaps of 200-900 ms: no pulse to find. */
export function rubato(tonic: number, mode: FixtureMode, opts: { seed?: number; count?: number; startMs?: number }): PlayedNote[] {
  const rand = rng(opts.seed ?? 3)
  const out: PlayedNote[] = []
  let t = opts.startMs ?? 0
  for (let i = 0; i < (opts.count ?? 40); i++) {
    const gap = 200 + rand() * 700
    const d = Math.floor(rand() * 9)
    out.push({ midi: degreeMidi(tonic, mode, d), velocity: 60 + Math.floor(rand() * 20), on: t, off: t + gap * 0.9, lowest: false })
    t += gap
  }
  return markLowest(out)
}

/** Swung (or straight, ratio 0.5) eighths: long-short pairs inside each beat. */
export function swingEighths(tonic: number, opts: StreamOpts & { ratio: number; beats?: number }): PlayedNote[] {
  const steps: number[] = []
  const beats: number[] = []
  for (let b = 0; b < (opts.beats ?? 24); b++) {
    steps.push(degreeMidi(tonic, 'mixolydian', b % 8), degreeMidi(tonic, 'mixolydian', (b % 8) + 2))
    beats.push(opts.ratio, 1 - opts.ratio)
  }
  return fromRhythm(steps, beats, opts)
}

/** Quarters, eighths, a dotted figure: the rhythm of a tune, not of an exercise. */
export function mixedRhythm(tonic: number, opts: StreamOpts & { bars?: number }): PlayedNote[] {
  const bar = [1, 0.5, 0.5, 1, 1, 0.5, 0.5, 0.5, 0.5, 1.5, 0.5, 1, 1]
  const steps: number[] = []
  const beats: number[] = []
  for (let b = 0; b < (opts.bars ?? 6); b++) {
    bar.forEach((len, i) => {
      steps.push(degreeMidi(tonic, 'major', (i * 3 + b) % 9))
      beats.push(len)
    })
  }
  return fromRhythm(steps, beats, opts)
}

/** Holds every note until the next pedal change, as a sustain pedal does. */
export function withPedal(notes: PlayedNote[], pedalMs: number): PlayedNote[] {
  return notes.map((n) => {
    const lift = Math.ceil((n.on + 1) / pedalMs) * pedalMs
    return { ...n, off: Math.max(n.off, lift) }
  })
}

/** Shifts a stream in time. */
export function shift(notes: PlayedNote[], ms: number): PlayedNote[] {
  return notes.map((n) => ({ ...n, on: n.on + ms, off: n.off + ms }))
}

/** End time of a stream (last note-off). */
export function endOf(notes: PlayedNote[]): number {
  return notes.reduce((m, n) => Math.max(m, n.off), 0)
}

// --- harder cases: tunes, modulations, syncopation, held notes ----------------

/** A diatonic chord on a scale degree (0-based): a triad, or a seventh chord. */
export function degreeChord(tonic: number, mode: FixtureMode, degree: number, seventh = false): number[] {
  return (seventh ? [0, 2, 4, 6] : [0, 2, 4]).map((d) => degreeMidi(tonic, mode, degree + d))
}

const TUNE_BARS = [
  [1, 0.5, 0.5, 1, 1],
  [0.5, 0.5, 0.5, 0.5, 1, 1],
  [1.5, 0.5, 1, 1],
  [0.5, 0.5, 1, 0.5, 0.5, 1],
]

/**
 * A line that sounds like a tune and not an exercise: mixed rhythm, mostly
 * steps with the odd leap, leaning on the chord tones on the beat, and coming to
 * rest on the tonic (a half note) every four bars.
 */
export function tune(tonic: number, mode: FixtureMode, opts: StreamOpts & { bars?: number }): PlayedNote[] {
  const rand = rng((opts.seed ?? 1) * 7 + 3)
  const steps: number[] = []
  const beats: number[] = []
  let d = 0
  const bars = opts.bars ?? 8
  const CHORD_TONES = [0, 2, 4, 7]
  for (let b = 0; b < bars; b++) {
    if (b % 4 === 3) {
      // Cadence bar: step down to the tonic and stay there.
      for (const x of [2, 1]) steps.push(degreeMidi(tonic, mode, x)), beats.push(1)
      steps.push(degreeMidi(tonic, mode, 0)), beats.push(2)
      d = 0
      continue
    }
    TUNE_BARS[(b + Math.floor(rand() * 4)) % 4].forEach((len, i) => {
      if (i === 0) {
        // The downbeat lands on a chord tone near where the line is.
        d = CHORD_TONES.reduce((best, c) => (Math.abs(c - d) < Math.abs(best - d) ? c : best))
      } else {
        const r = rand()
        const move = r < 0.35 ? 1 : r < 0.7 ? -1 : r < 0.85 ? 2 : r < 0.95 ? -2 : 3
        d += move
        if (d < 0 || d > 9) d -= 2 * move // turn back at the edges of the range
      }
      steps.push(degreeMidi(tonic, mode, d))
      beats.push(len)
    })
  }
  return fromRhythm(steps, beats, opts)
}

/** Up and down the scale in even notes, for whole bars, from the tonic. */
export function scaleBars(tonic: number, mode: FixtureMode, opts: StreamOpts & { bars?: number; perBeat?: number }): PlayedNote[] {
  const per = opts.perBeat ?? 2
  const n = (opts.bars ?? 4) * 4 * per
  const steps: number[] = []
  for (let i = 0; i < n; i++) {
    const k = i % 28 // two octaves up (14 steps) and back down
    steps.push(degreeMidi(tonic, mode, k <= 14 ? k : 28 - k))
  }
  return fromRhythm(steps, [1 / per], opts)
}

export type Section = {
  tonic: number
  mode: FixtureMode
  bars: number
  /** What the hands do: a tune, a scale, a tune over left-hand chords, or given pitches in eighths. */
  kind: 'tune' | 'scale' | 'comped' | 'eighths'
  /** For 'comped': the chord degree of each bar (cycled). */
  degrees?: number[]
  /** For 'eighths': the pitches. */
  pitches?: number[]
}

/**
 * Sections back to back on one beat grid: a modulation, a secondary dominant,
 * a borrowed bar. Returns the notes and where each section starts.
 */
export function sections(list: Section[], opts: StreamOpts): { notes: PlayedNote[]; starts: number[] } {
  const beatMs = 60000 / opts.bpm
  const out: PlayedNote[] = []
  const starts: number[] = []
  let bar = 0
  list.forEach((sec, i) => {
    const o: StreamOpts = { ...opts, startMs: (opts.startMs ?? 0) + bar * 4 * beatMs, seed: (opts.seed ?? 1) + i * 13 }
    starts.push(o.startMs!)
    if (sec.kind === 'tune') out.push(...tune(sec.tonic, sec.mode, { ...o, bars: sec.bars }))
    else if (sec.kind === 'scale') out.push(...scaleBars(sec.tonic, sec.mode, { ...o, bars: sec.bars }))
    else if (sec.kind === 'eighths') out.push(...fromRhythm(sec.pitches!, [0.5], o))
    else {
      const degs = sec.degrees ?? [0, 5, 1, 4]
      const lh = Array.from({ length: sec.bars }, (_, b) => degreeChord(sec.tonic - 12, sec.mode, degs[b % degs.length], true))
      out.push(...fromRhythm(lh, [4], { ...o, legato: 0.98 }))
      out.push(...tune(sec.tonic + 12, sec.mode, { ...o, bars: sec.bars, seed: (o.seed ?? 1) + 5 }))
    }
    bar += sec.bars
  })
  return { notes: markLowest(out), starts }
}

/**
 * Pop syncopation: anticipations, 3-3-2, pushes onto the "and" — the off-beat
 * attacks are the long, loud ones, which is what fools a beat tracker into
 * shifting the grid half a beat.
 */
export function syncopated(tonic: number, opts: StreamOpts & { bars?: number }): PlayedNote[] {
  const BARS = [
    [1.5, 1.5, 1],
    [0.5, 1, 0.5, 1, 1],
    [1, 0.5, 1, 1, 0.5],
    [0.75, 0.75, 0.5, 1, 1],
  ]
  const steps: number[] = []
  const beats: number[] = []
  for (let b = 0; b < (opts.bars ?? 8); b++) {
    BARS[b % BARS.length].forEach((len, i) => {
      steps.push(degreeMidi(tonic, 'major', (b * 2 + i * 3) % 8))
      beats.push(len)
    })
  }
  const notes = fromRhythm(steps, beats, opts)
  // Lean on the syncopations: an attack off the beat that lasts longer than a beat.
  const beatMs = 60000 / opts.bpm
  return notes.map((n) => {
    const x = ((n.on - (opts.startMs ?? 0)) / beatMs) % 1
    const off = x > 0.2 && x < 0.8
    return off && n.off - n.on > beatMs * 0.9 ? { ...n, velocity: Math.min(127, n.velocity + 18) } : n
  })
}

/** A slow melody of half and whole notes with the odd quarter: little to measure a pulse by. */
export function heldNotes(tonic: number, opts: StreamOpts & { bars?: number }): PlayedNote[] {
  const BARS = [[2, 2], [1, 1, 2], [4], [2, 1, 1], [3, 1], [2, 2]]
  const steps: number[] = []
  const beats: number[] = []
  for (let b = 0; b < (opts.bars ?? 12); b++) {
    BARS[b % BARS.length].forEach((len, i) => {
      steps.push(degreeMidi(tonic, 'major', (b + i * 2) % 7))
      beats.push(len)
    })
  }
  return fromRhythm(steps, beats, opts)
}
