import { Chord, Interval, Scale } from 'tonal'

// Shred pattern DSL.
//
// Same idea as the voicings table: describe the SHAPE and derive the notes,
// instead of writing them out one by one. An exercise becomes ~8 lines of data
// and comes out in all 12 keys, in any number of octaves, in any subdivision.

export type Source =
  /** A tonal scale name: 'minor pentatonic', 'bebop dominant', 'whole tone'. */
  | { kind: 'scale'; name: string }
  /** A tonal chord name: 'maj7', 'dim7'. */
  | { kind: 'chord'; name: string }
  /** Hand-written semitones, for shapes that have no name. */
  | { kind: 'semitones'; steps: number[] }

export type Motion =
  /** 0 1 2 3 4 ... — a plain scale or arpeggio. */
  | { kind: 'run' }
  /** Groups of N: 0123 1234 2345 ... — the guitar shred pattern. */
  | { kind: 'seq'; group: number; step: number }
  /**
   * Repeats a SHAPE climbing `step` degrees at a time. It is the engine behind
   * Hanon and nearly every sequenced exercise: [0,2,3,4,5,4,3,2] step 1 is Hanon 1.
   */
  | { kind: 'shape'; degrees: number[]; step: number }
  /** Thirds (interval 2), fourths (3): 0 2 1 3 2 4 ... */
  | { kind: 'skip'; interval: number }
  /** Pedal note interleaved: 0 p 1 p 2 p ... */
  | { kind: 'pedal'; pedalIndex: number }
  /** Degrees written out by hand, for Hanon and original figures. */
  | { kind: 'literal'; degrees: number[] }

export type Hands =
  | { kind: 'rh' }
  | { kind: 'lh' }
  /** Both hands on the same shape, N octaves apart. */
  | { kind: 'unison'; octaveGap: number }
  /**
   * Swaps hand every `unit` notes. NOTE: with lhOctaveShift 0 both hands play the
   * same pitch and MIDI cannot tell who played it — the hand becomes a purely
   * visual hint. With -1 they can actually be told apart.
   */
  | { kind: 'alternate'; unit: number; lhOctaveShift: number }
  /** Left hand looping underneath, right hand on the main pattern. */
  | { kind: 'ostinato'; degrees: number[]; subdivision: number; octaveShift: number }

export type Fingering = {
  /** byDegree: indexed by scale degree. bySequence: by played position. */
  kind: 'byDegree' | 'bySequence'
  /** Right hand. */
  fingers: number[]
  /**
   * Left hand, when its shape is not the same. It cannot be derived from the
   * right by any formula — in C major the right is 1 2 3 1 2 3 4 and the left is
   * 1 4 3 2 1 3 2. Where it is not written out, the left hand gets no number,
   * which beats a wrong one.
   */
  lh?: number[]
  /**
   * Fingering is not the same in every key: the thumb does not go on a black
   * key, so the crossing point moves. F major is the classic case — the right
   * hand is 1 2 3 4 1 2 3, not the 1 2 3 1 2 3 4 of C. Keyed by pitch class of
   * the root; whatever is not listed falls back to `fingers`/`lh`.
   */
  byRoot?: Partial<Record<number, { fingers?: number[]; lh?: number[] }>>
}

export type PatternSpec = {
  source: Source
  motion: Motion
  hands: Hands
  octaves: number
  direction: 'up' | 'down' | 'updown'
  /** Notes per beat. 4 = sixteenths, 3 = triplets, 5 and 7 = odd groupings. */
  subdivision: number
  /** MIDI of the C in the base octave. The root sits at anchorC + rootPc. */
  anchorC: number
  /** How many times the whole shape runs in one rep. Short figures need it. */
  reps?: number
  fingering?: Fingering
}

export type ExpectedNote = {
  index: number
  /** Notes sharing a group sound together. IOI only looks at each group onset. */
  group: number
  midi: number
  hand: 'l' | 'r'
  /** Position in beats since the start of the rep. BPM comes in only later. */
  beat: number
  finger?: number
}

export type Expansion = {
  notes: ExpectedNote[]
  /** Length of the rep in beats. */
  beats: number
  /** How many attack groups — this is the denominator of the accuracy. */
  groups: number
  warning?: string
}

export type Range = { low: number; high: number }

/** Semitones of each degree within an octave, e.g. minor pentatonic -> [0,3,5,7,10]. */
export function sourceSteps(source: Source): number[] {
  if (source.kind === 'semitones') return source.steps
  const intervals =
    source.kind === 'scale'
      ? Scale.get(`C ${source.name}`).intervals
      : Chord.get(`C${source.name}`).intervals
  if (!intervals.length) throw new Error(`unknown source: ${source.name}`)
  return intervals.map((i) => Interval.semitones(i) ?? 0)
}

/**
 * Degree -> semitones above the root, letting the index run past an octave.
 * Degree 5 on a 5-note pentatonic is the tonic one octave up.
 */
export function degreeSemitone(steps: number[], i: number): number {
  const n = steps.length
  const oct = Math.floor(i / n)
  const idx = ((i % n) + n) % n
  return steps[idx] + 12 * oct
}

/** The shape of the motion as a list of degrees, before it becomes pitch. */
export function degreeSequence(motion: Motion, top: number): number[] {
  switch (motion.kind) {
    case 'run': {
      const out: number[] = []
      for (let i = 0; i <= top; i++) out.push(i)
      return out
    }
    case 'seq': {
      const out: number[] = []
      for (let start = 0; start + motion.group - 1 <= top; start += motion.step) {
        for (let k = 0; k < motion.group; k++) out.push(start + k)
      }
      return out
    }
    case 'skip': {
      const out: number[] = []
      for (let i = 0; i + motion.interval <= top; i++) {
        out.push(i, i + motion.interval)
      }
      return out
    }
    case 'pedal': {
      const out: number[] = []
      for (let i = 0; i <= top; i++) {
        if (i === motion.pedalIndex) continue
        out.push(i, motion.pedalIndex)
      }
      return out
    }
    case 'shape': {
      const out: number[] = []
      const span = Math.max(...motion.degrees)
      if (motion.step <= 0) return [...motion.degrees] // step 0 never climbs: must not become an infinite loop
      for (let r = 0; span + r * motion.step <= top; r += 1) {
        for (const d of motion.degrees) out.push(d + r * motion.step)
      }
      return out
    }
    case 'literal':
      return [...motion.degrees]
  }
}

function applyDirection(
  seq: number[],
  direction: PatternSpec['direction'],
  top: number,
): number[] {
  if (direction === 'up') return seq
  if (direction === 'down') return [...seq].reverse()

  // The way back is the MIRROR around the top, not the retrograde.
  //
  // For a symmetric shape (scale, arpeggio, thirds) the two are identical. For an
  // asymmetric figure they diverge, and the mirror is the right one: in Hanon 1
  // the descending part is the reflected figure, not the figure played backwards.
  const mirror = seq.map((g) => top - g)

  // Repeats neither the peak nor the trough: the exercise runs in a loop, so the
  // last note of the descent joins the first note of the next ascent.
  let start = 0
  while (start < mirror.length && mirror[start] === seq[seq.length - 1]) start++
  let end = mirror.length
  while (end > start && mirror[end - 1] === seq[0]) end--

  return [...seq, ...mirror.slice(start, end)]
}

function fingerFor(
  fingering: Fingering | undefined,
  rootPc: number,
  degree: number,
  position: number,
  n: number,
  hand: 'l' | 'r',
) {
  if (!fingering) return undefined
  const perKey = fingering.byRoot?.[((rootPc % 12) + 12) % 12]
  const list =
    hand === 'l' ? (perKey?.lh ?? fingering.lh) : (perKey?.fingers ?? fingering.fingers)
  if (!list || !list.length) return undefined
  return fingering.kind === 'byDegree'
    ? list[((degree % n) + n) % n % list.length]
    : list[position % list.length]
}

/**
 * Pattern -> notes with pitch and position in time.
 * `range` is the keyboard available: if the shape does not fit, it drops an
 * octave, and if it still does not fit, it trims an octave and says so.
 */
export function expandPattern(spec: PatternSpec, rootPc: number, range: Range): Expansion {
  let octaves = Math.max(1, spec.octaves)
  let warning: string | undefined

  for (;;) {
    const built = build(spec, rootPc, octaves)
    const lows = built.map((e) => e.midi)
    const min = Math.min(...lows)
    const max = Math.max(...lows)

    // Does it fit by transposing octaves?
    let shift = 0
    if (max > range.high) shift -= 12 * Math.ceil((max - range.high) / 12)
    if (min + shift < range.low) shift += 12 * Math.ceil((range.low - (min + shift)) / 12)

    if (min + shift >= range.low && max + shift <= range.high) {
      const notes = built.map((e) => ({ ...e, midi: e.midi + shift }))
      const groups = new Set(notes.map((n) => n.group)).size
      const beats = Math.max(...notes.map((n) => n.beat)) + 1 / spec.subdivision
      return { notes, beats, groups, warning }
    }

    if (octaves <= 1) {
      // Shape too wide for the keyboard even at one octave: hand it over anyway,
      // transposed as far as it goes, with the warning.
      const notes = built.map((e) => ({ ...e, midi: e.midi + shift }))
      const groups = new Set(notes.map((n) => n.group)).size
      const beats = Math.max(...notes.map((n) => n.beat)) + 1 / spec.subdivision
      return { notes, beats, groups, warning: 'Pattern does not fit the configured keyboard.' }
    }

    octaves -= 1
    warning = `Trimmed to ${octaves} octave${octaves > 1 ? 's' : ''}: does not fit the keyboard.`
  }
}

function build(spec: PatternSpec, rootPc: number, octaves: number): ExpectedNote[] {
  const steps = sourceSteps(spec.source)
  const root = spec.anchorC + rootPc
  const top = octaves * steps.length
  const once = applyDirection(degreeSequence(spec.motion, top), spec.direction, top)
  const seq = Array.from({ length: Math.max(1, spec.reps ?? 1) }, () => once).flat()

  const events: { midi: number; hand: 'l' | 'r'; beat: number; finger?: number }[] = []
  const h = spec.hands

  seq.forEach((degree, i) => {
    const beat = i / spec.subdivision
    const midi = root + degreeSemitone(steps, degree)
    const finger = (hand: 'l' | 'r') =>
      fingerFor(spec.fingering, rootPc, degree, i, steps.length, hand)

    switch (h.kind) {
      case 'rh':
        events.push({ midi, hand: 'r', beat, finger: finger('r') })
        break
      case 'lh':
        events.push({ midi: midi - 12, hand: 'l', beat, finger: finger('l') })
        break
      case 'unison':
        events.push({ midi, hand: 'r', beat, finger: finger('r') })
        events.push({ midi: midi - 12 * h.octaveGap, hand: 'l', beat, finger: finger('l') })
        break
      case 'alternate': {
        const left = Math.floor(i / h.unit) % 2 === 1
        events.push({
          midi: left ? midi + 12 * h.lhOctaveShift : midi,
          hand: left ? 'l' : 'r',
          beat,
          finger: finger(left ? 'l' : 'r'),
        })
        break
      }
      case 'ostinato':
        events.push({ midi, hand: 'r', beat, finger: finger('r') })
        break
    }
  })

  // Ostinato: the left hand runs its own loop over the same timeline.
  if (h.kind === 'ostinato' && h.degrees.length) {
    const totalBeats = seq.length / spec.subdivision
    const count = Math.round(totalBeats * h.subdivision)
    for (let i = 0; i < count; i++) {
      const degree = h.degrees[i % h.degrees.length]
      events.push({
        midi: root + degreeSemitone(steps, degree) + 12 * h.octaveShift,
        hand: 'l',
        beat: i / h.subdivision,
      })
    }
  }

  // Sort by time and group what is simultaneous — the grading must not demand an
  // order between two notes that are supposed to sound together.
  events.sort((a, b) => a.beat - b.beat || a.midi - b.midi)

  let group = -1
  let lastBeat = Number.NaN
  return events.map((e, index) => {
    if (e.beat !== lastBeat) {
      group += 1
      lastBeat = e.beat
    }
    return { index, group, midi: e.midi, hand: e.hand, beat: e.beat, finger: e.finger }
  })
}

/**
 * Hand override chosen on the fly, on top of what the table says.
 * 'as-is' respects the arrangement of the exercise; the others force it.
 */
export type HandMode = 'as-is' | 'rh' | 'lh' | 'both'

/** In menu order: one hand first, because that is where practice starts. */
export const HAND_MODE_LABEL: Record<HandMode, string> = {
  rh: 'right hand only',
  lh: 'left hand only',
  both: 'both in octaves',
  'as-is': 'as written',
}

/**
 * Hands separately and then together is the normal way to study any passage, and
 * only the arrangement changes — shape, subdivision and fingering stay the same.
 */
export function applyHandMode(spec: PatternSpec, mode: HandMode): PatternSpec {
  switch (mode) {
    case 'as-is':
      return spec
    case 'rh':
      return { ...spec, hands: { kind: 'rh' } }
    case 'lh':
      return { ...spec, hands: { kind: 'lh' } }
    case 'both':
      return { ...spec, hands: { kind: 'unison', octaveGap: 1 } }
  }
}
