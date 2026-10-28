import { describe, expect, it } from 'vitest'
import { keyById, readChord } from '../analysis'
import { nextShownChord } from './shownChord'

const opts = { key: keyById('C'), split: 'off' as const, splitPoint: 47 }
const name = (notes: number[]) => readChord(notes, opts)?.symbol

// A4 C5 E5, D4 F4 A4 C5…: the computer keys' octave, as in the smoke tests.
const Am = [69, 72, 76]
const Dm = [62, 65, 69]
const Dm7 = [62, 65, 69, 72]
const C7 = [60, 64, 67, 70]
const Cmaj7 = [60, 64, 67, 71]

/** Plays a sequence of settled readings and returns the card after each. */
function play(steps: { notes: number[]; struck: boolean; liftedLater?: boolean }[]): (string | undefined)[] {
  let shown: number[] = []
  let prev: number[] = []
  return steps.map(({ notes, struck, liftedLater = false }) => {
    shown = nextShownChord(shown, prev, notes, { struck, liftedLater }, opts)
    prev = notes
    return name(shown)
  })
}

const hit = (notes: number[]) => ({ notes, struck: true })
const lift = (notes: number[]) => ({ notes, struck: false })
/** Lifting notes that were added after the rest was already down. */
const liftAdded = (notes: number[]) => ({ notes, struck: false, liftedLater: true })

describe('nextShownChord: letting go', () => {
  it('lifting the third of A minor is still A minor, not A5', () => {
    expect(play([hit(Am), lift([69, 76])])).toEqual(['Am', 'Am'])
  })

  it('lifting the third of D minor is still D minor, not D5', () => {
    expect(play([hit(Dm), lift([62, 69])])).toEqual(['Dm', 'Dm'])
  })

  it('lifting the root of Dm7 is still Dm7, not F', () => {
    expect(play([hit(Dm7), lift([65, 69, 72])])).toEqual(['Dm7', 'Dm7'])
  })

  it('lifting the root of C7 is still C7, not Edim', () => {
    expect(play([hit(C7), lift([64, 67, 70])])).toEqual(['C7', 'C7'])
  })

  it('lifting the hand note by note keeps the chord to the end, top first too', () => {
    expect(play([hit(Cmaj7), lift([60, 64, 67]), lift([60, 64]), lift([60])])).toEqual([
      'Cmaj7',
      'Cmaj7',
      'Cmaj7',
      'Cmaj7',
    ])
    expect(play([hit(Cmaj7), lift([60, 64, 71]), lift([60, 71]), lift([60])])).toEqual([
      'Cmaj7',
      'Cmaj7',
      'Cmaj7',
      'Cmaj7',
    ])
  })

  it('a melody note lifted off the top goes back to the voicing under it', () => {
    expect(play([hit(Cmaj7), hit([...Cmaj7, 74]), liftAdded(Cmaj7)])).toEqual(['Cmaj7', 'Cmaj9', 'Cmaj7'])
  })

  it('so does a note added in the middle', () => {
    const C = [60, 64, 67]
    expect(play([hit(C), hit([60, 64, 65, 67]), liftAdded(C)])).toEqual(['C', 'Cadd11', 'C'])
  })

  it('an added note lifted with part of the chord leaves too little to rename', () => {
    expect(play([hit(Cmaj7), hit([...Cmaj7, 74]), liftAdded([60, 64])])).toEqual(['Cmaj7', 'Cmaj9', 'Cmaj9'])
  })

  it('lifting the top of a triad leaves an interval, so the triad stays', () => {
    expect(play([hit(Am), lift([69, 72])])).toEqual(['Am', 'Am'])
  })
})

describe('nextShownChord: playing', () => {
  it('a re-struck fifth after a chord is a power chord', () => {
    expect(play([hit(Am), hit([69, 76])])).toEqual(['Am', 'A5'])
  })

  it('a new chord replaces the old one', () => {
    expect(play([hit(Am), hit(Dm)])).toEqual(['Am', 'Dm'])
  })

  it('a lone note, an interval or a cluster keep the chord', () => {
    expect(play([hit(Am), hit([74]), hit([60, 64]), hit([60, 61, 62])])).toEqual(['Am', 'Am', 'Am', 'Am'])
  })

  it('a melody over a triad renames it the way a pianist would', () => {
    const C = [60, 64, 67]
    expect(play([hit(C), hit([...C, 69]), hit([...C, 71]), hit([...C, 74]), hit([60, 64, 65, 67])])).toEqual([
      'C',
      'C6',
      'Cmaj7',
      'Cadd9',
      'Cadd11',
    ])
  })

  it('before any chord, whatever is played shows', () => {
    expect(play([hit([60])])).toEqual(['C'])
  })
})
