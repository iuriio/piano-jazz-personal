import { Chord, ChordType, Note, Scale } from 'tonal'
import { PITCH_CLASSES_FLAT, PITCH_CLASSES_SHARP, dropMajorMarker } from './theory'

// Reads whatever is held on the keyboard as a chord, for the live chord card.
// Everything that ends up on screen is spelled for the chosen key signature.

// tonal knows the minor add-eleven (madd4) but not the major one, so C E F G
// came out as "Em♭6♭9/C". A triad with the fourth added is common enough at
// the keyboard to deserve its name.
if (ChordType.get('add11').empty) ChordType.add(['1P', '3M', '5P', '11P'], ['add11'], 'major add eleven')

export type KeySig = { id: string; label: string; tonicPc: number; accidentals: number }

// [id, tonic pc, accidentals, relative minor]
const KEY_DATA: [string, number, number, string][] = [
  ['C', 0, 0, 'A'],
  ['G', 7, 1, 'E'],
  ['D', 2, 2, 'B'],
  ['A', 9, 3, 'F#'],
  ['E', 4, 4, 'C#'],
  ['B', 11, 5, 'G#'],
  ['F#', 6, 6, 'D#'],
  ['C#', 1, 7, 'A#'],
  ['F', 5, -1, 'D'],
  ['Bb', 10, -2, 'G'],
  ['Eb', 3, -3, 'C'],
  ['Ab', 8, -4, 'F'],
  ['Db', 1, -5, 'Bb'],
  ['Gb', 6, -6, 'Eb'],
  ['Cb', 11, -7, 'Ab'],
]

/** ASCII accidentals to the glyphs shown on screen. Every lowercase "b" in a note or chord symbol is a flat. */
function glyph(s: string): string {
  return s.replace(/#/g, '♯').replace(/b/g, '♭')
}

export const KEY_SIGNATURES: KeySig[] = KEY_DATA.map(([id, tonicPc, accidentals, minor]) => ({
  id,
  label: `${glyph(id)} major / ${glyph(minor)} minor`,
  tonicPc,
  accidentals,
}))

export function keyById(id: string): KeySig {
  return KEY_SIGNATURES.find((k) => k.id === id) ?? KEY_SIGNATURES[0]
}

const pcOf = (midi: number) => ((midi % 12) + 12) % 12

const SPELLING_CACHE = new Map<string, string[]>()

/**
 * Name of each of the 12 pitch classes in a key. The scale's own letters win
 * (so Cb major really has a Cb and C# major a B#); the five chromatic notes
 * follow the direction of the signature, with C counting as a sharp key.
 */
function keySpelling(key: KeySig): string[] {
  const cached = SPELLING_CACHE.get(key.id)
  if (cached) return cached
  const names = [...(key.accidentals < 0 ? PITCH_CLASSES_FLAT : PITCH_CLASSES_SHARP)]
  for (const n of Scale.get(`${key.id} major`).notes) names[Note.chroma(n)!] = n
  SPELLING_CACHE.set(key.id, names)
  return names
}

/** Same but without octave: "F#". */
export function spellPc(midi: number, key: KeySig, names?: PcNames): string {
  return names?.get(pcOf(midi)) ?? keySpelling(key)[pcOf(midi)]
}

/** ASCII pitch-class names by pitch class, when something better than the key knows them. */
export type PcNames = Map<number, string>

/**
 * The octave belongs to the letter, not to the sound: Cb5 sounds as B4 and
 * B#3 as C4. Removing the alteration first lands on the letter's own octave.
 */
function octaveOf(midi: number, pc: string): number {
  return Math.floor((midi - Note.get(pc).alt) / 12) - 1
}

/** Note name spelled for the key signature, e.g. key D: 66 -> "F#4"; key Cb: 71 -> "Cb5". */
export function spellMidi(midi: number, key: KeySig, names?: PcNames): string {
  const pc = spellPc(midi, key, names)
  return `${pc}${octaveOf(midi, pc)}`
}

/** VexFlow key format "f#/4" for the staff, consistent with spellMidi. */
export function vexKey(midi: number, key: KeySig, names?: PcNames): string {
  const pc = spellPc(midi, key, names)
  return `${pc.toLowerCase()}/${octaveOf(midi, pc)}`
}

export type BassSplit = 'off' | 'slash' | 'apart'

export type ChordReading = {
  /**
   * What the card is looking at. Only a 'chord' replaces the one on the card:
   * a melody note, an interval or a cluster played on their own leave it up.
   */
  kind: 'note' | 'interval' | 'chord' | 'cluster'
  symbol: string
  name: string
  position: string
  voicing: string
  root: string
  intervals: string[]
  spelled: string[]
  count: number
  bass: string | null
  alternatives: string[]
  /** Degrees held on top of the named chord and left out of its symbol: a melody note over the voicing. */
  extras: string[]
}

// Ranking of tonal's chord types (by their first alias). A candidate in root
// position beats one in inversion only within the same tier: that is what
// makes E G C read "C/E" (tonal ranks "Em#5" first) while A C E G stays "Am7"
// and C E G A stays "C6".
const COMMON = [
  'M', 'm', '7', 'maj7', 'm7', 'm7b5', 'dim', 'dim7', 'aug', 'sus4', 'sus2', '7sus4',
  '6', 'm6', 'Madd9', 'madd9', '9', 'maj9', 'm9', '6add9', 'm69', 'm/ma7', '5',
]
const KNOWN = [
  '7no5', '11', 'm11', '13', 'maj13', 'm13', '7b9', '7#9', '7#11', '7b13', '7#5', 'maj7#5',
  '9sus4', '13sus4', 'b9sus', 'maj#4', '7b5', 'alt7', '9#11', '13#11', 'maj9#11', '7#9b13',
  '7b9b13', '13b9', '13#9', '7#5#9', '7#5b9', '9no5', '13no5', 'm7add11', 'm9b5', '69#11',
  '9b13', '9#5', 'mM9', 'Mb5', 'sus24', '7add6', 'add11', 'madd4',
]

function rankOf(alias: string): [number, number] {
  const c = COMMON.indexOf(alias)
  if (c >= 0) return [0, c]
  const k = KNOWN.indexOf(alias)
  if (k >= 0) return [1, k]
  return [2, 0]
}

// How a few of tonal's aliases are written on the card. The rest go through
// as they are, minus the major marker.
const DISPLAY_SUFFIX: Record<string, string> = {
  'm/ma7': 'mMaj7',
  'maj#4': 'maj7#11',
  madd4: 'm(add11)',
  '6add9': '6/9',
  Mb5: '(b5)', // "Cb5" would read as C-flat
  'M#5add9': 'aug(add9)',
  sus24: 'sus2sus4',
}

// Names tonal leaves empty or words awkwardly.
const NAMES: Record<string, string> = {
  '5': 'Open fifth',
  Madd9: 'Added ninth',
  add11: 'Added eleventh',
  madd4: 'Minor added eleventh',
  madd9: 'Minor added ninth',
  '6add9': 'Six-nine',
  m69: 'Minor six-nine',
  '7no5': 'Dominant seventh',
  '7sus4': 'Seventh suspended fourth',
  '9sus4': 'Ninth suspended fourth',
  '13sus4': 'Thirteenth suspended fourth',
  'm/ma7': 'Minor-major seventh',
  '7#5': 'Augmented dominant seventh',
  '7b5': 'Dominant seventh flat five',
  '7b13': 'Dominant seventh flat thirteenth',
  m7add11: 'Minor seventh added eleventh',
  sus24: 'Suspended second and fourth',
  Mb5: 'Major flat five',
}

const DYAD_NAMES = [
  'Unison', 'Minor second', 'Major second', 'Minor third', 'Major third', 'Perfect fourth',
  'Tritone', 'Perfect fifth', 'Minor sixth', 'Major sixth', 'Minor seventh', 'Major seventh',
]
const DYAD_INTERVALS = ['1P', '2m', '2M', '3m', '3M', '4P', '4A', '5P', '6m', '6M', '7m', '7M']

// Degree labels by semitone, for notes that are not tones of the chord read.
const SIMPLE_LABELS = ['R', '♭2', '2', '♭3', '3', '4', '♭5', '5', '♭6', '6', '♭7', '7']
const COMPOUND_LABELS = ['R', '♭9', '9', '♭3', '3', '11', '♯11', '5', '♭13', '13', '♭7', '7']

const PERFECT_TYPE = new Set([1, 4, 5])

/** tonal interval -> degree label: "3m" -> "♭3", "11A" -> "♯11", "7d" -> "♭♭7". */
function degreeLabel(ivl: string): string {
  const m = /^(\d+)([PMmAd]+)$/.exec(ivl)
  if (!m) return ivl
  const num = Number(m[1])
  if (num === 1 || num === 8) return 'R'
  const q = m[2]
  const perfect = PERFECT_TYPE.has(((num - 1) % 7) + 1)
  let acc = ''
  if (q === 'm') acc = '♭'
  else if (q[0] === 'A') acc = '♯'.repeat(q.length)
  else if (q[0] === 'd') acc = '♭'.repeat(perfect ? q.length : q.length + 1)
  return acc + num
}

const ORDINALS = ['', '1st', '2nd', '3rd', '4th', '5th', '6th']

/**
 * Which inversion a chord tone in the bass makes. Counted by stacked thirds:
 * a sus note stands in for the third and a 6 for the seventh, while a 9, 11
 * or 13 in the bass gives the 4th, 5th or 6th inversion, as with ninth chords.
 */
function inversionNumber(ivl: string, intervals: string[]): number {
  const num = Number(/^\d+/.exec(ivl)?.[0] ?? 1)
  const nums = intervals.map((i) => Number(/^\d+/.exec(i)?.[0]))
  const hasThird = nums.includes(3)
  const hasSeventh = nums.includes(7)
  switch (num) {
    case 3:
      return 1
    case 5:
      return 2
    case 7:
      return 3
    case 2:
      return hasThird ? 4 : 1
    case 4:
      return hasThird ? 5 : 1
    case 6:
      return hasSeventh ? 6 : 3
    case 9:
      return 4
    case 11:
      return 5
    case 13:
      return 6
    default:
      return 0
  }
}

/** A chord type placed on a spelled root, with every tone named. */
type Formatted = {
  rootPc: number
  rootName: string
  base: string // symbol without bass, ASCII: "Bbm7"
  name: string
  intervals: string[]
  tones: Map<number, { name: string; ivl: string }>
  /** 0 common, 1 known, 2 exotic: see rankOf. */
  tier: number
}

const isDouble = (n: string) => /^[A-G](##|bb)/.test(n)

/**
 * Places a chord type on the root spelling that best fits the key: the key's
 * own name for that pitch class, unless it forces double accidentals or more
 * notes off the signature than the enharmonic does (D# major in C is Eb major).
 */
function formatChord(rootPc: number, alias: string, key: KeySig): Formatted {
  const names = keySpelling(key)
  const options = [...new Set([names[rootPc], PITCH_CLASSES_SHARP[rootPc], PITCH_CLASSES_FLAT[rootPc]])]
  let best: { root: string; score: number } | null = null
  for (const root of options) {
    const score = Chord.getChord(alias, root).notes.reduce(
      (s, n) => s + (isDouble(n) ? 100 : 0) + (names[Note.chroma(n)!] === n ? 0 : 1),
      0,
    )
    if (!best || score < best.score) best = { root, score }
  }
  const rootName = best!.root
  const chord = Chord.getChord(alias, rootName)
  const tones = new Map<number, { name: string; ivl: string }>()
  chord.notes.forEach((n, i) => {
    const pc = Note.chroma(n)!
    if (!tones.has(pc)) tones.set(pc, { name: n, ivl: chord.intervals[i] })
  })
  const typeName = chord.type ? chord.type[0].toUpperCase() + chord.type.slice(1) : ''
  const suffix = DISPLAY_SUFFIX[alias] ?? alias
  return {
    rootPc,
    rootName,
    base: dropMajorMarker(rootName + suffix),
    name: NAMES[alias] ?? (typeName || `${glyph(suffix)} chord`),
    intervals: chord.intervals,
    tones,
    tier: rankOf(alias)[0],
  }
}

// A note outside the chord, read as the tension it makes over the root: over
// C, pitch class 1 is the ♭9 and is spelled D♭, whatever the key would call it.
const TENSIONS = ['1P', '9m', '9M', '9A', '3M', '11P', '11A', '5P', '13m', '13M', '7m', '7M']

function tension(f: Formatted, pc: number): { label: string; name: string } | null {
  let ivl = TENSIONS[pcOf(pc - f.rootPc)]
  // Next to a minor third, pitch class 3 is that third again, not a ♯9.
  if (ivl === '9A' && !f.intervals.includes('3M')) ivl = '3m'
  const name = Note.pitchClass(Note.transpose(f.rootName, ivl))
  if (!name || isDouble(name)) return null
  return { label: degreeLabel(ivl), name }
}

/** Display name of a pitch class: as a chord tone, else as a tension over the root, else as the key spells it. */
function toneName(f: Formatted | null, pc: number, key: KeySig): string {
  const name = f?.tones.get(pc)?.name ?? (f && tension(f, pc)?.name)
  return glyph(name ?? keySpelling(key)[pc])
}

function symbolFor(f: Formatted, bassPc: number, key: KeySig): string {
  const base = glyph(f.base)
  return bassPc === f.rootPc ? base : `${base}/${toneName(f, bassPc, key)}`
}

function positionFor(f: Formatted, bassPc: number, key: KeySig): string {
  if (bassPc === f.rootPc) return 'Root position'
  const tone = f.tones.get(bassPc)
  const slash = `(/${toneName(f, bassPc, key)})`
  if (!tone) return `Slash bass ${slash}`
  const n = inversionNumber(tone.ivl, f.intervals)
  return n ? `${ORDINALS[n]} Inversion ${slash}` : `Slash bass ${slash}`
}

/** Degree of each held pitch class above the root, low to high, once each. */
function intervalsFor(f: Formatted, midi: number[], extras: Set<number>): string[] {
  const compound = f.intervals.some((i) => Number(/^\d+/.exec(i)?.[0]) >= 9)
  const labels = midi.map((n) => {
    const pc = pcOf(n)
    const tone = f.tones.get(pc)
    if (tone) return degreeLabel(tone.ivl)
    if (extras.has(pc)) return tension(f, pc)?.label ?? COMPOUND_LABELS[pcOf(pc - f.rootPc)]
    return (compound ? COMPOUND_LABELS : SIMPLE_LABELS)[pcOf(n - f.rootPc)]
  })
  return [...new Set(labels)]
}

/**
 * "Close" when everything fits in an octave above the bass. Four different
 * notes that close up once the lowest goes back up an octave are a Drop 2
 * (it came from second from the top) or a Drop 3 (third from the top).
 */
function voicingOf(midi: number[]): string {
  if (midi.length < 2) return '—'
  if (midi[midi.length - 1] - midi[0] <= 12) return 'Close'
  if (midi.length === 4 && new Set(midi.map(pcOf)).size === 4) {
    const [a, b, c, d] = midi
    const closed = (xs: number[]) => xs.every((x, i) => i === 0 || x > xs[i - 1]) && xs[3] - xs[0] < 12
    if (closed([b, c, a + 12, d])) return 'Drop 2'
    if (closed([b, a + 12, c, d])) return 'Drop 3'
  }
  return 'Open'
}

/** Distinct pitch classes in the order they are first played, low to high. */
function playedPcs(midi: number[]): number[] {
  return [...new Set(midi.map(pcOf))]
}

/** Every reading tonal offers for 3+ pitch classes, best first, already spelled. */
function candidates(midi: number[], key: KeySig): Formatted[] {
  const names = keySpelling(key)
  const pcs = playedPcs(midi)
  const found = Chord.detect(
    pcs.map((pc) => names[pc]),
    { assumePerfectFifth: true },
  )
  const bassPc = pcs[0]
  const parsed = found.flatMap((sym, order) => {
    const m = /^([A-G][#b]*)(.*?)(?:\/[A-G][#b]*)?$/.exec(sym)
    if (!m) return []
    const rootPc = Note.chroma(m[1])!
    const [tier, index] = rankOf(m[2])
    return [{ rootPc, alias: m[2], tier, inv: rootPc === bassPc ? 0 : 1, index, order }]
  })
  parsed.sort((x, y) => x.tier - y.tier || x.inv - y.inv || x.index - y.index || x.order - y.order)
  return parsed.map((c) => formatChord(c.rootPc, c.alias, key))
}

/**
 * The chord to name for these notes. When the whole set only reads as something
 * exotic (or not at all), it is usually a voicing with a melody note on it:
 * Cmaj7 with a D♭ on top is "Cmaj7" plus a ♭9, not "Cmaj7♭9", and a passing
 * note in the middle should not rename the chord either. So the pitch classes
 * that spoil it are set aside — the highest first, never the bass — and become
 * the extras the card lists as tensions.
 */
function chordUnder(midi: number[], key: KeySig): { ranked: Formatted[]; extras: Set<number> } | null {
  // Good enough to name the notes as they are: a common chord, or a known one
  // standing on its root. A rarer chord over some other bass (E♭13♭9/C for a
  // Cmaj7 with two notes on top) loses to the plain voicing underneath.
  const bassPc = pcOf(midi[0])
  const plain = (r: Formatted[]) => r.length > 0 && (r[0].tier === 0 || (r[0].tier === 1 && r[0].rootPc === bassPc))
  const full = candidates(midi, key)
  if (plain(full)) return { ranked: full, extras: new Set() }

  const pcs = playedPcs(midi)
  const top = (pc: number) => Math.max(...midi.filter((n) => pcOf(n) === pc))
  // Droppable: everything but the bass, highest note first.
  const droppable = pcs.slice(1).sort((a, b) => top(b) - top(a))
  for (let k = 1; k <= 2 && pcs.length - k >= 3; k++) {
    let found: { ranked: Formatted[]; extras: Set<number> } | null = null
    for (const drop of combinations(droppable, k)) {
      const set = new Set(drop)
      const ranked = candidates(midi.filter((n) => !set.has(pcOf(n))), key)
      if (!plain(ranked)) continue
      if (!found || ranked[0].tier < found.ranked[0].tier) found = { ranked, extras: set }
    }
    if (found) return found
  }
  return full.length ? { ranked: full, extras: new Set() } : null
}

/** Every k-element subset of xs, in the order of xs: [a,b,c], 2 → ab ac bc. */
function combinations<T>(xs: T[], k: number): T[][] {
  if (k === 0) return [[]]
  return xs.flatMap((x, i) => combinations(xs.slice(i + 1), k - 1).map((rest) => [x, ...rest]))
}

/** Reads a chord tone set; `bassMidi` is the note the symbol is written over. */
function fromCandidates(
  ranked: Formatted[],
  midi: number[],
  bassMidi: number,
  voiced: number[],
  key: KeySig,
  extras: Set<number> = new Set(),
): { reading: ChordReading; best: Formatted } {
  const best = ranked[0]
  const bassPc = pcOf(bassMidi)
  const symbol = symbolFor(best, bassPc, key)
  const alternatives = [...new Set(ranked.slice(1).map((f) => symbolFor(f, bassPc, key)))]
    .filter((s) => s !== symbol)
    .slice(0, 3)
  return {
    best,
    reading: {
      kind: 'chord',
      symbol,
      name: best.name,
      position: positionFor(best, bassPc, key),
      voicing: voicingOf(voiced),
      root: glyph(best.rootName),
      intervals: intervalsFor(best, midi, extras),
      spelled: midi.map((n) => toneName(best, pcOf(n), key)),
      count: midi.length,
      bass: null,
      alternatives,
      extras: [...new Set(midi.filter((n) => extras.has(pcOf(n))).map((n) => tension(best, pcOf(n))?.label ?? '?'))],
    },
  }
}

/** Reading of a sorted, deduplicated set of notes with no bass split. */
function readNotes(midi: number[], key: KeySig): { reading: ChordReading; best: Formatted | null } {
  const pcs = playedPcs(midi)
  const names = keySpelling(key)

  if (pcs.length === 1) {
    const name = glyph(names[pcs[0]])
    return {
      best: null,
      reading: {
        kind: 'note',
        symbol: name,
        name: 'Single note',
        position: '—',
        voicing: '—',
        root: name,
        intervals: ['R'],
        spelled: midi.map(() => name),
        count: midi.length,
        bass: null,
        alternatives: [],
        extras: [],
      },
    }
  }

  if (pcs.length === 2) {
    const [low, high] = pcs
    const semis = pcOf(high - low)
    // A fifth, or the fourth that is its inversion, is a power chord.
    if (semis === 7 || semis === 5) {
      const power = formatChord(semis === 7 ? low : high, '5', key)
      return fromCandidates([power], midi, midi[0], midi, key)
    }
    const root = names[low]
    // The upper note is named as the interval it makes (C + minor third = Eb),
    // unless that needs a double accidental.
    let upper = Note.pitchClass(Note.transpose(root, DYAD_INTERVALS[semis]))
    if (semis === 6 || isDouble(upper) || Note.chroma(upper) !== high) upper = names[high]
    const spell = (n: number) => glyph(pcOf(n) === low ? root : upper)
    return {
      best: null,
      reading: {
        kind: 'interval',
        symbol: glyph(root),
        name: DYAD_NAMES[semis],
        position: '—',
        voicing: voicingOf(midi),
        root: glyph(root),
        intervals: ['R', SIMPLE_LABELS[semis]],
        spelled: midi.map(spell),
        count: midi.length,
        bass: null,
        alternatives: [],
        extras: [],
      },
    }
  }

  const found = chordUnder(midi, key)
  if (found) return fromCandidates(found.ranked, midi, midi[0], midi, key, found.extras)

  // Nothing tonal knows (a cluster): still show what is held, from the bass.
  const root = glyph(names[pcs[0]])
  return {
    best: null,
    reading: {
      kind: 'cluster',
      symbol: '?',
      name: 'Unrecognized',
      position: '—',
      voicing: voicingOf(midi),
      root,
      intervals: pcs.map((pc) => SIMPLE_LABELS[pcOf(pc - pcs[0])]),
      spelled: midi.map((n) => glyph(names[pcOf(n)])),
      count: midi.length,
      bass: null,
      alternatives: [],
      extras: [],
    },
  }
}

/**
 * Reads the held notes as a chord. `split` decides what the notes at or below
 * `splitPoint` mean: nothing special ('off'), a bass the chord above is written
 * over ('slash'), or a separate bass line left out of the chord ('apart').
 */
export function readChord(
  notes: number[],
  opts: { key: KeySig; split: BassSplit; splitPoint: number },
): ChordReading | null {
  const midi = [...new Set(notes)].sort((a, b) => a - b)
  if (midi.length === 0) return null
  const { key, split, splitPoint } = opts
  const lowCount = midi.filter((n) => n <= splitPoint).length

  if (split === 'apart' && lowCount > 0 && lowCount < midi.length) {
    const { reading, best } = readNotes(midi.slice(lowCount), key)
    return { ...reading, count: midi.length, bass: toneName(best, pcOf(midi[0]), key) }
  }

  if (split === 'slash' && lowCount > 0) {
    // The lowest note overall is the lowest one under the split.
    const rest = midi.slice(1)
    // With fewer than three pitch classes above it there is no chord to write
    // over the bass; reading everything together says more (C + E G is C).
    if (playedPcs(rest).length >= 3) {
      const found = chordUnder(rest, key)
      if (found) return fromCandidates(found.ranked, midi, midi[0], rest, key, found.extras).reading
    }
  }

  return readNotes(midi, key).reading
}

/**
 * How the chord in these notes spells each of them, for the staff and the
 * labels: in C, a Cm7 is C E♭ G B♭, though a lone chromatic note there goes
 * sharp. Notes the reading does not spell are left to the key.
 */
export function chordNames(
  notes: number[],
  opts: { key: KeySig; split: BassSplit; splitPoint: number },
): PcNames {
  const names: PcNames = new Map()
  const reading = readChord(notes, opts)
  if (!reading || reading.kind === 'note' || reading.kind === 'cluster') return names
  const midi = [...new Set(notes)].sort((a, b) => a - b)
  // With the bass apart, the reading spells only the notes above it.
  const spelledMidi = midi.slice(midi.length - reading.spelled.length)
  spelledMidi.forEach((n, i) => {
    names.set(pcOf(n), reading.spelled[i].replace(/♯/g, '#').replace(/♭/g, 'b'))
  })
  return names
}
