import { describe, expect, it } from 'vitest'
import { MAX_ROLL_MS, NEUTRAL_ENERGY, arcFor, energyOf, energyScale, spread } from './groove'
import { fromRhythm } from './fixtures'
import type { Hit } from './patterns'
import { rng } from './played'

const chordHit = (dur: number, extra: Partial<Hit> = {}): Hit => ({ at: 0, dur, part: 'piano', vel: 1, what: 'chord', ...extra })

describe('spread', () => {
  const voicing = [55, 59, 62, 65]

  it('rolls bottom to top, never wider than 25 ms', () => {
    const r = rng(11)
    for (let i = 0; i < 300; i++) {
      for (const dur of [0.3, 1, 3]) {
        const notes = spread(voicing, chordHit(dur), 50, r)
        expect(notes.map((n) => n.midi)).toEqual(voicing)
        for (let j = 1; j < notes.length; j++) expect(notes[j].delayMs).toBeGreaterThanOrEqual(notes[j - 1].delayMs)
        expect(notes[0].delayMs).toBe(0)
        expect(notes[notes.length - 1].delayMs).toBeLessThanOrEqual(MAX_ROLL_MS)
      }
    }
  })

  it('a stab is nearly together, a held chord rolls wider', () => {
    const width = (dur: number) => {
      const r = rng(5)
      let sum = 0
      for (let i = 0; i < 200; i++) {
        const n = spread(voicing, chordHit(dur), 50, r)
        sum += n[n.length - 1].delayMs
      }
      return sum / 200
    }
    expect(width(0.4)).toBeLessThanOrEqual(8)
    expect(width(3)).toBeGreaterThan(width(1))
    expect(width(1)).toBeGreaterThan(width(0.4))
    expect(width(3)).toBeGreaterThan(10)
  })

  it('varies from chord to chord', () => {
    const r = rng(2)
    const widths = new Set(Array.from({ length: 20 }, () => Math.round(spread(voicing, chordHit(1), 50, r)[3].delayMs)))
    expect(widths.size).toBeGreaterThan(5)
  })

  it('the top note sings over softer inner voices', () => {
    const notes = spread(voicing, chordHit(1), 50, rng(1))
    const top = notes[notes.length - 1].velocity
    for (const inner of notes.slice(1, -1)) expect(inner.velocity).toBeLessThan(notes[0].velocity)
    for (const n of notes.slice(0, -1)) expect(top).toBeGreaterThan(n.velocity)
  })

  it('a ghost is a brush of the top two notes', () => {
    const notes = spread(voicing, chordHit(0.25, { ghost: true }), 20, rng(1))
    expect(notes.map((n) => n.midi)).toEqual([62, 65])
  })

  it('handles empty and single-note voicings', () => {
    expect(spread([], chordHit(1), 50, rng(1))).toEqual([])
    expect(spread([48], chordHit(1), 50, rng(1))).toEqual([{ midi: 48, delayMs: 0, velocity: 55 }])
  })
})

describe('arcFor', () => {
  it('builds into bar 3 and relaxes at the cadence', () => {
    for (let phrase = 0; phrase < 4; phrase++) {
      const a = [0, 1, 2, 3].map((bar) => arcFor(phrase, bar))
      expect(a[2]).toBe(Math.max(...a))
      expect(a[3]).toBe(Math.min(...a))
    }
  })

  it('lifts the B section and lets the end of the form fall away', () => {
    expect(arcFor(2, 2)).toBeGreaterThan(arcFor(0, 2))
    expect(arcFor(3, 3)).toBeLessThan(arcFor(1, 3))
    // The form repeats every four phrases.
    expect(arcFor(6, 1)).toBe(arcFor(2, 1))
  })
})

describe('energyOf', () => {
  it('is zero in silence', () => {
    expect(energyOf([], 10000)).toBe(0)
  })

  it('rises when you play louder and busier', () => {
    const sixteen = Array.from({ length: 64 }, (_, i) => 60 + (i % 8))
    const busyLoud = fromRhythm(sixteen, [0.25], { bpm: 120, velocity: 100, seed: 1 })
    const sparseSoft = fromRhythm(sixteen.slice(0, 8), [2], { bpm: 120, velocity: 45, seed: 1 })
    const at = (notes: { on: number }[]) => Math.max(...notes.map((n) => n.on)) + 100
    const hot = energyOf(busyLoud, at(busyLoud))
    const cool = energyOf(sparseSoft, at(sparseSoft))
    expect(hot).toBeGreaterThan(0.75)
    expect(cool).toBeLessThan(0.25)
  })

  it('counts a chord as one attack', () => {
    const block = fromRhythm([[48, 52, 55, 60]], [1], { bpm: 60, velocity: 70, seed: 1 })
    const single = fromRhythm([48], [1], { bpm: 60, velocity: 70, seed: 1 })
    expect(energyOf(block, 500)).toBeCloseTo(energyOf(single, 500))
  })

  it('maps to a touch the band can hear: neutral is 1', () => {
    expect(energyScale(NEUTRAL_ENERGY)).toBeCloseTo(1)
    expect(energyScale(1) / energyScale(0)).toBeGreaterThan(1.5)
  })
})
