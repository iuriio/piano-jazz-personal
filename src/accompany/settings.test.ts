import { describe, expect, it } from 'vitest'
import { ACCOMPANY_DRUMS_OPTIONS, ACCOMPANY_KEYS_OPTIONS, DEFAULT_ACCOMPANY, validAccompany } from './settings'

describe('validAccompany', () => {
  it('falls back to the defaults for missing or broken storage', () => {
    expect(validAccompany(undefined)).toEqual(DEFAULT_ACCOMPANY)
    expect(validAccompany('nonsense')).toEqual(DEFAULT_ACCOMPANY)
  })

  it('keeps what is valid and replaces what is not, field by field', () => {
    const v = validAccompany({ offers: false, style: 'walk', complexity: 9, density: '2', tempo: 'drift', level: 2 })
    expect(v.offers).toBe(false)
    expect(v.style).toBe('walk')
    expect(v.complexity).toBe(DEFAULT_ACCOMPANY.complexity)
    expect(v.density).toBe('2')
    expect(v.tempo).toBe(DEFAULT_ACCOMPANY.tempo)
    expect(v.level).toBe(DEFAULT_ACCOMPANY.level)
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
