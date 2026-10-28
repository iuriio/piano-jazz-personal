import { describe, expect, it } from 'vitest'
import { KEY_SIGNATURES, chordNames, keyById, readChord, spellMidi, spellPc, vexKey, type BassSplit } from './analysis'

const C3 = 48
const C4 = 60

const read = (notes: number[], keyId = 'C', split: BassSplit = 'off', splitPoint = 47) =>
  readChord(notes, { key: keyById(keyId), split, splitPoint })!

describe('key signatures', () => {
  it('lists the 15 keys, sharps then flats', () => {
    expect(KEY_SIGNATURES.map((k) => k.id)).toEqual([
      'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb',
    ])
    expect(KEY_SIGNATURES.map((k) => k.accidentals)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, -1, -2, -3, -4, -5, -6, -7])
  })

  it('labels major and relative minor with glyphs', () => {
    expect(keyById('C').label).toBe('C major / A minor')
    expect(keyById('F#').label).toBe('F♯ major / D♯ minor')
    expect(keyById('Bb').label).toBe('B♭ major / G minor')
    expect(keyById('Cb').label).toBe('C♭ major / A♭ minor')
  })

  it('knows the tonic pitch class', () => {
    expect(keyById('Eb').tonicPc).toBe(3)
    expect(keyById('Cb').tonicPc).toBe(11)
    expect(keyById('C#').tonicPc).toBe(1)
  })

  it('falls back to C', () => {
    expect(keyById('H').id).toBe('C')
  })
})

describe('spelling for the key', () => {
  it('uses the letters of the scale', () => {
    expect(spellMidi(66, keyById('D'))).toBe('F#4')
    expect(spellMidi(70, keyById('Bb'))).toBe('Bb4')
    expect(spellMidi(65, keyById('C#'))).toBe('E#4')
  })

  // The octave follows the letter, as in scientific pitch.
  it('puts Cb and B# in the octave of their letter', () => {
    expect(spellMidi(71, keyById('Cb'))).toBe('Cb5')
    expect(spellMidi(60, keyById('C#'))).toBe('B#3')
    expect(spellMidi(64, keyById('Cb'))).toBe('Fb4')
  })

  it('chromatic notes go sharp in C and sharp keys, flat in flat keys', () => {
    expect(spellMidi(61, keyById('C'))).toBe('C#4')
    expect(spellMidi(63, keyById('G'))).toBe('D#4')
    expect(spellMidi(61, keyById('F'))).toBe('Db4')
    expect(spellMidi(66, keyById('Eb'))).toBe('Gb4')
  })

  it('chromatic naturals stay natural', () => {
    expect(spellMidi(71, keyById('F'))).toBe('B4')
    expect(spellMidi(64, keyById('Gb'))).toBe('E4')
  })

  it('pitch class without octave', () => {
    expect(spellPc(66, keyById('D'))).toBe('F#')
    expect(spellPc(71, keyById('Cb'))).toBe('Cb')
    expect(spellPc(C4, keyById('C'))).toBe('C')
  })

  it('VexFlow key agrees with the name, octave included', () => {
    expect(vexKey(66, keyById('D'))).toBe('f#/4')
    expect(vexKey(70, keyById('Bb'))).toBe('bb/4')
    expect(vexKey(71, keyById('Cb'))).toBe('cb/5')
    expect(vexKey(60, keyById('C#'))).toBe('b#/3')
    expect(vexKey(C4, keyById('C'))).toBe('c/4')
  })
})

describe('readChord: empty and single notes', () => {
  it('returns null for nothing held', () => {
    expect(readChord([], { key: keyById('C'), split: 'off', splitPoint: 47 })).toBeNull()
  })

  it('a single note', () => {
    expect(read([C4])).toEqual({
      kind: 'note',
      symbol: 'C',
      name: 'Single note',
      position: '—',
      voicing: '—',
      root: 'C',
      intervals: ['R'],
      spelled: ['C'],
      count: 1,
      bass: null,
      alternatives: [],
      extras: [],
    })
  })

  it('a single note is spelled for the key', () => {
    expect(read([66], 'D').symbol).toBe('F♯')
    expect(read([66], 'Db').symbol).toBe('G♭')
  })

  it('octaves of one note are still one note', () => {
    const r = read([C3, C4])
    expect(r.name).toBe('Single note')
    expect(r.count).toBe(2)
    expect(r.spelled).toEqual(['C', 'C'])
  })
})

describe('readChord: dyads', () => {
  it('a fifth is a power chord', () => {
    const r = read([C3, C3 + 7])
    expect(r.symbol).toBe('C5')
    expect(r.name).toBe('Open fifth')
    expect(r.position).toBe('Root position')
    expect(r.intervals).toEqual(['R', '5'])
    expect(r.voicing).toBe('Close')
  })

  it('a fourth is the power chord with the fifth in the bass', () => {
    const r = read([C3 + 7, C4])
    expect(r.symbol).toBe('C5/G')
    expect(r.name).toBe('Open fifth')
    expect(r.position).toBe('2nd Inversion (/G)')
    expect(r.intervals).toEqual(['5', 'R'])
    expect(r.spelled).toEqual(['G', 'C'])
    expect(r.root).toBe('C')
  })

  it('a doubled power chord is still a power chord', () => {
    expect(read([C3, C3 + 7, C4]).symbol).toBe('C5')
    expect(read([C3 + 7, C4, C4 + 7]).symbol).toBe('C5/G')
  })

  it('other dyads are named by their interval, over the lower note', () => {
    const third = read([C4, C4 + 4])
    expect(third.symbol).toBe('C')
    expect(third.name).toBe('Major third')
    expect(third.intervals).toEqual(['R', '3'])
    expect(third.position).toBe('—')

    expect(read([C4, C4 + 10]).name).toBe('Minor seventh')
    expect(read([C4, C4 + 6]).name).toBe('Tritone')
    expect(read([C4, C4 + 1]).name).toBe('Minor second')
    expect(read([C4 + 4, C4 + 12]).name).toBe('Minor sixth')
  })

  it('the upper note of a dyad is named as the interval it makes', () => {
    expect(read([C4, C4 + 3]).spelled).toEqual(['C', 'E♭'])
    expect(read([C4, C4 + 10]).spelled).toEqual(['C', 'B♭'])
    expect(read([C4, C4 + 10]).intervals).toEqual(['R', '♭7'])
  })

  it('a wide dyad is open', () => {
    expect(read([C3, C4 + 4]).voicing).toBe('Open')
  })
})

describe('readChord: triads', () => {
  it('major in root position', () => {
    const r = read([C4, C4 + 4, C4 + 7])
    expect(r.symbol).toBe('C')
    expect(r.name).toBe('Major')
    expect(r.position).toBe('Root position')
    expect(r.voicing).toBe('Close')
    expect(r.root).toBe('C')
    expect(r.intervals).toEqual(['R', '3', '5'])
    expect(r.spelled).toEqual(['C', 'E', 'G'])
    expect(r.count).toBe(3)
    expect(r.bass).toBeNull()
  })

  // tonal ranks "Em#5" first here; the major triad must win.
  it('major in 1st inversion reads C/E, not Em#5', () => {
    const r = read([C4 + 4, C4 + 7, C4 + 12])
    expect(r.symbol).toBe('C/E')
    expect(r.position).toBe('1st Inversion (/E)')
    expect(r.intervals).toEqual(['3', '5', 'R'])
    expect(r.alternatives).toContain('Em♯5')
  })

  it('major in 2nd inversion', () => {
    const r = read([C4 + 7, C4 + 12, C4 + 16])
    expect(r.symbol).toBe('C/G')
    expect(r.position).toBe('2nd Inversion (/G)')
  })

  it('minor in all inversions', () => {
    const a3 = 57
    expect(read([a3, a3 + 3, a3 + 7]).symbol).toBe('Am')
    expect(read([a3, a3 + 3, a3 + 7]).name).toBe('Minor')
    expect(read([a3 + 3, a3 + 7, a3 + 12]).symbol).toBe('Am/C')
    expect(read([a3 + 3, a3 + 7, a3 + 12]).position).toBe('1st Inversion (/C)')
    expect(read([a3 + 7, a3 + 12, a3 + 15]).symbol).toBe('Am/E')
    expect(read([a3 + 7, a3 + 12, a3 + 15]).position).toBe('2nd Inversion (/E)')
  })

  it('diminished and augmented', () => {
    const dim = read([C4 + 11, C4 + 14, C4 + 17])
    expect(dim.symbol).toBe('Bdim')
    expect(dim.name).toBe('Diminished')
    expect(dim.intervals).toEqual(['R', '♭3', '♭5'])
    const aug = read([C4, C4 + 4, C4 + 8])
    expect(aug.symbol).toBe('Caug')
    expect(aug.name).toBe('Augmented')
    expect(aug.intervals).toEqual(['R', '3', '♯5'])
  })

  it('sus2 and sus4', () => {
    const sus2 = read([C4, C4 + 2, C4 + 7])
    expect(sus2.symbol).toBe('Csus2')
    expect(sus2.intervals).toEqual(['R', '2', '5'])
    const sus4 = read([C4, C4 + 5, C4 + 7])
    expect(sus4.symbol).toBe('Csus4')
    expect(sus4.name).toBe('Suspended fourth')
    expect(sus4.intervals).toEqual(['R', '4', '5'])
  })

  it('a shell (root, 3, 7) reads as the seventh chord', () => {
    expect(read([C3, C3 + 4, C3 + 10]).symbol).toBe('C7')
  })
})

describe('readChord: seventh chords', () => {
  it('dominant seventh in all inversions', () => {
    const r = read([C4, C4 + 4, C4 + 7, C4 + 10])
    expect(r.symbol).toBe('C7')
    expect(r.name).toBe('Dominant seventh')
    expect(r.intervals).toEqual(['R', '3', '5', '♭7'])

    expect(read([C4 + 4, C4 + 7, C4 + 10, C4 + 12]).position).toBe('1st Inversion (/E)')
    expect(read([C4 + 4, C4 + 7, C4 + 10, C4 + 12]).symbol).toBe('C7/E')
    expect(read([C4 + 7, C4 + 10, C4 + 12, C4 + 16]).symbol).toBe('C7/G')
    const third = read([C4 + 10, C4 + 12, C4 + 16, C4 + 19])
    expect(third.symbol).toBe('C7/B♭')
    expect(third.position).toBe('3rd Inversion (/B♭)')
  })

  it('major seventh in all inversions', () => {
    const r = read([C4, C4 + 4, C4 + 7, C4 + 11])
    expect(r.symbol).toBe('Cmaj7')
    expect(r.name).toBe('Major seventh')
    expect(read([C4 + 4, C4 + 7, C4 + 11, C4 + 12]).symbol).toBe('Cmaj7/E')
    expect(read([C4 + 7, C4 + 11, C4 + 12, C4 + 16]).symbol).toBe('Cmaj7/G')
    expect(read([C4 + 11, C4 + 12, C4 + 16, C4 + 19]).symbol).toBe('Cmaj7/B')
    expect(read([C4 + 11, C4 + 12, C4 + 16, C4 + 19]).position).toBe('3rd Inversion (/B)')
  })

  it('minor seventh vs sixth: the bass decides', () => {
    const a3 = 57
    const am7 = read([a3, a3 + 3, a3 + 7, a3 + 10]) // A C E G
    expect(am7.symbol).toBe('Am7')
    expect(am7.name).toBe('Minor seventh')
    expect(am7.alternatives).toContain('C6/A')

    const c6 = read([C4, C4 + 4, C4 + 7, C4 + 9]) // C E G A
    expect(c6.symbol).toBe('C6')
    expect(c6.name).toBe('Sixth')
    expect(c6.intervals).toEqual(['R', '3', '5', '6'])
    expect(c6.alternatives).toContain('Am7/C')
  })

  it('minor seventh in its upper inversions', () => {
    expect(read([C4 + 7, C4 + 10, C4 + 12, C4 + 15]).symbol).toBe('Cm7/G')
    expect(read([C4 + 10, C4 + 12, C4 + 15, C4 + 19]).symbol).toBe('Cm7/B♭')
  })

  it('half-diminished', () => {
    const b3 = 59
    const r = read([b3, b3 + 3, b3 + 6, b3 + 10]) // B D F A
    expect(r.symbol).toBe('Bm7♭5')
    expect(r.name).toBe('Half-diminished')
    expect(r.intervals).toEqual(['R', '♭3', '♭5', '♭7'])
    expect(read([b3 + 6, b3 + 10, b3 + 12, b3 + 15]).symbol).toBe('Bm7♭5/F')
    expect(read([b3 + 10, b3 + 12, b3 + 15, b3 + 18]).symbol).toBe('Bm7♭5/A')
  })

  // Same logic as C6 vs Am7/C: with the third in the bass the notes are a
  // minor sixth chord in root position, and that reading wins.
  it('half-diminished with the third in the bass reads as the minor sixth', () => {
    const r = read([62, 65, 69, 71]) // D F A B
    expect(r.symbol).toBe('Dm6')
    expect(r.alternatives).toContain('Bm7♭5/D')
  })

  it('diminished seventh is spelled with a double-flat seventh', () => {
    const r = read([59, 62, 65, 68]) // B D F Ab
    expect(r.symbol).toBe('Bdim7')
    expect(r.name).toBe('Diminished seventh')
    expect(r.spelled).toEqual(['B', 'D', 'F', 'A♭'])
    expect(r.intervals).toEqual(['R', '♭3', '♭5', '♭♭7'])
    expect(r.position).toBe('Root position')
  })
})

describe('readChord: extensions', () => {
  it('add9 in root position and with the third in the bass', () => {
    const r = read([C4, C4 + 2, C4 + 4, C4 + 7])
    expect(r.symbol).toBe('Cadd9')
    expect(r.name).toBe('Added ninth')
    expect(r.intervals).toEqual(['R', '9', '3', '5'])
    const inv = read([C4 + 4, C4 + 7, C4 + 12, C4 + 14]) // E G C D
    expect(inv.symbol).toBe('Cadd9/E')
    expect(inv.position).toBe('1st Inversion (/E)')
  })

  it('dominant ninth', () => {
    const r = read([C3, C3 + 4, C3 + 7, C3 + 10, C3 + 14])
    expect(r.symbol).toBe('C9')
    expect(r.intervals).toEqual(['R', '3', '5', '♭7', '9'])
  })

  it('altered dominant uses compound labels', () => {
    const r = read([C3, C3 + 4, C3 + 10, C3 + 15]) // C E Bb D#
    expect(r.symbol).toBe('C7♯9')
    expect(r.intervals).toEqual(['R', '3', '♭7', '♯9'])
  })

  it('offers at most three alternatives', () => {
    const r = read([C3, C3 + 3, C3 + 7, C3 + 10, C3 + 14, C3 + 17]) // Cm11
    expect(r.symbol).toBe('Cm11')
    expect(r.alternatives.length).toBeLessThanOrEqual(3)
    expect(r.alternatives).not.toContain(r.symbol)
  })

  it('a cluster tonal cannot name is shown as unrecognized', () => {
    const r = read([C4, C4 + 1, C4 + 2, C4 + 3])
    expect(r.symbol).toBe('?')
    expect(r.name).toBe('Unrecognized')
    expect(r.root).toBe('C')
    expect(r.count).toBe(4)
  })
})

describe('readChord: melody over a voicing', () => {
  const CMAJ7 = [C4, C4 + 4, C4 + 7, C4 + 11]

  it('an exotic note on top stays a tension over the chord underneath', () => {
    const r = read([...CMAJ7, C4 + 13]) // D♭5 over Cmaj7
    expect(r.kind).toBe('chord')
    expect(r.symbol).toBe('Cmaj7')
    expect(r.extras).toEqual(['♭9'])
    expect(r.intervals).toContain('♭9')
    expect(r.spelled).toEqual(['C', 'E', 'G', 'B', 'D♭'])
    expect(r.count).toBe(5)
  })

  it('a passing note in the middle does not rename the chord either', () => {
    expect(read([C4, C4 + 1, C4 + 4, C4 + 7, C4 + 11]).symbol).toBe('Cmaj7')
    expect(read([C4, C4 + 4, C4 + 5, C4 + 7, C4 + 11]).symbol).toBe('Cmaj7')
    expect(read([C4, C4 + 4, C4 + 5, C4 + 7, C4 + 11]).extras).toEqual(['11'])
  })

  it('a note that makes a real chord is part of it', () => {
    const r = read([...CMAJ7, C4 + 14]) // D5 → Cmaj9
    expect(r.symbol).toBe('Cmaj9')
    expect(r.extras).toEqual([])
    expect(read([...CMAJ7, C4 + 18]).symbol).toBe('Cmaj7♯11')
  })

  it('two melody notes on top are both set aside', () => {
    const r = read([...CMAJ7, C4 + 13, C4 + 15])
    expect(r.symbol).toBe('Cmaj7')
    expect(r.extras).toEqual(['♭9', '♯9'])
  })

  it('a doubled note in the melody changes nothing', () => {
    expect(read([...CMAJ7, C4 + 16]).symbol).toBe('Cmaj7')
  })

  it('works over a minor voicing and a dominant one', () => {
    // D–7 (D F A C) with a G♯ on top: the ♯11 is set aside.
    expect(read([50, 53, 57, 60, 68]).symbol).toBe('Dm7')
    // G7 shell with an A♭ on top reads as G7♭9, which is a chord in its own right.
    expect(read([43, 53, 59, 68]).symbol).toBe('G7♭9')
  })

  it('kinds: note, interval, power chord, cluster', () => {
    expect(read([C4]).kind).toBe('note')
    expect(read([C4, C4 + 4]).kind).toBe('interval')
    expect(read([C4, C4 + 7]).kind).toBe('chord')
    expect(read([C4, C4 + 1, C4 + 2, C4 + 3]).kind).toBe('cluster')
  })

  it('the slash bass reading sets the melody aside too', () => {
    const r = read([40, ...CMAJ7, C4 + 13], 'C', 'slash', 47) // E2 under Cmaj7 + D♭
    expect(r.symbol).toBe('Cmaj7/E')
  })
})

describe('readChord: spelling for the key', () => {
  it('in Eb, D#-F#-A# reads Ebm', () => {
    const r = read([63, 66, 70], 'Eb')
    expect(r.symbol).toBe('E♭m')
    expect(r.root).toBe('E♭')
    expect(r.spelled).toEqual(['E♭', 'G♭', 'B♭'])
  })

  it('in C, a minor third is a flat, not a sharp', () => {
    expect(read([C4, C4 + 3, C4 + 7]).spelled).toEqual(['C', 'E♭', 'G'])
  })

  it('in C, the chord on pitch class 3 is Eb, not D# (no double sharps)', () => {
    const r = read([63, 67, 70])
    expect(r.symbol).toBe('E♭')
    expect(r.spelled).toEqual(['E♭', 'G', 'B♭'])
  })

  it('sharp keys keep sharps', () => {
    const r = read([66, 70, 73], 'F#')
    expect(r.symbol).toBe('F♯')
    expect(r.spelled).toEqual(['F♯', 'A♯', 'C♯'])
  })

  it('Cb major spells its tonic triad with flats', () => {
    const r = read([71, 75, 78], 'Cb')
    expect(r.symbol).toBe('C♭')
    expect(r.spelled).toEqual(['C♭', 'E♭', 'G♭'])
  })

  it('glyphs reach the chord symbol suffix too', () => {
    const r = read([70, 73, 76, 80], 'Bb') // Bb Db Fb Ab
    expect(r.symbol).toBe('B♭m7♭5')
    expect(r.spelled).toEqual(['B♭', 'D♭', 'F♭', 'A♭'])
  })

  it('the slash bass is spelled as the chord tone it is', () => {
    expect(read([C4 + 10, C4 + 12, C4 + 16, C4 + 19], 'G').symbol).toBe('C7/B♭')
  })
})

describe('readChord: voicing', () => {
  it('close when it fits in an octave, doubled root included', () => {
    expect(read([C4, C4 + 4, C4 + 7, C4 + 12]).voicing).toBe('Close')
  })

  it('drop 2', () => {
    const r = read([C4 - 5, C4, C4 + 4, C4 + 11]) // G3 C4 E4 B4 from C E G B
    expect(r.symbol).toBe('Cmaj7/G')
    expect(r.voicing).toBe('Drop 2')
  })

  it('drop 3', () => {
    const r = read([C4 - 8, C4, C4 + 7, C4 + 11]) // E3 C4 G4 B4 from C E G B
    expect(r.symbol).toBe('Cmaj7/E')
    expect(r.voicing).toBe('Drop 3')
  })

  it('open otherwise', () => {
    expect(read([C3, C3 + 7, C4 + 4]).voicing).toBe('Open')
  })
})

describe('readChord: bass split', () => {
  it('slash: the chord above is written over the bass', () => {
    const r = read([38, C4 + 4, C4 + 7, C4 + 12], 'C', 'slash') // D2 / E G C
    expect(r.symbol).toBe('C/D')
    expect(r.position).toBe('Slash bass (/D)')
    expect(r.name).toBe('Major')
    expect(r.voicing).toBe('Close')
    expect(r.count).toBe(4)
    expect(r.bass).toBeNull()
    expect(r.spelled).toEqual(['D', 'E', 'G', 'C'])
    expect(r.intervals).toEqual(['2', '3', '5', 'R'])
  })

  it('slash: a bass on the root adds no slash', () => {
    const r = read([36, C4, C4 + 4, C4 + 7], 'C', 'slash')
    expect(r.symbol).toBe('C')
    expect(r.position).toBe('Root position')
    expect(r.voicing).toBe('Close') // the hand above, not the whole spread
  })

  it('slash: a bass on a chord tone is an inversion', () => {
    const r = read([40, C4, C4 + 4, C4 + 7], 'C', 'slash')
    expect(r.symbol).toBe('C/E')
    expect(r.position).toBe('1st Inversion (/E)')
  })

  it('slash: the upper chord is named on its own', () => {
    const r = read([41, 57, 60, 64, 67], 'C', 'slash') // F2 / A C E G
    expect(r.symbol).toBe('Am7/F')
    expect(r.position).toBe('Slash bass (/F)')
  })

  it('slash: nothing under the split behaves like off', () => {
    const notes = [C4 + 4, C4 + 7, C4 + 12]
    expect(read(notes, 'C', 'slash')).toEqual(read(notes))
  })

  it('slash: two notes above the bass are read together with it', () => {
    expect(read([36, C4 + 4, C4 + 7], 'C', 'slash').symbol).toBe('C')
  })

  it('apart: the bass is left out of the chord', () => {
    const r = read([36, C4 + 4, C4 + 7, C4 + 11], 'C', 'apart') // C2 / E G B
    expect(r.symbol).toBe('Em')
    expect(r.bass).toBe('C')
    expect(r.count).toBe(4)
    expect(r.spelled).toEqual(['E', 'G', 'B'])
    expect(r.intervals).toEqual(['R', '♭3', '5'])
    expect(r.position).toBe('Root position')
  })

  it('apart: the lowest of several bass notes is the one reported', () => {
    const r = read([36, 43, C4, C4 + 4, C4 + 7], 'C', 'apart')
    expect(r.bass).toBe('C')
    expect(r.symbol).toBe('C')
    expect(r.count).toBe(5)
  })

  it('apart: the bass is spelled as a tone of the chord above', () => {
    expect(read([39, C4, C4 + 3, C4 + 7], 'C', 'apart').bass).toBe('E♭')
  })

  it('apart: nothing under the split leaves no bass', () => {
    const r = read([C4, C4 + 4, C4 + 7], 'C', 'apart')
    expect(r.bass).toBeNull()
    expect(r.symbol).toBe('C')
  })

  it('apart: everything under the split is read as the chord', () => {
    const r = read([C3 - 12, C3 - 8, C3 - 5], 'C', 'apart')
    expect(r.symbol).toBe('C')
    expect(r.bass).toBeNull()
  })
})

describe('readChord: input handling', () => {
  it('ignores order and repeated notes', () => {
    const a = read([C4 + 7, C4, C4 + 4])
    const b = read([C4, C4 + 4, C4 + 4, C4 + 7])
    expect(a).toEqual(b)
  })
})

describe('chordNames', () => {
  const opts = { key: keyById('C'), split: 'off' as BassSplit, splitPoint: 47 }

  it('spells a Cm7 in C with flats', () => {
    const names = chordNames([60, 63, 67, 70], opts)
    expect(spellMidi(63, opts.key, names)).toBe('Eb4')
    expect(vexKey(70, opts.key, names)).toBe('bb/4')
  })

  it('a melody note over the voicing is spelled as its tension', () => {
    expect(spellMidi(73, opts.key, chordNames([60, 64, 67, 71, 73], opts))).toBe('Db5')
  })

  it('a lone note is left to the key', () => {
    expect(chordNames([61], opts).size).toBe(0)
    expect(spellMidi(61, opts.key, chordNames([61], opts))).toBe('C#4')
  })
})
