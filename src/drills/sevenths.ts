import { Interval } from 'tonal'
import type { KeyMark } from '../keyboard'
import { itemId, splitItem } from './speed'
import { ROOT_NAMES, curriculum, glyph, nearestWithPc, noteAbove } from './spell'

// The chords built from all 12 notes against the clock. The first three are the
// ones "most jazz songs are built of"; the rest are every other four-note chord
// a lead sheet asks for. Written as intervals so the answer can be spelled.

export type ChordDef = {
  id: string
  /** What follows the root in the symbol. */
  suffix: string
  name: string
  intervals: string[]
  /** On by default. */
  core?: boolean
}

export const CHORDS: ChordDef[] = [
  { id: 'maj7', suffix: 'maj7', name: 'major 7', intervals: ['1P', '3M', '5P', '7M'], core: true },
  { id: 'm7', suffix: 'm7', name: 'minor 7', intervals: ['1P', '3m', '5P', '7m'], core: true },
  { id: '7', suffix: '7', name: 'dominant 7', intervals: ['1P', '3M', '5P', '7m'], core: true },
  { id: 'm7b5', suffix: 'ø', name: 'half-diminished', intervals: ['1P', '3m', '5d', '7m'] },
  { id: 'dim7', suffix: '°7', name: 'diminished 7', intervals: ['1P', '3m', '5d', '7d'] },
  { id: 'mMaj7', suffix: 'm(maj7)', name: 'minor-major 7', intervals: ['1P', '3m', '5P', '7M'] },
  { id: '6', suffix: '6', name: 'major 6', intervals: ['1P', '3M', '5P', '6M'] },
  { id: 'm6', suffix: 'm6', name: 'minor 6', intervals: ['1P', '3m', '5P', '6M'] },
  { id: '7#5', suffix: '7♯5', name: 'dominant 7 ♯5', intervals: ['1P', '3M', '5A', '7m'] },
]

const BY_ID = new Map(CHORDS.map((c) => [c.id, c]))

export function chordSemitones(chord: ChordDef): number[] {
  return chord.intervals.map((i) => Interval.semitones(i) ?? 0)
}

const CHORD_TIERS = [CHORDS.filter((c) => c.core).map((c) => c.id), CHORDS.filter((c) => !c.core).map((c) => c.id)]

/** Every question for the given chord types — each from all 12 roots — in learning order. */
export function chordItems(chordIds: readonly string[]): string[] {
  return curriculum(CHORD_TIERS, chordIds, itemId)
}

export type ChordQuestion = {
  chord: ChordDef
  rootPc: number
  /** "F♯m7" */
  symbol: string
  /** The four notes from the root up, spelled: shown only after a miss. */
  spelled: string[]
}

export function chordQuestion(id: string): ChordQuestion {
  const { row, pc } = splitItem(id)
  const chord = BY_ID.get(row) ?? CHORDS[0]
  const root = ROOT_NAMES[pc]
  return {
    chord,
    rootPc: pc,
    symbol: glyph(root) + chord.suffix,
    spelled: chord.intervals.map((i) => glyph(noteAbove(root, i))),
  }
}

const pcOf = (midi: number) => ((midi % 12) + 12) % 12

/**
 * Root position: exactly the chord's notes, in any octave and with any
 * doubling, and the root at the bottom. An inversion is not what is asked —
 * the drill is the interval pattern counted up from the root.
 */
export function isRootPosition(notes: readonly number[], rootPc: number, chord: ChordDef): boolean {
  if (notes.length === 0) return false
  const want = new Set(chordSemitones(chord).map((s) => (rootPc + s) % 12))
  const got = new Set(notes.map(pcOf))
  if (got.size !== want.size) return false
  for (const pc of got) if (!want.has(pc)) return false
  return pcOf(Math.min(...notes)) === rootPc
}

/** The chord in close root position with its root as near `near` as it gets. */
export function rootPositionNear(rootPc: number, chord: ChordDef, near: number): number[] {
  const root = nearestWithPc(rootPc, near)
  return chordSemitones(chord).map((s) => root + s)
}

/**
 * Keys to colour: what is held, as chord note or not, and — once the answer is
 * given away — the notes still missing, around where the hand already is.
 */
export function chordMarks(
  held: readonly number[],
  rootPc: number,
  chord: ChordDef,
  reveal: boolean,
): Map<number, KeyMark> {
  const want = new Set(chordSemitones(chord).map((s) => (rootPc + s) % 12))
  const marks = new Map<number, KeyMark>()
  if (reveal) {
    const heldPcs = new Set(held.map(pcOf))
    const near = held.length ? Math.min(...held) : 60
    for (const n of rootPositionNear(rootPc, chord, near)) if (!heldPcs.has(pcOf(n))) marks.set(n, 'missing')
  }
  for (const n of held) marks.set(n, want.has(pcOf(n)) ? 'correct' : 'extra')
  return marks
}
