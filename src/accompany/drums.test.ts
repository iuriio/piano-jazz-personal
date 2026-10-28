import { describe, expect, it } from 'vitest'
import { drumBar, kitVelocity, type DrumBarOpts, type DrumPiece } from './drums'

const base: DrumBarOpts = { style: 'comp', free: false, phrase: 0, bar: 1, barCount: 5, energy: 0.5, baseVel: 40, seed: 1234 }
const at = (o: DrumBarOpts, piece: DrumPiece) => drumBar(o).filter((h) => h.piece === piece).map((h) => h.at)
const vel = (o: DrumBarOpts, piece: DrumPiece, t: number) => drumBar(o).find((h) => h.piece === piece && h.at === t)!.velocity

describe('drum grooves', () => {
  it('keeps out of free time entirely', () => {
    for (const style of ['pad', 'even', 'comp', 'walk'] as const) expect(drumBar({ ...base, style, free: true })).toEqual([])
  })

  it('pad: a soft ride on 1, on 3 with some weight, the foot on 2 and 4 when you dig in', () => {
    expect(at({ ...base, style: 'pad', energy: 0.1 }, 'ride')).toEqual([0])
    expect(at({ ...base, style: 'pad', energy: 0.4 }, 'ride')).toEqual([0, 2])
    expect(at({ ...base, style: 'pad', energy: 0.4 }, 'chick')).toEqual([])
    expect(at({ ...base, style: 'pad', energy: 0.8 }, 'chick')).toEqual([1, 3])
    expect(at({ ...base, style: 'pad' }, 'kick')).toEqual([])
  })

  it('even: eighth-note hat, kick on 1 and 3, backbeat on 2 and 4', () => {
    expect(at({ ...base, style: 'even' }, 'hat')).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5])
    expect(at({ ...base, style: 'even' }, 'kick').filter((t) => t !== 2.5)).toEqual([0, 2])
    expect(at({ ...base, style: 'even', energy: 0.2 }, 'rim')).toEqual([1, 3])
    expect(at({ ...base, style: 'even', energy: 0.9 }, 'snare')).toEqual([1, 3])
    // The phrase's last bar opens the hat on the "and" of 4.
    const last = { ...base, style: 'even' as const, bar: 3 }
    expect(at(last, 'open')).toEqual([3.5])
    expect(at(last, 'hat')).not.toContain(3.5)
  })

  it('comp and walk: the jazz ride, the foot on 2 and 4, a feathered kick on every beat', () => {
    for (const style of ['comp', 'walk'] as const) {
      const o = { ...base, style }
      expect(at(o, 'ride')).toEqual([0, 1, 1.5, 2, 3, 3.5])
      expect(at(o, 'chick')).toEqual([1, 3])
      expect(at(o, 'kick')).toEqual([0, 1, 2, 3])
    }
  })

  it('accents the ride on 2 and 4 and keeps the skip notes under them', () => {
    const o = { ...base, style: 'walk' as const }
    const two = vel(o, 'ride', 1)
    const one = vel(o, 'ride', 0)
    const skip = vel(o, 'ride', 1.5)
    expect(two).toBeGreaterThan(one)
    expect(one).toBeGreaterThan(skip)
    // Feathered means quiet: well under the ride.
    expect(vel(o, 'kick', 0)).toBeLessThan(skip)
  })

  it('plays only on the eighth-note grid, inside the bar, at valid velocities', () => {
    for (const style of ['pad', 'even', 'comp', 'walk'] as const) {
      for (let barCount = 0; barCount < 32; barCount++) {
        for (const h of drumBar({ ...base, style, barCount, bar: barCount % 4, energy: (barCount % 5) / 4 })) {
          expect(h.at).toBeGreaterThanOrEqual(0)
          expect(h.at).toBeLessThan(4)
          expect((h.at * 2) % 1).toBe(0)
          expect(h.velocity).toBeGreaterThanOrEqual(1)
          expect(h.velocity).toBeLessThanOrEqual(127)
          expect(Math.abs(h.lateMs)).toBeLessThan(10)
        }
      }
    }
  })

  it('is deterministic under a seed, and the bars differ', () => {
    const a = drumBar({ ...base, style: 'walk' })
    expect(drumBar({ ...base, style: 'walk' })).toEqual(a)
    expect(drumBar({ ...base, style: 'walk', seed: 99 })).not.toEqual(a)
  })

  it('louder and busier with you: more snare comping and harder hits at high energy', () => {
    let calm = 0
    let busy = 0
    for (let barCount = 0; barCount < 200; barCount++) {
      calm += at({ ...base, barCount, bar: 1, energy: 0 }, 'snare').length
      busy += at({ ...base, barCount, bar: 1, energy: 1 }, 'snare').length
    }
    expect(busy).toBeGreaterThan(calm * 1.5)
    expect(vel({ ...base, energy: 1 }, 'ride', 1)).toBeGreaterThan(vel({ ...base, energy: 0 }, 'ride', 1))
  })
})

describe('kitVelocity', () => {
  it('keeps order and compresses into the kit range', () => {
    expect(kitVelocity(0)).toBe(40)
    expect(kitVelocity(127)).toBe(127)
    expect(kitVelocity(999)).toBe(127)
    for (let v = 1; v < 127; v++) expect(kitVelocity(v)).toBeGreaterThanOrEqual(kitVelocity(v - 1))
  })
})
