import { describe, expect, it } from 'vitest'
import { chorusCents, makeImpulse, rms, rng } from './fx'

describe('makeImpulse', () => {
  const sr = 48000

  it('is stereo, predelay + RT60 long, silent during the predelay', () => {
    const [l, r] = makeImpulse(sr, { seconds: 2.8, predelay: 0.02 })
    expect(l.length).toBe(Math.round(0.02 * sr) + Math.round(2.8 * sr))
    expect(r.length).toBe(l.length)
    expect(rms(l, 0, Math.round(0.02 * sr))).toBe(0)
  })

  it('has unit energy per channel', () => {
    const [l, r] = makeImpulse(sr)
    expect(rms(l) ** 2 * l.length).toBeCloseTo(1, 4)
    expect(rms(r) ** 2 * r.length).toBeCloseTo(1, 4)
  })

  it('decays roughly 60 dB over its length', () => {
    const [l] = makeImpulse(sr, { seconds: 2.5, predelay: 0 })
    const win = Math.round(0.1 * sr)
    const early = rms(l, win, 2 * win)
    const late = rms(l, l.length - win, l.length)
    const db = 20 * Math.log10(late / early)
    expect(db).toBeLessThan(-45)
    expect(db).toBeGreaterThan(-75)
  })

  it('has decorrelated channels (that is the stereo width)', () => {
    const [l, r] = makeImpulse(sr)
    let dot = 0
    for (let i = 0; i < l.length; i++) dot += l[i] * r[i]
    expect(Math.abs(dot)).toBeLessThan(0.1)
  })

  it('has no DC', () => {
    const [l] = makeImpulse(sr)
    const mean = l.reduce((s, v) => s + v, 0) / l.length
    expect(Math.abs(mean)).toBeLessThan(1e-4)
  })

  it('darkens as it decays', () => {
    // High-frequency content measured by first difference, relative to level.
    const [l] = makeImpulse(sr, { predelay: 0 })
    const hf = (from: number, to: number) => {
      let d = 0
      for (let i = from + 1; i < to; i++) d += (l[i] - l[i - 1]) ** 2
      return Math.sqrt(d / (to - from)) / rms(l, from, to)
    }
    const win = Math.round(0.2 * sr)
    expect(hf(l.length - 3 * win, l.length - 2 * win)).toBeLessThan(hf(win, 2 * win) * 0.6)
  })

  it('is deterministic for a seed', () => {
    const a = makeImpulse(8000, { seconds: 0.5, seed: 7 })[0]
    const b = makeImpulse(8000, { seconds: 0.5, seed: 7 })[0]
    expect(Array.from(a.slice(0, 200))).toEqual(Array.from(b.slice(0, 200)))
  })
})

describe('chorus', () => {
  it('detunes gently: under 10 cents peak', () => {
    expect(chorusCents()).toBeGreaterThan(3)
    expect(chorusCents()).toBeLessThan(10)
  })
})

describe('rng', () => {
  it('stays in [0, 1)', () => {
    const r = rng(1)
    for (let i = 0; i < 1000; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})
