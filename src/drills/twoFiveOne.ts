// The 2-5-1 through all 12 keys.
//
// Each shape is the three chords of one key written as semitones from the ROOT
// OF THE TWO CHORD, so the voice leading is in the table: what stays is the same
// number twice, what moves is one or two numbers changing. To fix or add a
// shape, edit only FORMS.

export type Tonality = 'major' | 'minor'

/** Semitone offsets from the two chord's root, for ii, V and I. */
type Triple = [number[], number[], number[]]

export type Form = {
  id: string
  label: string
  note: string
  /** Lowest MIDI note the two chord's root may take; it lands in the 12 semitones from here. */
  lowestRoot: number
  /** The first number of each chord is a lone root in the left hand, under the shape. */
  bass: boolean
  major: Triple
  /** Missing when the lesson gives no minor version of the shape. */
  minor?: Triple
}

export const FORMS: Form[] = [
  {
    id: 'close',
    label: 'close position',
    note: 'One hand. The two in root position; the five keeps the bottom two notes and finds its root and third; the one keeps the top two and finds its root and third.',
    lowestRoot: 55, // G3: Dm7 sits on D4
    bass: false,
    major: [
      [0, 3, 7, 10], // Dm7: D F A C
      [0, 3, 5, 9], //  G7:  D F G B
      [-2, 2, 5, 9], // Cmaj7: C E G B
    ],
    minor: [
      [0, 3, 6, 10], // Dø:  D F Ab C
      [0, 3, 5, 9], //  G7:  D F G B
      [-2, 1, 5, 8], // Cm7: C Eb G Bb
    ],
  },
  {
    id: 'shells-37',
    label: 'shells, from A',
    note: 'Root in the left hand, third and seventh in the right, starting with the third below (position A). The seventh falls a half step to become the next third.',
    lowestRoot: 48, // C3, like the voicing drill
    bass: true,
    major: [
      [0, 3, 10], //  D | F C
      [-7, 3, 9], //  G | F B
      [-2, 2, 9], //  C | E B
    ],
    minor: [
      [0, 3, 10],
      [-7, 3, 9],
      [-2, 1, 8], //  C | Eb Bb
    ],
  },
  {
    id: 'shells-73',
    label: 'shells, from B',
    note: 'The same shells started the other way up (position B): seventh at the bottom, third on top.',
    lowestRoot: 48,
    bass: true,
    major: [
      [0, 10, 15], // D | C F
      [-7, 9, 15], // G | B F
      [-2, 9, 14], // C | B E
    ],
    minor: [
      [0, 10, 15],
      [-7, 9, 15],
      [-2, 8, 13], // C | Bb Eb
    ],
  },
  {
    id: 'rootless-a',
    label: 'rootless, from A',
    note: 'Root in the left hand; the right plays 3-5-7-9. Into the five only one note moves, a half step down, and the fifth it would have is the 13th.',
    lowestRoot: 48,
    bass: true,
    major: [
      [0, 15, 19, 22, 26], //  D | F A C E
      [-7, 15, 19, 21, 26], // G | F A B E
      [-2, 14, 17, 21, 24], // C | E G B D
    ],
  },
  {
    id: 'rootless-b',
    label: 'rootless, from B',
    note: 'The rootless shape inverted, seventh at the bottom. Again one note moves into the five.',
    lowestRoot: 48,
    bass: true,
    major: [
      [0, 10, 14, 15, 19], //  D | C E F A
      [-7, 9, 14, 15, 19], //  G | B E F A
      [-2, 9, 12, 14, 17], //  C | B D E G
    ],
  },
]

export const FORM_BY_ID = new Map(FORMS.map((f) => [f.id, f]))

export function supports(form: Form, tonality: Tonality): boolean {
  return tonality === 'major' || form.minor !== undefined
}

/**
 * The lesson's way through the 12 keys: when you land on the one, make it minor
 * and it is the two of the next key — a whole step down each time. That closes
 * after six keys, so the two chord then starts a half step up and the same walk
 * covers the other six.
 */
export const KEY_CHAIN: number[] = (() => {
  const keys: number[] = []
  for (const start of [0, 11]) for (let i = 0; i < 6; i++) keys.push((start - 2 * i + 24) % 12)
  return keys
})()

export const CHORDS_PER_LAP = KEY_CHAIN.length * 3

/** The two chord's root for a key, inside the shape's octave. */
export function twoRootMidi(form: Form, tonicPc: number): number {
  const pc = (tonicPc + 2) % 12
  return form.lowestRoot + ((((pc - form.lowestRoot) % 12) + 12) % 12)
}

/** The notes to play for chord `step` (0 = ii, 1 = V, 2 = I), lowest first. */
export function targetNotes(form: Form, tonality: Tonality, tonicPc: number, step: number): number[] {
  const triple = tonality === 'minor' && form.minor ? form.minor : form.major
  const root = twoRootMidi(form, tonicPc)
  return triple[step].map((o) => root + o).sort((a, b) => a - b)
}

const FLAT = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B']
const SHARP = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']

// Tonics written with sharps; every other key reads better in flats.
const SHARP_KEYS: Record<Tonality, number[]> = {
  major: [7, 2, 9, 4, 11], //    G D A E B
  minor: [4, 11, 6, 1, 9], //    Em Bm F♯m C♯m Am
}

function namesFor(tonality: Tonality, tonicPc: number): string[] {
  return SHARP_KEYS[tonality].includes(tonicPc) ? SHARP : FLAT
}

export function keyName(tonality: Tonality, tonicPc: number): string {
  return `${namesFor(tonality, tonicPc)[tonicPc]} ${tonality}`
}

/** The three symbols of a key: "Dm7", "G7", "Cmaj7" — or "Dø", "G7", "Cm7". */
export function chordSymbols(tonality: Tonality, tonicPc: number): [string, string, string] {
  const n = namesFor(tonality, tonicPc)
  const two = n[(tonicPc + 2) % 12]
  const five = n[(tonicPc + 7) % 12]
  const one = n[tonicPc]
  return tonality === 'major' ? [`${two}m7`, `${five}7`, `${one}maj7`] : [`${two}ø`, `${five}7`, `${one}m7`]
}

// ---- laps -----------------------------------------------------------------
//
// The lesson's bar for moving on: all 12 keys note-perfect, three times in a
// row. A lap is clean when no chord in it was wrong and none was played with
// the notes on screen.

export const CLEAN_LAPS_GOAL = 3

export type Lap = {
  /** Chord index in the lap, 0..35: key = floor(pos / 3), chord = pos % 3. */
  pos: number
  /** A wrong chord, a skipped one, or one played off the screen. */
  dirty: boolean
  /** Clean laps in a row, not counting the one in progress. */
  streak: number
}

export const NEW_LAP: Lap = { pos: 0, dirty: false, streak: 0 }

export function lapKey(lap: Lap): number {
  return Math.floor(lap.pos / 3)
}

export function lapStep(lap: Lap): number {
  return lap.pos % 3
}

export function spoil(lap: Lap): Lap {
  return lap.dirty ? lap : { ...lap, dirty: true }
}

/** Moves to the next chord; closing the lap settles the streak. */
export function advance(lap: Lap): Lap {
  if (lap.pos + 1 < CHORDS_PER_LAP) return { ...lap, pos: lap.pos + 1 }
  return { pos: 0, dirty: false, streak: lap.dirty ? 0 : lap.streak + 1 }
}
