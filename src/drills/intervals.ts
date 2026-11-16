import { itemId, splitItem } from './speed'
import { ROOT_NAMES, curriculum, noteAbove } from './spell'

// The eleven intervals inside an octave. The octave itself is left out: "an
// octave above D♭" asks nothing.
//
// `tonal` is the interval in tonal's notation, used only to spell the answer.

export type IntervalDef = { id: string; semitones: number; name: string; tonal: string }

export const INTERVALS: IntervalDef[] = [
  { id: 'm2', semitones: 1, name: 'minor 2nd', tonal: '2m' },
  { id: 'M2', semitones: 2, name: 'major 2nd', tonal: '2M' },
  { id: 'm3', semitones: 3, name: 'minor 3rd', tonal: '3m' },
  { id: 'M3', semitones: 4, name: 'major 3rd', tonal: '3M' },
  { id: 'P4', semitones: 5, name: 'perfect 4th', tonal: '4P' },
  { id: 'TT', semitones: 6, name: 'tritone', tonal: '5d' },
  { id: 'P5', semitones: 7, name: 'perfect 5th', tonal: '5P' },
  { id: 'm6', semitones: 8, name: 'minor 6th', tonal: '6m' },
  { id: 'M6', semitones: 9, name: 'major 6th', tonal: '6M' },
  { id: 'm7', semitones: 10, name: 'minor 7th', tonal: '7m' },
  { id: 'M7', semitones: 11, name: 'major 7th', tonal: '7M' },
]

const BY_ID = new Map(INTERVALS.map((i) => [i.id, i]))

// The order intervals are learned in, following the lesson: first the ones a
// seventh chord is made of, then the natural extensions (9th, 11th, the ♯11),
// then what is left (♭9, 13th, ♭13).
export const INTERVAL_TIERS = [
  ['M3', 'm3', 'P5', 'm7', 'M7'],
  ['M2', 'P4', 'TT'],
  ['m2', 'M6', 'm6'],
]

/** Every question for the given intervals — each one from all 12 notes — in learning order. */
export function intervalItems(intervalIds: readonly string[]): string[] {
  return curriculum(INTERVAL_TIERS, intervalIds, itemId)
}

export type IntervalQuestion = {
  interval: IntervalDef
  rootPc: number
  /** The pitch class to play; any octave counts. */
  answerPc: number
  /** The answer's name, shown only after a miss. */
  answerName: string
}

export function intervalQuestion(id: string): IntervalQuestion {
  const { row, pc } = splitItem(id)
  const interval = BY_ID.get(row) ?? INTERVALS[0]
  return {
    interval,
    rootPc: pc,
    answerPc: (pc + interval.semitones) % 12,
    answerName: noteAbove(ROOT_NAMES[pc], interval.tonal),
  }
}
