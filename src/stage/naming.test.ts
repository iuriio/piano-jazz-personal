import { describe, expect, it } from 'vitest'
import { jazzQuality, nextNamingStyle, simpleQuality, splitSymbol, styleSymbol } from './naming'

describe('splitSymbol', () => {
  it('separates root, quality and slash bass', () => {
    expect(splitSymbol('C♯m7/G♯')).toEqual({ root: 'C♯', quality: 'm7', bass: 'G♯' })
    expect(splitSymbol('B♭')).toEqual({ root: 'B♭', quality: '', bass: null })
    expect(splitSymbol('C5/G')).toEqual({ root: 'C', quality: '5', bass: 'G' })
  })
})

describe('jazz names', () => {
  it.each([
    ['maj7', 'Δ7'],
    ['maj9', 'Δ9'],
    ['m7', '–7'],
    ['m9', '–9'],
    ['m', '–'],
    ['m7b5', 'ø7'],
    ['dim7', '°7'],
    ['dim', '°'],
    ['7', '7'],
    ['', ''],
    ['aug', '+'],
    ['mMaj7', '–Δ7'],
  ])('%s -> %s', (q, out) => {
    expect(jazzQuality(q)).toBe(out)
  })

  it('puts alterations in parentheses', () => {
    expect(jazzQuality('7#9')).toBe('7(♯9)')
    expect(jazzQuality('7♯9')).toBe('7(♯9)')
    expect(jazzQuality('7b9#11')).toBe('7(♭9,♯11)')
  })
})

describe('simple names', () => {
  it.each([
    ['maj9', 'maj7'],
    ['7#9', '7'],
    ['13', '7'],
    ['m11', 'm7'],
    ['add9', ''],
    ['6', ''],
    ['m7b5', 'm7♭5'],
    ['dim7', 'dim7'],
    ['sus4', 'sus4'],
    ['7sus4', '7sus4'],
    ['mMaj7', 'mMaj7'],
    ['aug', 'aug'],
    ['5', '5'],
  ])('%s -> %s', (q, out) => {
    expect(simpleQuality(q)).toBe(out)
  })
})

describe('styleSymbol', () => {
  it('keeps exact names as they are', () => {
    expect(styleSymbol('C7♯9', 'exact')).toBe('C7♯9')
  })
  it('keeps the slash bass in every style', () => {
    expect(styleSymbol('Dm7/C', 'jazz')).toBe('D–7/C')
    expect(styleSymbol('G13/B', 'simple')).toBe('G7/B')
  })
  it('cycles exact -> jazz -> simple -> exact', () => {
    expect(nextNamingStyle('exact')).toBe('jazz')
    expect(nextNamingStyle('jazz')).toBe('simple')
    expect(nextNamingStyle('simple')).toBe('exact')
  })
})
