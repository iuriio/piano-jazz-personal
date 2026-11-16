import { describe, expect, it } from 'vitest'
import { chordLabel } from '../theory'
import { QUALITIES } from '../voicings'
import { INTERVALS } from './intervals'
import { sayChord, sayInterval, sayNote } from './say'
import { CHORDS, chordQuestion } from './sevenths'
import { itemId } from './speed'
import { ROOT_NAMES } from './spell'
import { KEY_CHAIN, chordSymbols } from './twoFiveOne'
import { preferredVoice } from './voice'

describe('what the voice says', () => {
  it('says accidentals as words, from ASCII or glyphs', () => {
    expect(sayNote('F#')).toBe('F-sharp')
    expect(sayNote('B♭')).toBe('B-flat')
    expect(sayNote('C')).toBe('C')
  })

  it('keeps the letter A from being read as the article', () => {
    expect(sayNote('A')).toBe('A,')
    expect(sayNote('Ab')).toBe('A-flat')
    expect(sayChord('Am7')).toBe('A, minor seven')
    expect(sayChord('A♭maj7')).toBe('A-flat major seven')
  })

  it('says the chords the lesson names', () => {
    expect(sayChord('F♯m7')).toBe('F-sharp minor seven')
    expect(sayChord('Bbmaj7')).toBe('B-flat major seven')
    expect(sayChord('G7')).toBe('G seven')
    expect(sayChord('Dø')).toBe('D half diminished')
  })

  it('says the question of the interval drill', () => {
    expect(sayInterval('minor 7th', 'F#')).toBe('minor seventh above F-sharp')
    expect(sayInterval('perfect 5th', 'Db')).toBe('perfect fifth above D-flat')
    expect(sayInterval('tritone', 'E')).toBe('tritone above E')
  })

  // Anything left as a symbol would be read out letter by letter, or skipped.
  const spoken = /^[A-Za-z,\- ]+$/

  it('has words for every question of every drill', () => {
    for (const i of INTERVALS) for (const root of ROOT_NAMES) expect(sayInterval(i.name, root), i.id).toMatch(spoken)
    for (const c of CHORDS) {
      for (let pc = 0; pc < 12; pc++) expect(sayChord(chordQuestion(itemId(c.id, pc)).symbol), c.id).toMatch(spoken)
    }
    for (const tonality of ['major', 'minor'] as const) {
      for (const tonic of KEY_CHAIN) for (const s of chordSymbols(tonality, tonic)) expect(sayChord(s), s).toMatch(spoken)
    }
    for (const q of QUALITIES) {
      for (let pc = 0; pc < 12; pc++) {
        for (const spelling of ['flat', 'sharp'] as const) expect(sayChord(chordLabel(pc, q, spelling))).toMatch(spoken)
      }
    }
  })
})

describe('which voice speaks', () => {
  const v = (name: string, lang: string) => ({ name, lang })

  it('picks a plain voice on a Mac, not the first English one in the list', () => {
    const mac = [v('Luciana', 'pt-BR'), v('Albert', 'en-US'), v('Bad News', 'en-US'), v('Daniel', 'en-GB'), v('Samantha', 'en-US')]
    expect(preferredVoice(mac)?.name).toBe('Samantha')
  })

  it('matches a name from its start', () => {
    expect(preferredVoice([v('Microsoft Aria Online (Natural) - English (United States)', 'en-US')])?.name).toMatch(/^Microsoft Aria/)
  })

  it('never picks a voice in another language, whatever it is called', () => {
    expect(preferredVoice([v('Samantha', 'pt-BR')])).toBeNull()
  })

  it('falls back to any plain English voice, American first, never a novelty one', () => {
    expect(preferredVoice([v('Albert', 'en-US'), v('Fiona', 'en-GB'), v('Reed', 'en-US')])?.name).toBe('Reed')
    expect(preferredVoice([v('Zarvox', 'en-US'), v('Fiona', 'en_GB')])?.name).toBe('Fiona')
  })

  it('has no voice when there is no English one, so nothing is read in another language', () => {
    expect(preferredVoice([v('Luciana', 'pt-BR'), v('Zarvox', 'en-US')])).toBeNull()
    expect(preferredVoice([])).toBeNull()
  })
})
