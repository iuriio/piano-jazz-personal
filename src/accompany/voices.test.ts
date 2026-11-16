import { describe, expect, it } from 'vitest'
import { midiToFreq, velocityToGain } from '../instrument'
import { highpassDb } from '../sound/fx'
import { BASS_CEIL, PIANO_FLOOR } from './voicing'
import {
  BASS_ENV,
  BASS_GAIN_SCALE,
  PAD_GAIN_SCALE,
  PAD_HIGHPASS_HZ,
  PAD_HIGHPASS_Q,
  bassFilter,
  bassLevelAt,
  detuneSpread,
  driveCurve,
  padEnvelope,
  padFilter,
  touchFromGain,
} from './voices'

describe('touchFromGain', () => {
  const touchAt = (vel: number, scale: number) => touchFromGain(velocityToGain(vel) * scale, scale)

  it('spans the band’s working range (velocity ~12–60) audibly', () => {
    expect(touchAt(12, PAD_GAIN_SCALE)).toBeLessThan(0.1)
    expect(touchAt(60, PAD_GAIN_SCALE)).toBeGreaterThan(0.7)
    expect(touchAt(60, BASS_GAIN_SCALE)).toBeCloseTo(touchAt(60, PAD_GAIN_SCALE), 6)
  })

  it('is monotonic and clamped to 0..1', () => {
    let prev = -1
    for (let v = 0; v <= 127; v++) {
      const t = touchAt(v, PAD_GAIN_SCALE)
      expect(t).toBeGreaterThanOrEqual(prev)
      expect(t).toBeLessThanOrEqual(1)
      prev = t
    }
    expect(touchAt(0, PAD_GAIN_SCALE)).toBe(0)
    expect(touchAt(127, PAD_GAIN_SCALE)).toBe(1)
  })
})

describe('detuneSpread', () => {
  const s = detuneSpread(7, 5, 24)

  it('is symmetric around a centred, in-tune voice', () => {
    expect(s).toHaveLength(7)
    expect(s[3].cents).toBe(0)
    expect(s[3].pan).toBe(0)
    for (let i = 0; i < 3; i++) {
      expect(s[i].cents).toBeCloseTo(-s[6 - i].cents, 9)
      expect(s[i].pan).toBeCloseTo(-s[6 - i].pan, 9)
    }
  })

  it('spreads outer voices wider, within 5–24 cents', () => {
    const abs = s.slice(4).map((v) => v.cents)
    expect(abs[0]).toBeGreaterThanOrEqual(5)
    expect(abs[2]).toBeCloseTo(24, 9)
    expect(abs[1] - abs[0]).toBeLessThan(abs[2] - abs[1])
  })

  it('normalises power and keeps the centre loudest', () => {
    expect(s.reduce((a, v) => a + v.level ** 2, 0)).toBeCloseTo(1, 9)
    for (const v of s) expect(v.level).toBeLessThanOrEqual(s[3].level)
  })
})

describe('padEnvelope', () => {
  it('fades in slowly but fits short notes', () => {
    expect(padEnvelope(2).attack).toBeCloseTo(0.6)
    expect(padEnvelope(0.3).attack).toBeCloseTo(0.12)
    expect(padEnvelope(1).attack).toBeLessThan(1)
  })

  it('releases long', () => {
    expect(padEnvelope(0.5).release).toBeGreaterThanOrEqual(0.8)
    expect(padEnvelope(8).release).toBeLessThanOrEqual(1.8)
  })

  it('swells only through long notes', () => {
    expect(padEnvelope(4).start).toBeLessThan(1)
    expect(padEnvelope(0.4).start).toBe(1)
  })
})

describe('padFilter', () => {
  it('is darker soft and brighter loud', () => {
    const soft = padFilter(0, 60)
    const loud = padFilter(1, 60)
    expect(soft.peak).toBeLessThan(900)
    expect(loud.peak).toBeGreaterThan(2500)
    expect(loud.peak).toBeLessThan(3500)
    expect(soft.from).toBeLessThan(soft.peak)
  })

  it('opens over about a second', () => {
    expect(padFilter(0, 60).open).toBeGreaterThan(0.8)
    expect(padFilter(1, 60).open).toBeLessThanOrEqual(1.5)
  })

  it('tracks pitch mildly and caps', () => {
    expect(padFilter(0.5, 72).peak).toBeGreaterThan(padFilter(0.5, 48).peak)
    expect(padFilter(1, 108).peak).toBeLessThanOrEqual(4000)
  })
})

describe('bassFilter', () => {
  it('plucks brighter with touch and settles warm', () => {
    expect(bassFilter(1).peak).toBeGreaterThan(bassFilter(0).peak)
    expect(bassFilter(1).sustain).toBeLessThan(900)
    expect(bassFilter(0).sustain).toBeLessThan(bassFilter(0).peak)
  })
})

describe('pad highpass', () => {
  const db = (midi: number) => highpassDb(midiToFreq(midi), PAD_HIGHPASS_HZ, PAD_HIGHPASS_Q)

  it('sits above the whole bass register', () => {
    expect(PAD_HIGHPASS_HZ).toBeGreaterThan(midiToFreq(BASS_CEIL))
    expect(db(BASS_CEIL)).toBeLessThan(-7)
    // E2, the middle of the bass's range: what the old sub sine filled.
    expect(db(40)).toBeLessThan(-12)
  })

  it('thins the pad’s lowest voice and leaves the middle alone', () => {
    expect(db(PIANO_FLOOR)).toBeLessThan(-5)
    expect(db(PIANO_FLOOR)).toBeGreaterThan(-9)
    expect(db(60)).toBeGreaterThan(-1)
  })
})

describe('bass envelope', () => {
  const dB = (x: number) => 20 * Math.log10(x)

  it('plucks: drops to its body within ~0.3 s', () => {
    expect(bassLevelAt(0.01)).toBeCloseTo(1, 6)
    expect(bassLevelAt(0.3)).toBeLessThan(0.76)
    expect(bassLevelAt(0.3)).toBeGreaterThan(BASS_ENV.body)
  })

  it('thins through a held note instead of droning', () => {
    // A two-feel half note at 120 bpm keeps most of its weight...
    expect(bassLevelAt(1)).toBeGreaterThan(0.55)
    // ...a whole bar at 60 bpm is well down by its end.
    expect(dB(bassLevelAt(2))).toBeLessThan(-5.5)
    expect(bassLevelAt(4)).toBeGreaterThanOrEqual(BASS_ENV.tail)
    expect(bassLevelAt(4)).toBeLessThan(BASS_ENV.tail + 0.03)
    for (let t = 0.02; t < 6; t += 0.05) expect(bassLevelAt(t + 0.05)).toBeLessThanOrEqual(bassLevelAt(t))
  })

  it('lets go fast, and faster still when the next note comes', () => {
    // Seven time constants is where the voice stops: under 0.5 s.
    expect(BASS_ENV.release * 7).toBeLessThan(0.5)
    expect(BASS_ENV.choke * 4).toBeLessThan(0.06)
  })
})

describe('driveCurve', () => {
  it('is odd, monotonic and maps ±1 to ±1', () => {
    const c = driveCurve(1.6, 513)
    expect(c[0]).toBeCloseTo(-1, 9)
    expect(c[512]).toBeCloseTo(1, 9)
    expect(c[256]).toBeCloseTo(0, 9)
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThan(c[i - 1])
    for (let i = 0; i < c.length; i++) expect(c[i]).toBeCloseTo(-c[c.length - 1 - i], 9)
  })
})
