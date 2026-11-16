import { describe, expect, it } from 'vitest'
import {
  ACCOMPANY_DRUMS_OPTIONS,
  ACCOMPANY_KEYS_OPTIONS,
  BPM_MAX,
  BPM_MIN,
  DEFAULT_ACCOMPANY,
  FIXED_KEYS,
  parseKey,
  validAccompany,
} from './settings'

describe('validAccompany', () => {
  it('falls back to the defaults for missing or broken storage', () => {
    expect(validAccompany(undefined)).toEqual(DEFAULT_ACCOMPANY)
    expect(validAccompany('nonsense')).toEqual(DEFAULT_ACCOMPANY)
  })

  it('keeps what is valid and replaces what is not, field by field', () => {
    const v = validAccompany({ key: '7:minor', style: 'walk', complexity: 9, density: '2', bpm: 'fast', level: 2 })
    expect(v.key).toBe('7:minor')
    expect(v.style).toBe('walk')
    expect(v.complexity).toBe(DEFAULT_ACCOMPANY.complexity)
    expect(v.density).toBe('2')
    expect(v.bpm).toBe(DEFAULT_ACCOMPANY.bpm)
    expect(v.level).toBe(DEFAULT_ACCOMPANY.level)
  })

  it('keeps the tempo in range and drops keys it cannot read', () => {
    expect(validAccompany({ bpm: 400 }).bpm).toBe(BPM_MAX)
    expect(validAccompany({ bpm: 10 }).bpm).toBe(BPM_MIN)
    expect(validAccompany({ bpm: 101.6 }).bpm).toBe(102)
    expect(validAccompany({ key: '12:major' }).key).toBe('auto')
    expect(validAccompany({ key: 'C' }).key).toBe('auto')
  })

  it('reads a fixed key, minor through its relative major', () => {
    expect(parseKey('9:minor')).toEqual({ center: 9, mode: 'minor', collectionPc: 0 })
    expect(FIXED_KEYS).toHaveLength(24)
    expect(FIXED_KEYS[0].label).toBe('C major')
  })

  it('validates the band piano and the drums', () => {
    expect(DEFAULT_ACCOMPANY.drums).toBe('off')
    expect(validAccompany({ keys: 'wurlitzer', drums: 'acoustic' })).toMatchObject({ keys: 'wurlitzer', drums: 'acoustic' })
    expect(validAccompany({ keys: 'synth', drums: 'off' })).toMatchObject({ keys: 'synth', drums: 'off' })
    expect(validAccompany({ keys: 'harpsichord', drums: 'tr909' })).toMatchObject({
      keys: DEFAULT_ACCOMPANY.keys,
      drums: DEFAULT_ACCOMPANY.drums,
    })
  })

  it('offers every valid value in its select options, and nothing else', () => {
    for (const o of ACCOMPANY_KEYS_OPTIONS) expect(validAccompany({ keys: o.value }).keys).toBe(o.value)
    for (const o of ACCOMPANY_DRUMS_OPTIONS) expect(validAccompany({ drums: o.value }).drums).toBe(o.value)
    expect(ACCOMPANY_DRUMS_OPTIONS[0].value).toBe('off')
  })
})
