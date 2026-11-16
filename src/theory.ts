import { Chord, Interval, Midi, Note } from 'tonal'
import {
  QUALITIES,
  VOICINGS,
  type Quality,
  type Voicing,
  degreeInterval,
  degreeToSemitones,
  voicingHands,
  voicingToMidi,
} from './voicings'

export const PITCH_CLASSES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
export const PITCH_CLASSES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/**
 * The 12 roots the way a lead sheet writes them when there is no key to go by:
 * flats, except F♯. The drills ask with these names and the stage, with no key
 * signature, reads with them, so what is asked and what is read back agree.
 */
export const PITCH_CLASSES_LEAD = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']

/** 'lead' is PITCH_CLASSES_LEAD: the spelling with no key signature. */
export type Spelling = 'flat' | 'sharp' | 'lead'

const SPELLINGS: Record<Spelling, string[]> = {
  flat: PITCH_CLASSES_FLAT,
  sharp: PITCH_CLASSES_SHARP,
  lead: PITCH_CLASSES_LEAD,
}

export function midiToName(midi: number, spelling: Spelling = 'flat'): string {
  if (spelling === 'lead') return `${pitchClassName(midi, 'lead')}${Math.floor(midi / 12) - 1}`
  return Midi.midiToNoteName(midi, { sharps: spelling === 'sharp' })
}

export function pitchClassName(pc: number, spelling: Spelling = 'flat'): string {
  return SPELLINGS[spelling][((pc % 12) + 12) % 12]
}

/** A spelling nobody reads at the keyboard (A𝄫, C♭, E♯) as the plain key it is. */
export function plainName(name: string): string {
  return /bb|##|^(Cb|Fb|E#|B#)$/.test(name) ? Note.simplify(name) : name
}

/**
 * The note a tonal interval ("7m", "5d") above a root, spelled the way it is
 * counted — a minor third above C is E♭, never D♯ — except where the exact
 * spelling is one nobody reads at the keyboard (A𝄫, C♭): those become the plain key.
 */
export function noteAbove(root: string, interval: string): string {
  return plainName(Note.pitchClass(Note.transpose(root, interval)))
}

/**
 * Drops tonal's explicit major marker: a plain major triad is written "C", not "CM".
 *
 * Only the bare marker goes. An "M" followed by a digit is a different quality
 * (M7 is a major seventh, not a triad), and the lowercase "m" of a minor chord
 * and the "maj" of "Cmaj7" must survive untouched.
 *
 * Applies to inversions ("CM/E") and to extensions written on the triad
 * ("CMadd9"), because the marker sits right after the root in both.
 */
export function dropMajorMarker(name: string): string {
  return name.replace(/^([A-G][#b]*)M(?![0-9])/, '$1')
}

/** Possible chord names, likeliest first. Empty when nothing is recognized. */
export function detectChord(midi: number[], spelling: Spelling = 'flat'): string[] {
  if (midi.length < 2) return []
  const sorted = [...midi].sort((a, b) => a - b)
  const names = sorted.map((n) => midiToName(n, spelling))
  return Chord.detect(names, { assumePerfectFifth: true }).map(dropMajorMarker)
}

/** Intervals from the lowest note, e.g. ['1P', '3m', '5P', '7m']. */
export function intervalsFromBass(midi: number[]): string[] {
  if (midi.length === 0) return []
  const sorted = [...midi].sort((a, b) => a - b)
  const bass = midiToName(sorted[0])
  return sorted.map((n) => Interval.distance(bass, midiToName(n)))
}

export function midiToPitchClasses(midi: number[]): number[] {
  return [...new Set(midi.map((n) => ((n % 12) + 12) % 12))].sort((a, b) => a - b)
}

export function sameSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  const x = [...a].sort((p, q) => p - q)
  const y = [...b].sort((p, q) => p - q)
  return x.every((n, i) => n === y[i])
}

/** Difference between what was played and the target, for colouring the keyboard. */
export function compareToTarget(played: number[], target: number[]) {
  const t = new Set(target)
  const p = new Set(played)
  return {
    correct: [...p].filter((n) => t.has(n)).sort((a, b) => a - b),
    extra: [...p].filter((n) => !t.has(n)).sort((a, b) => a - b),
    missing: [...t].filter((n) => !p.has(n)).sort((a, b) => a - b),
    exact: sameSet(played, target),
  }
}

// Nearest first, so a tie goes to the octave closest to where the target is drawn.
const OCTAVE_SHIFTS = [0, -1, 1, -2, 2, -3, 3, -4, 4]
const PIANO_LOW = 21
const PIANO_HIGH = 108

/**
 * The target moved by whole octaves to where it was played, so a shape counts
 * anywhere on the keyboard and not only in the octave it is drawn in. The shape
 * itself never changes: every note of `body` moves together. `bass` is a lone
 * bass note under it, which may also sit in an octave of its own — a root played
 * further down — as long as it stays below the rest.
 *
 * Picks the placement with the most played notes in it; with nothing played, or
 * nothing in common anywhere, that is the target as written.
 */
export function placeTarget(played: number[], body: number[], bass?: number): number[] {
  const p = new Set(played)
  const hits = (notes: number[]) => notes.filter((n) => p.has(n)).length
  let best = bass === undefined ? [...body] : [bass, ...body]
  let bestHits = hits(best)
  for (const k of OCTAVE_SHIFTS) {
    const moved = body.map((n) => n + 12 * k)
    for (const kBass of bass === undefined ? [0] : OCTAVE_SHIFTS) {
      const candidate = bass === undefined ? moved : [bass + 12 * (k + kBass), ...moved]
      if (bass !== undefined && candidate[0] >= Math.min(...moved)) continue
      if (candidate.some((n) => n < PIANO_LOW || n > PIANO_HIGH)) continue
      const h = hits(candidate)
      if (h > bestHits) {
        best = candidate
        bestHits = h
      }
    }
  }
  return best.sort((a, b) => a - b)
}

/** The voicing for a root, placed where it was played: see `placeTarget`. */
export function placeVoicing(played: number[], voicing: Voicing, quality: Quality, rootMidi: number): number[] {
  const hands = voicingHands(voicing, quality)
  const midi = (tokens: string[]) => tokens.map((d) => rootMidi + degreeToSemitones(d, quality))
  // One note in the left hand is a bass root, free to go lower; a left hand
  // that plays part of the shape moves with it.
  return hands.lh.length === 1
    ? placeTarget(played, midi(hands.rh), midi(hands.lh)[0])
    : placeTarget(played, midi([...hands.lh, ...hands.rh]))
}

export type VoicingMatch = { voicing: Voicing; quality: Quality; rootMidi: number }

/**
 * Recognizes the set played as one of the voicings in the table, in any
 * root and any octave. Requires an exact note match.
 */
export function detectVoicing(midi: number[]): VoicingMatch | null {
  if (midi.length < 2) return null
  const played = [...midi].sort((a, b) => a - b)
  for (const voicing of VOICINGS) {
    for (const quality of voicing.qualities) {
      if (!QUALITIES.includes(quality)) continue
      // offsets from the root (can be negative, e.g. "5,")
      const offsets = voicingToMidi(voicing, quality, 0)
      if (offsets.length !== played.length) continue
      const rootMidi = played[0] - offsets[0]
      if (sameSet(played, offsets.map((o) => o + rootMidi))) {
        return { voicing, quality, rootMidi }
      }
    }
  }
  return null
}

/** Label of the target chord, e.g. "Cm7", "F7", "Bbmaj7". */
export function chordLabel(rootPc: number, quality: Quality, spelling: Spelling = 'flat'): string {
  return pitchClassName(rootPc, spelling) + (quality === '7' ? '7' : quality)
}

/** Note names for each hand, to show under the exercise. */
export function handNotes(voicing: Voicing, quality: Quality, rootMidi: number, spelling: Spelling = 'flat') {
  // Each note is named as the degree it is — the third of F♯m7 is A and its
  // fifth C♯ — which is how the chord card spells the same chord.
  const root = pitchClassName(rootMidi, spelling)
  const toNames = (tokens: string[]) =>
    tokens
      .map((d) => ({ midi: rootMidi + degreeToSemitones(d, quality), pc: noteAbove(root, degreeInterval(d, quality)) }))
      .sort((a, b) => a.midi - b.midi)
      .map((n) => `${n.pc}${Math.floor(n.midi / 12) - 1}`)
  const hands = voicingHands(voicing, quality)
  return { lh: toNames(hands.lh), rh: toNames(hands.rh) }
}

/** Enharmonically correct name for VexFlow, in the "eb/4" format. */
export function midiToVexKey(midi: number, spelling: Spelling = 'flat'): string {
  const name = midiToName(midi, spelling)
  const pc = Note.pitchClass(name)
  const oct = Note.octave(name) ?? 4
  return `${pc.toLowerCase()}/${oct}`
}
