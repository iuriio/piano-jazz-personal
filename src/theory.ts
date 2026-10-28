import { Chord, Interval, Midi, Note } from 'tonal'
import {
  QUALITIES,
  VOICINGS,
  type Quality,
  type Voicing,
  degreeToSemitones,
  voicingToMidi,
} from './voicings'

export const PITCH_CLASSES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
export const PITCH_CLASSES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export type Spelling = 'flat' | 'sharp'

export function midiToName(midi: number, spelling: Spelling = 'flat'): string {
  return Midi.midiToNoteName(midi, { sharps: spelling === 'sharp' })
}

export function pitchClassName(pc: number, spelling: Spelling = 'flat'): string {
  return (spelling === 'sharp' ? PITCH_CLASSES_SHARP : PITCH_CLASSES_FLAT)[((pc % 12) + 12) % 12]
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
  const toNames = (tokens: string[]) =>
    tokens
      .map((d) => rootMidi + degreeToSemitones(d, quality))
      .sort((a, b) => a - b)
      .map((n) => midiToName(n, spelling))
  return { lh: toNames(voicing.lh), rh: toNames(voicing.rh) }
}

/** Enharmonically correct name for VexFlow, in the "eb/4" format. */
export function midiToVexKey(midi: number, spelling: Spelling = 'flat'): string {
  const name = midiToName(midi, spelling)
  const pc = Note.pitchClass(name)
  const oct = Note.octave(name) ?? 4
  return `${pc.toLowerCase()}/${oct}`
}
