import { describe, expect, it } from 'vitest'
import { chordText } from './display'

describe('chordText', () => {
  it('writes the planner symbols the way the card does', () => {
    expect(chordText('Bbmaj7', 'jazz')).toBe('B♭Δ7')
    expect(chordText('Cm7', 'jazz')).toBe('C–7')
    expect(chordText('Am7b5', 'jazz')).toBe('Aø7')
    expect(chordText('D7b9', 'exact')).toBe('D7♭9')
    expect(chordText('Bbmaj9', 'simple')).toBe('B♭maj7')
    expect(chordText('Eb', 'exact')).toBe('E♭')
  })
})
