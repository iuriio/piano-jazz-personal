import { describe, expect, it } from 'vitest'
import { planPhrase, renderPhrase, type Complexity, type PlanChord } from './progression'
import {
  BASS_CEIL,
  BASS_FLOOR,
  GUIDE_FLOOR,
  PIANO_FLOOR,
  avoidClashes,
  bassNote,
  clearOfMud,
  closedVoicings,
  gapBetween,
  movement,
  registerFor,
  voice,
  voiceTones,
} from './voicing'
import { pcOf } from './played'
import { Chord, Note } from 'tonal'

function chord(symbol: string): PlanChord {
  const c = Chord.get(symbol)
  return {
    symbol,
    root: Note.chroma(c.tonic!)!,
    tones: c.notes.map((n) => Note.chroma(n)!),
    fn: 'T',
    beats: 4,
    token: 'I',
    hold: false,
  }
}

describe('voice', () => {
  const win = { low: 50, high: 70 }

  for (const [c, syms] of [
    [2, ['Cm7', 'F7', 'Bbmaj7']],
    [3, ['Cm9', 'F13', 'Bbmaj9']],
  ] as [Complexity, string[]][]) {
    it(`leads a ii–V–I at complexity ${c} in 6 semitones or less`, () => {
      let prev: number[] | null = null
      let moved = 0
      for (const s of syms) {
        const v = voice(voiceTones(chord(s), c, false), prev, win)
        if (prev) moved += movement(prev, v)
        prev = v
      }
      expect(moved).toBeLessThanOrEqual(6)
    })
  }

  it('stays inside the window', () => {
    const p = planPhrase({ collectionPc: 10, center: 10, mode: 'major' }, 0, { seed: 3, density: 1, beatsPerBar: 4 })
    let prev: number[] | null = null
    for (const bar of renderPhrase(p, 3, 3)) {
      for (const ch of bar) {
        const v = voice(voiceTones(ch, 3, false), prev, win)
        for (const m of v) {
          expect(m).toBeGreaterThanOrEqual(win.low)
          expect(m).toBeLessThanOrEqual(win.high)
        }
        prev = v
      }
    }
  })

  it('goes rootless once rich: Cm9 is E♭ G B♭ D, no C', () => {
    expect(voiceTones(chord('Cm9'), 3, false).sort()).toEqual([2, 3, 7, 10].sort())
    // F13: 3, ♭7, 9, 13 — the fifth is the first note to go.
    expect(voiceTones(chord('F13'), 3, false).sort()).toEqual([9, 3, 7, 2].sort())
  })

  it('a shell is the third and the seventh', () => {
    expect(voiceTones(chord('F7'), 2, true)).toEqual([9, 3])
  })

  it('closed voicings are close: under an octave from bottom to top', () => {
    for (const v of closedVoicings([0, 4, 7, 11], win)) expect(v[v.length - 1] - v[0]).toBeLessThan(12)
  })
})

describe('avoidClashes', () => {
  it('drops a note a semitone from a held note that is not in the chord', () => {
    // You hold E♭5 (75) over B♭maj7: the D right under it has to go.
    const v = avoidClashes([65, 69, 70, 74], [75], [10, 2, 5, 9])
    expect(v).toEqual([65, 69, 70])
  })

  it('also an octave and a semitone away', () => {
    expect(avoidClashes([62, 65], [75], [10, 2, 5, 9])).toEqual([65])
  })

  it('leaves the voicing alone when your note is a chord tone', () => {
    expect(avoidClashes([62, 65, 69], [70], [10, 2, 5, 9])).toEqual([62, 65, 69])
  })

  it('no voicing note ends up a minor second from what you hold', () => {
    const held = [73, 76]
    const v = avoidClashes(voice([10, 2, 5, 9], null, { low: 60, high: 72 }), held, [10, 2, 5, 9])
    for (const m of v) for (const h of held) expect([1, 13]).not.toContain(Math.abs(m - h))
  })
})

describe('registerFor', () => {
  it('keeps the piano 3 semitones under your low notes and the bass 5 under', () => {
    // Your 10th percentile is G4 (67).
    const yours = [65, 67, 67, 69, 70, 72, 74, 76, 77, 79, 81, 82, 84, 86, 77, 74, 72, 70, 69, 67]
    const r = registerFor(yours)
    expect(r.shellOnly).toBe(false)
    expect(r.piano.high).toBeLessThanOrEqual(67 - 3)
    expect(r.bass.high).toBeLessThanOrEqual(67 - 5)
    expect(r.piano.high - r.piano.low).toBeGreaterThanOrEqual(12)
    expect(r.bass.high).toBeLessThanOrEqual(BASS_CEIL)
    expect(r.bass.low).toBe(BASS_FLOOR)
  })

  it('falls back to a shell when you fill the keyboard', () => {
    const r = registerFor([36, 40, 48, 55, 60, 67, 72, 79, 84])
    expect(r.shellOnly).toBe(true)
    expect(r.bass.high).toBeLessThan(BASS_CEIL)
  })

  it('never puts the piano under C3, nor the bass in the piano’s register', () => {
    for (let p10 = 30; p10 <= 90; p10++) {
      const r = registerFor([p10, p10 + 4, p10 + 7, p10 + 12, p10 + 16, p10 + 19, p10 + 24, p10 + 28, p10 + 31, p10 + 36])
      expect(r.piano.low).toBeGreaterThanOrEqual(PIANO_FLOOR)
      expect(r.bass.high).toBeLessThan(r.piano.low)
      expect(r.bass.high).toBeLessThanOrEqual(BASS_CEIL)
    }
  })

  it('thins out instead of diving when your left hand comps around C3–C4', () => {
    // Left-hand chords from C3 to C4, a melody from G4 up: no octave of room under you.
    const lh = [48, 52, 55, 60, 50, 53, 57, 60, 47, 50, 53, 57]
    const rh = [67, 69, 71, 72, 74, 76, 72, 71, 69, 67, 72, 74]
    const r = registerFor([...lh, ...rh])
    expect(r.shellOnly).toBe(true)
    expect(r.piano.low).toBeGreaterThanOrEqual(GUIDE_FLOOR)
    expect(r.piano.high - r.piano.low).toBeGreaterThanOrEqual(11)
  })

  it('moves up into the gap between your hands when there is one', () => {
    // Bass notes C2–G2 in the left hand, a melody from E5 up in the right.
    const r = registerFor([36, 43, 38, 41, 36, 43, 76, 79, 81, 84, 83, 79, 77, 76, 81, 84])
    expect(r.shellOnly).toBe(false)
    expect(r.piano.low).toBeGreaterThanOrEqual(43 + 3)
    expect(r.piano.high).toBeLessThanOrEqual(76 - 3)
  })

  it('plays the bass lighter, not higher, once you play your own bass notes', () => {
    const melody = registerFor([60, 62, 64, 65, 67, 69, 71, 72])
    expect(melody.bassLevel).toBe(1)
    const yourBass = registerFor([36, 38, 40, 43, 36, 41, 72, 74, 76, 77])
    expect(yourBass.bassLevel).toBeLessThan(0.7)
    expect(yourBass.bassLevel).toBeGreaterThanOrEqual(0.5)
    expect(yourBass.bass.high).toBeLessThanOrEqual(melody.bass.high)
  })
})

describe('low interval limits', () => {
  it('rejects close intervals low down and keeps them higher up', () => {
    expect(clearOfMud([48, 50])).toBe(false) // a second on C3
    expect(clearOfMud([52, 53])).toBe(true) // a minor second on E3
    expect(clearOfMud([45, 48])).toBe(false) // a minor third on A2
    expect(clearOfMud([48, 51, 55, 58])).toBe(true) // Cm7 from C3
    expect(clearOfMud([34, 41])).toBe(true) // a fifth on B♭1
  })

  it('a voiced phrase stays clear of the bass: nothing under C3, no 3rd or 7th under D3', () => {
    const p = planPhrase({ collectionPc: 2, center: 2, mode: 'major' }, 0, { seed: 5, density: 1, beatsPerBar: 4 })
    for (const yours of [[], [60, 64, 67, 72], [55, 59, 62, 67, 71, 74], [48, 52, 55, 60, 67, 72, 76], [36, 43, 76, 79, 84]]) {
      const reg = registerFor(yours)
      for (const c of [1, 2, 3] as Complexity[]) {
        let prev: number[] | null = null
        for (const bar of renderPhrase(p, c, 5)) {
          for (const ch of bar) {
            const pcs = voiceTones(ch, c, reg.shellOnly)
            const v = voice(pcs, prev, reg.piano)
            expect(v.length).toBeGreaterThan(0)
            expect(Math.min(...v)).toBeGreaterThanOrEqual(PIANO_FLOOR)
            expect(clearOfMud(v)).toBe(true)
            for (const m of v) if (pcs.guides!.includes(pcOf(m))) expect(m).toBeGreaterThanOrEqual(GUIDE_FLOOR)
            prev = v
          }
        }
      }
    }
  })

  it('names the third and the seventh as guide tones, and still reads as a plain list', () => {
    const t = voiceTones(chord('Cm7'), 2, false)
    expect(t).toEqual([0, 3, 7, 10])
    expect(t.guides).toEqual([3, 10])
    expect(voiceTones(chord('F7'), 2, true).guides).toEqual([9, 3])
  })
})

describe('gapBetween', () => {
  it('finds the room between your hands, clear of both', () => {
    expect(gapBetween([36, 43, 76, 79])).toEqual({ low: 48, high: 72 })
    expect(gapBetween([48, 55, 70])).toEqual({ low: 58, high: 67 })
    expect(gapBetween([60, 61])).toBeNull()
  })
})

describe('bassNote', () => {
  it('finds the root in the window, near the last note', () => {
    expect(pcOf(bassNote(5, { low: 28, high: 48 }, 46))).toBe(5)
    expect(bassNote(5, { low: 28, high: 48 }, 46)).toBe(41)
    expect(bassNote(5, { low: 28, high: 48 }, 30)).toBe(29)
  })
})

describe('voice on a repeated chord', () => {
  const win = { low: 50, high: 70 }

  it('re-voices the same chord instead of striking the identical block', () => {
    const pcs = voiceTones(chord('Dm7'), 2, false)
    let prev = voice(pcs, null, win)
    const seen = new Set<string>([prev.join()])
    for (let i = 0; i < 8; i++) {
      const v = voice(pcs, prev, win)
      expect(v.join()).not.toBe(prev.join())
      // A step to a neighbouring shape, not a leap.
      expect(movement(prev, v)).toBeLessThanOrEqual(12)
      for (const m of v) {
        expect(m).toBeGreaterThanOrEqual(win.low)
        expect(m).toBeLessThanOrEqual(win.high)
      }
      seen.add(v.join())
      prev = v
    }
    // Rocks between a few shapes, does not creep through all of them.
    expect(seen.size).toBeGreaterThanOrEqual(2)
    expect(seen.size).toBeLessThanOrEqual(3)
  })

  it('keeps the plain nearest-voicing rule when asked', () => {
    const pcs = voiceTones(chord('Dm7'), 2, false)
    const v = voice(pcs, null, win)
    expect(voice(pcs, v, win, false)).toEqual(v)
  })
})
