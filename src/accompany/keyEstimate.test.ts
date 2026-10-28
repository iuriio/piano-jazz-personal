import { describe, expect, it } from 'vitest'
import {
  NEW_TRACK,
  centerName,
  estimateKey,
  isConfident,
  keyLabel,
  trackKey,
  type KeyTrack,
} from './keyEstimate'
import {
  chordStream,
  dorianVamp,
  endOf,
  hanon1,
  markLowest,
  minorLick,
  scaleRun,
  sections,
  type Section,
} from './fixtures'
import type { PlayedNote } from './played'

const at = (notes: PlayedNote[]) => estimateKey(notes, endOf(notes))!

describe('estimateKey', () => {
  it('reads a B♭ major scale as B♭ major, confidently', () => {
    const k = at(scaleRun(58, 'major', { bpm: 92, repeats: 2, jitterMs: 12 }))
    expect(keyLabel(k)).toBe('B♭ major')
    expect(k.collection).toBe('Bb')
    expect(isConfident(k)).toBe(true)
  })

  it('reads Hanon no. 1 in C as C, not A minor', () => {
    const k = at(hanon1(48, { bpm: 100, jitterMs: 10 }))
    expect(keyLabel(k)).toBe('C major')
    expect(isConfident(k)).toBe(true)
  })

  it('reads a G minor lick as G minor, even with the leading tone in it', () => {
    const k = at(minorLick(55, { bpm: 100 }))
    expect(keyLabel(k)).toBe('G minor')
    expect(k.collection).toBe('Bb')
  })

  it('reads a D dorian vamp as collection C, center D, dorian', () => {
    const k = at(dorianVamp(62, { bpm: 100 }))
    expect(k.collection).toBe('C')
    expect(centerName(k)).toBe('D')
    expect(k.mode).toBe('dorian')
  })

  it('a C scale over a held A in the bass reads A minor', () => {
    const scale = scaleRun(60, 'major', { bpm: 100, perBeat: 2 })
    const drone: PlayedNote = { midi: 45, velocity: 70, on: 0, off: endOf(scale), lowest: true }
    const k = at(markLowest([drone, ...scale]))
    expect(keyLabel(k)).toBe('A minor')
  })

  it('a ii–V–I in chords reads as the I', () => {
    expect(keyLabel(at(chordStream(['Dm7', 'G7', 'Cmaj7', 'Cmaj7'], { bpm: 90 })))).toBe('C major')
  })

  it('a few chromatic passing notes do not knock it over', () => {
    const notes = scaleRun(58, 'major', { bpm: 92, repeats: 2 })
    // Every eighth note bent a semitone: B natural, E natural, F♯ — passing, short.
    const bent = notes.map((n, i) => (i % 8 === 4 ? { ...n, midi: n.midi + 1, off: n.on + 60 } : n))
    const k = at(bent)
    expect(keyLabel(k)).toBe('B♭ major')
    expect(isConfident(k)).toBe(true)
  })

  it('returns null with nothing played', () => {
    expect(estimateKey([], 1000)).toBeNull()
  })

  it('lists the other readings of the same notes for the offer to cycle', () => {
    const k = at(scaleRun(58, 'major', { bpm: 92, repeats: 2 }))
    const names = k.alts.map((a) => keyLabel({ ...a, collectionPc: k.collectionPc }))
    expect(names).toContain('G minor')
    expect(names).toContain('C dorian')
  })
})

describe('trackKey (modulation)', () => {
  const BPM = 120
  const BEAT = 60000 / BPM
  const BAR = 4 * BEAT

  /**
   * Plays the sections and ticks the tracker every 250 ms as the accompanist
   * does: seeded with the band's key (the first section's), a hold of two bars,
   * the last 30 s of notes with the ones still sounding open.
   */
  function play(list: Section[], seedMode: 'major' | 'minor' = 'major') {
    const { notes, starts } = sections(list, { bpm: BPM, jitterMs: 12 })
    const end = endOf(notes)
    let track: KeyTrack = NEW_TRACK
    const seen: { t: number; label: string }[] = []
    for (let t = 250; t <= end; t += 250) {
      const heard = notes.filter((n) => n.on <= t && n.on > t - 30000).map((n) => (n.off > t ? { ...n, off: Number.NaN } : n))
      const est = estimateKey(heard, t)
      if (est && !track.current) {
        const tonic = list[0].tonic % 12
        const collectionPc = seedMode === 'minor' ? (tonic + 3) % 12 : tonic
        track = { current: { ...est, collectionPc, center: tonic, mode: seedMode }, challenger: null, since: t }
      }
      track = trackKey(track, est, t, 2 * BAR)
      seen.push({ t, label: track.current ? keyLabel(track.current) : '' })
    }
    // The distinct keys it went through, in order.
    const path = seen.map((s) => s.label).filter((l, i, a) => l && l !== a[i - 1])
    const firstAt = (label: string, after: number) => seen.find((s) => s.t > after && s.label === label)?.t
    return { starts, seen, path, firstAt }
  }

  const C: Section = { tonic: 60, mode: 'major', bars: 8, kind: 'tune' }

  it('C → G, up and down the scale: G within two bars, straight there', () => {
    const r = play([{ ...C, kind: 'scale' }, { tonic: 67, mode: 'major', bars: 6, kind: 'scale' }])
    expect(r.path).toEqual(['C major', 'G major'])
    expect(r.firstAt('G major', r.starts[1])! - r.starts[1]).toBeLessThanOrEqual(2 * BAR)
  })

  it('C → G and C → E♭ over left-hand chords: the new key within two bars', () => {
    for (const [tonic, label] of [
      [67, 'G major'],
      [63, 'E♭ major'],
    ] as const) {
      const r = play([{ ...C, kind: 'comped' }, { tonic, mode: 'major', bars: 6, kind: 'comped' }])
      expect(r.path).toEqual(['C major', label])
      expect(r.firstAt(label, r.starts[1])! - r.starts[1]).toBeLessThanOrEqual(2 * BAR)
    }
  })

  it('C → E♭ in a tune: waits for the A♭ rather than stopping in B♭ on the way', () => {
    const r = play([C, { tonic: 63, mode: 'major', bars: 8, kind: 'tune' }])
    expect(r.path).toEqual(['C major', 'E♭ major'])
    expect(r.firstAt('E♭ major', r.starts[1])! - r.starts[1]).toBeLessThanOrEqual(3 * BAR)
  })

  it('C → G in a tune with a single F♯: once F has stayed away for two bars', () => {
    const r = play([C, { tonic: 67, mode: 'major', bars: 8, kind: 'tune' }])
    expect(r.path).toEqual(['C major', 'G major'])
    expect(r.firstAt('G major', r.starts[1])! - r.starts[1]).toBeLessThanOrEqual(4 * BAR)
  })

  it('holds C through the first half bar of G', () => {
    const r = play([{ ...C, kind: 'scale' }, { tonic: 67, mode: 'major', bars: 4, kind: 'scale' }])
    for (const s of r.seen.filter((s) => s.t > r.starts[1] && s.t <= r.starts[1] + BAR / 2)) expect(s.label).toBe('C major')
  })

  it('goes back: C → G → C', () => {
    const r = play([
      { ...C, kind: 'comped', bars: 6 },
      { tonic: 67, mode: 'major', bars: 6, kind: 'comped' },
      { tonic: 60, mode: 'major', bars: 6, kind: 'comped' },
    ])
    expect(r.path).toEqual(['C major', 'G major', 'C major'])
  })

  const inC = (...middle: Section[]): Section[] => [{ ...C, bars: 4 }, ...middle, { ...C, bars: 4 }]
  const bar = (pitches: number[]): Section => ({ tonic: 60, mode: 'major', bars: pitches.length / 8, kind: 'eighths', pitches })

  it('a secondary dominant is not a modulation: D7 → G7 → C stays in C', () => {
    expect(play(inC(bar([50, 54, 57, 60, 62, 60, 57, 54]), bar([55, 59, 62, 65, 67, 65, 62, 59]))).path).toEqual(['C major'])
    // Two beats of D7, two of G7.
    expect(play(inC(bar([62, 66, 69, 72, 67, 71, 74, 77]))).path).toEqual(['C major'])
  })

  it('a borrowed iv, a blues lick, chromatic passing notes: still C', () => {
    expect(play(inC(bar([53, 56, 60, 65, 68, 65, 60, 56]))).path).toEqual(['C major'])
    expect(play(inC(bar([60, 63, 65, 66, 67, 70, 67, 66, 65, 63, 60, 58, 60, 63, 65, 67]))).path).toEqual(['C major'])
    // Chromatic lines through the scale: E F F♯ G, A B♭ B C, G G♯ A.
    expect(play(inC(bar([64, 65, 66, 67, 69, 70, 71, 72]), bar([67, 68, 69, 67, 64, 63, 62, 60]))).path).toEqual(['C major'])
  })

  it('two bars on D7 can read as G for a moment, and come back with the first F', () => {
    const r = play(
      inC(
        { tonic: 62, mode: 'mixolydian', bars: 2, kind: 'comped', degrees: [0] },
        { tonic: 67, mode: 'mixolydian', bars: 1, kind: 'comped', degrees: [0] },
      ),
    )
    expect(r.path[r.path.length - 1]).toBe('C major')
    const back = [...r.seen].reverse().find((s) => s.label !== 'C major')
    if (back) expect(back.t - r.starts[2]).toBeLessThanOrEqual(BAR)
  })

  it('the leading tone of a minor key does not move it', () => {
    const r = play([{ tonic: 55, mode: 'minor', bars: 8, kind: 'tune' }, { tonic: 55, mode: 'harmonicMinor', bars: 8, kind: 'tune' }], 'minor')
    expect(r.path).toEqual(['G minor'])
  })

  it('does not take a key it is not sure of', () => {
    const vague = estimateKey([{ midi: 60, velocity: 60, on: 0, off: 200, lowest: true }], 300)
    expect(trackKey(NEW_TRACK, vague, 300, 4000).current).toBeNull()
  })
})
