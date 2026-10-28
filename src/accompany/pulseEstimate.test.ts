import { describe, expect, it } from 'vitest'
import { STEADY, estimatePulse, isSteady, mergeAttacks, nextBeat } from './pulseEstimate'
import { chordStream, hanon1, mixedRhythm, rubato, scaleRun, swingEighths } from './fixtures'

const near = (bpm: number | undefined, target: number) => {
  expect(bpm).toBeDefined()
  expect(Math.abs(bpm! - target)).toBeLessThanOrEqual(2)
}

describe('estimatePulse', () => {
  it('sixteenths at 92 with an accent on the beat: 92, with 46 and 184 on offer', () => {
    const p = estimatePulse(scaleRun(58, 'major', { bpm: 92, jitterMs: 12, accent: 20, repeats: 2 }))!
    near(p.bpm, 92)
    expect(p.perBeat).toBe(4)
    expect(p.alts.map(Math.round)).toEqual([46, 184])
    expect(isSteady(p)).toBe(true)
  })

  it('sixteenths at 92 with a flat touch: still 92, not grouped in threes', () => {
    near(estimatePulse(scaleRun(58, 'major', { bpm: 92, jitterMs: 12, repeats: 2 }))?.bpm, 92)
    near(estimatePulse(hanon1(48, { bpm: 92, jitterMs: 12 }))?.bpm, 92)
  })

  it('eighths at 120', () => {
    near(estimatePulse(scaleRun(58, 'major', { bpm: 120, jitterMs: 12, perBeat: 2, repeats: 2 }))?.bpm, 120)
  })

  it('triplets at 80, leaning on the beat', () => {
    const p = estimatePulse(scaleRun(58, 'major', { bpm: 80, jitterMs: 12, perBeat: 3, accent: 20, repeats: 2 }))!
    near(p.bpm, 80)
    expect(p.perBeat).toBe(3)
  })

  it('quarters at 72', () => {
    near(estimatePulse(scaleRun(58, 'major', { bpm: 72, jitterMs: 12, perBeat: 1 }))?.bpm, 72)
  })

  it('the mixed rhythm of a tune at 100', () => {
    near(estimatePulse(mixedRhythm(60, { bpm: 100, jitterMs: 12 }))?.bpm, 100)
  })

  it('rubato has no grid: steadiness over the threshold', () => {
    const p = estimatePulse(rubato(60, 'major', {}))
    expect(p).not.toBeNull()
    expect(p!.steadiness).toBeGreaterThan(STEADY)
    expect(isSteady(p)).toBe(false)
  })

  it('stays put with ±25 ms of jitter', () => {
    const p = estimatePulse(scaleRun(58, 'major', { bpm: 92, jitterMs: 25, repeats: 2 }))!
    near(p.bpm, 92)
    expect(isSteady(p)).toBe(true)
  })

  it('a chord is one attack: block chords on every beat at 90 read as 90', () => {
    const notes = chordStream(['Dm7', 'G7', 'Cmaj7', 'A7', 'Dm7', 'G7', 'Cmaj7', 'Cmaj7', 'Dm7', 'G7'], {
      bpm: 90,
      beatsEach: 1,
      jitterMs: 10,
    })
    expect(mergeAttacks(notes)).toHaveLength(10)
    near(estimatePulse(notes)?.bpm, 90)
  })

  it('folds notes under 50 ms apart and keeps the hardest touch', () => {
    const a = mergeAttacks([
      { on: 0, velocity: 60 },
      { on: 20, velocity: 90 },
      { on: 45, velocity: 50 },
      { on: 300, velocity: 70 },
    ])
    expect(a).toEqual([
      { t: 0, velocity: 90, size: 3 },
      { t: 300, velocity: 70, size: 1 },
    ])
  })

  it('hears 2:1 swing as swing, straight eighths as straight', () => {
    const swung = estimatePulse(swingEighths(55, { bpm: 120, ratio: 2 / 3, jitterMs: 8 }))!
    near(swung.bpm, 120)
    expect(swung.swung).toBe(true)
    expect(swung.swing).toBeGreaterThan(0.6)

    const straight = estimatePulse(swingEighths(55, { bpm: 120, ratio: 0.5, jitterMs: 8 }))!
    near(straight.bpm, 120)
    expect(straight.swung).toBe(false)
  })

  it('anchors the grid on a beat that was played', () => {
    const notes = scaleRun(58, 'major', { bpm: 100, perBeat: 2, repeats: 2 })
    const p = estimatePulse(notes)!
    // Every attack sits on the anchor's grid within a few ms (eighths: half beats).
    for (const n of notes) {
      const x = ((n.on - p.anchor) / (p.beatMs / 2)) % 1
      expect(Math.min(Math.abs(x), 1 - Math.abs(x))).toBeLessThan(0.05)
    }
    expect(nextBeat(p, p.anchor + 1)).toBeCloseTo(p.anchor + p.beatMs, 6)
  })

  it('returns null with only a handful of notes', () => {
    expect(estimatePulse(scaleRun(60, 'major', { bpm: 100 }).slice(0, 5))).toBeNull()
  })
})
