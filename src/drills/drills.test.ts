import { describe, expect, it } from 'vitest'
import { draw, requeue, shuffle } from './deck'
import { INTERVALS, intervalItems, intervalQuestion } from './intervals'
import { CHORDS, chordItems, chordMarks, chordQuestion, isRootPosition, rootPositionNear } from './sevenths'
import { GOAL_MS, itemId, levelOf, recordAnswer, splitItem, summarise } from './speed'
import { glyph, nearestWithPc, noteAbove } from './spell'
import {
  CHORDS_PER_LAP,
  FORMS,
  FORM_BY_ID,
  KEY_CHAIN,
  NEW_LAP,
  advance,
  chordSymbols,
  keyName,
  spoil,
  supports,
  targetNotes,
  twoRootMidi,
  type Lap,
  type Tonality,
} from './twoFiveOne'

const pcs = (notes: number[]) => [...new Set(notes.map((n) => n % 12))].sort((a, b) => a - b)

describe('spelling', () => {
  it('spells an interval the way it is counted', () => {
    expect(noteAbove('F#', '7m')).toBe('E')
    expect(noteAbove('Db', '5P')).toBe('Ab')
    expect(noteAbove('C', '3m')).toBe('Eb')
    expect(noteAbove('E', '3M')).toBe('G#')
  })

  it('falls back to the plain key for spellings nobody reads', () => {
    expect(noteAbove('Db', '5d')).toBe('G') // Abb
    expect(noteAbove('Db', '7m')).toBe('B') // Cb
    expect(noteAbove('Ab', '6m')).toBe('E') // Fb
    expect(noteAbove('C', '7d')).toBe('A') // Bbb
  })

  it('turns ASCII accidentals into glyphs', () => {
    expect(glyph('Bb')).toBe('B♭')
    expect(glyph('F#')).toBe('F♯')
    expect(glyph('B')).toBe('B')
  })

  it('finds the closest key of a pitch class, a tritone going up', () => {
    expect(nearestWithPc(0, 61)).toBe(60)
    expect(nearestWithPc(11, 60)).toBe(59)
    expect(nearestWithPc(6, 60)).toBe(66)
    expect(nearestWithPc(4, 64)).toBe(64)
  })
})

describe('deck', () => {
  it('shuffles without losing or inventing items', () => {
    const items = ['a', 'b', 'c', 'd', 'e']
    expect([...shuffle(items)].sort()).toEqual(items)
  })

  it('asks every item once before any repeats', () => {
    const all = ['a', 'b', 'c', 'd']
    let queue: string[] = []
    let last: string | null = null
    const seen: string[] = []
    for (let i = 0; i < 4; i++) {
      const d: { item: string; queue: string[] } = draw(queue, all, last)
      queue = d.queue
      last = d.item
      seen.push(d.item)
    }
    expect([...seen].sort()).toEqual(all)
  })

  it('never asks the same item twice in a row across a refill', () => {
    const all = ['a', 'b', 'c']
    // rand = 0 makes every shuffle the same order, so a naive refill would repeat.
    const first = shuffle(all, () => 0)[0]
    const d = draw([], all, first, () => 0)
    expect(d.item).not.toBe(first)
    expect([d.item, ...d.queue].sort()).toEqual(all)
  })

  it('repeats the only item there is', () => {
    expect(draw([], ['a'], 'a').item).toBe('a')
  })

  it('drops queued items that were switched off', () => {
    const d = draw(['x', 'b', 'a'], ['a', 'b'], null)
    expect(d.item).toBe('b')
    expect(d.queue).toEqual(['a'])
  })

  it('brings a missed item back a few questions later, once', () => {
    expect(requeue(['a', 'b', 'c', 'd'], 'x', 2)).toEqual(['a', 'b', 'x', 'c', 'd'])
    expect(requeue(['a'], 'x', 3)).toEqual(['a', 'x'])
    expect(requeue(['a', 'b', 'x', 'c'], 'x', 1)).toEqual(['a', 'x', 'b', 'c'])
  })
})

describe('speed stats', () => {
  it('round-trips an item id, even when the row has a colon-free symbol', () => {
    expect(splitItem(itemId('7#5', 11))).toEqual({ row: '7#5', pc: 11 })
  })

  it('reads the level from the last answer only', () => {
    expect(levelOf(undefined)).toBe('new')
    let s = recordAnswer({}, 'a', true, 1500)
    expect(levelOf(s.a)).toBe('fast')
    s = recordAnswer(s, 'a', true, GOAL_MS + 1)
    expect(levelOf(s.a)).toBe('slow')
    s = recordAnswer(s, 'a', false, 900)
    expect(levelOf(s.a)).toBe('miss')
    expect(s.a).toMatchObject({ attempts: 3, correct: 2, bestMs: 1500 })
  })

  it('does not mutate the stats it is given', () => {
    const before = recordAnswer({}, 'a', true, 1000)
    const copy = structuredClone(before)
    recordAnswer(before, 'a', false, 500)
    expect(before).toEqual(copy)
  })

  it('scores only the items switched on', () => {
    let s = recordAnswer({}, 'a', true, 1000)
    s = recordAnswer(s, 'b', true, 3000)
    s = recordAnswer(s, 'off', true, 500)
    expect(summarise(s, ['a', 'b', 'c'])).toEqual({ fast: 1, total: 3, attempts: 2, correct: 2, avgMs: 2000 })
  })
})

describe('intervals', () => {
  it('asks each interval from all 12 notes', () => {
    expect(intervalItems(INTERVALS.map((i) => i.id))).toHaveLength(11 * 12)
    expect(intervalItems(['P5'])).toHaveLength(12)
  })

  it('answers the questions from the lesson', () => {
    // a fifth above D flat, a tritone above E, a minor 7th above F sharp
    expect(intervalQuestion(itemId('P5', 1))).toMatchObject({ answerPc: 8, answerName: 'Ab' })
    expect(intervalQuestion(itemId('TT', 4))).toMatchObject({ answerPc: 10, answerName: 'Bb' })
    expect(intervalQuestion(itemId('m7', 6))).toMatchObject({ answerPc: 4, answerName: 'E' })
  })

  it('names every answer with the pitch class it asks for', () => {
    const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
    for (const id of intervalItems(INTERVALS.map((i) => i.id))) {
      const q = intervalQuestion(id)
      const acc = q.answerName.slice(1)
      const pc = (PC[q.answerName[0]] + (acc.match(/#/g)?.length ?? 0) - (acc.match(/b/g)?.length ?? 0) + 12) % 12
      expect(pc, id).toBe(q.answerPc)
      expect(q.answerName, id).toMatch(/^[A-G][#b]?$/)
    }
  })
})

describe('seventh chords', () => {
  const chord = (id: string) => CHORDS.find((c) => c.id === id)!

  it('starts with the three chords most songs are built of: 36 questions', () => {
    const core = CHORDS.filter((c) => c.core).map((c) => c.id)
    expect(core).toEqual(['maj7', 'm7', '7'])
    expect(chordItems(core)).toHaveLength(36)
  })

  it('writes the symbol and spells the chord', () => {
    expect(chordQuestion(itemId('m7', 6))).toMatchObject({ symbol: 'F♯m7', spelled: ['F♯', 'A', 'C♯', 'E'] })
    expect(chordQuestion(itemId('maj7', 10))).toMatchObject({ symbol: 'B♭maj7', spelled: ['B♭', 'D', 'F', 'A'] })
    expect(chordQuestion(itemId('dim7', 0)).spelled).toEqual(['C', 'E♭', 'G♭', 'A'])
  })

  it('accepts root position in any octave, with doubling', () => {
    expect(isRootPosition([48, 52, 55, 59], 0, chord('maj7'))).toBe(true)
    expect(isRootPosition([72, 76, 79, 83], 0, chord('maj7'))).toBe(true)
    expect(isRootPosition([36, 48, 52, 55, 59], 0, chord('maj7'))).toBe(true)
    // root in the left hand, the rest spread in the right
    expect(isRootPosition([36, 59, 64, 67], 0, chord('maj7'))).toBe(true)
  })

  it('rejects an inversion, a missing note, an extra note and the wrong quality', () => {
    expect(isRootPosition([52, 55, 59, 60], 0, chord('maj7'))).toBe(false)
    expect(isRootPosition([48, 52, 55], 0, chord('maj7'))).toBe(false)
    expect(isRootPosition([48, 50, 52, 55, 59], 0, chord('maj7'))).toBe(false)
    expect(isRootPosition([48, 52, 55, 58], 0, chord('maj7'))).toBe(false)
    expect(isRootPosition([], 0, chord('maj7'))).toBe(false)
  })

  it('tells a diminished seventh from its own inversions by the bass', () => {
    const cDim = [48, 51, 54, 57]
    expect(isRootPosition(cDim, 0, chord('dim7'))).toBe(true)
    expect(isRootPosition(cDim, 3, chord('dim7'))).toBe(false)
  })

  it('every chord type is four different notes', () => {
    for (const c of CHORDS) expect(pcs(rootPositionNear(0, c, 60)), c.id).toHaveLength(4)
  })

  it('colours held keys and, once revealed, the notes still missing nearby', () => {
    // C E played, plus a wrong D; G and B still to come.
    const marks = chordMarks([60, 62, 64], 0, chord('maj7'), true)
    expect(marks.get(60)).toBe('correct')
    expect(marks.get(64)).toBe('correct')
    expect(marks.get(62)).toBe('extra')
    expect(marks.get(67)).toBe('missing')
    expect(marks.get(71)).toBe('missing')
    expect(chordMarks([60, 62, 64], 0, chord('maj7'), false).has(67)).toBe(false)
  })
})

describe('2-5-1', () => {
  const form = (id: string) => FORM_BY_ID.get(id)!
  const QUALITY: Record<Tonality, number[][]> = {
    major: [
      [0, 3, 7, 10], // m7
      [0, 4, 7, 10], // 7
      [0, 4, 7, 11], // maj7
    ],
    minor: [
      [0, 3, 6, 10], // ø
      [0, 4, 7, 10], // 7
      [0, 3, 7, 10], // m7
    ],
  }
  // Degrees a shape may add on top of the chord tones: 9 everywhere, 13 on the five.
  const EXTRA = [[2], [2, 9], [2]]

  it('walks the keys the way the lesson does: the one becomes the next two', () => {
    expect(KEY_CHAIN).toEqual([0, 10, 8, 6, 4, 2, 11, 9, 7, 5, 3, 1])
    expect([...KEY_CHAIN].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    for (const i of [0, 1, 2, 3, 4, 6, 7, 8, 9, 10]) {
      // next key's two chord is built on this key's tonic
      expect((KEY_CHAIN[i + 1] + 2) % 12).toBe(KEY_CHAIN[i])
    }
    // after six keys the walk is back on C, so the two starts a half step up
    expect((KEY_CHAIN[6] + 2) % 12).toBe(1)
    expect(CHORDS_PER_LAP).toBe(36)
  })

  it('plays the close position the lesson shows in C', () => {
    const f = form('close')
    expect(targetNotes(f, 'major', 0, 0)).toEqual([62, 65, 69, 72]) // D F A C
    expect(targetNotes(f, 'major', 0, 1)).toEqual([62, 65, 67, 71]) // D F G B
    expect(targetNotes(f, 'major', 0, 2)).toEqual([60, 64, 67, 71]) // C E G B
  })

  it('moves one note into the five on the rootless shapes', () => {
    for (const id of ['rootless-a', 'rootless-b']) {
      const two = targetNotes(form(id), 'major', 0, 0)
      const five = targetNotes(form(id), 'major', 0, 1)
      const moved = two.slice(1).filter((n) => !five.includes(n))
      expect(moved, id).toHaveLength(1)
      expect(five, id).toContain(moved[0] - 1)
    }
  })

  it('every shape, in every key, plays the right chord over the right root', () => {
    for (const f of FORMS) {
      for (const tonality of ['major', 'minor'] as Tonality[]) {
        if (!supports(f, tonality)) continue
        for (const tonic of KEY_CHAIN) {
          const roots = [(tonic + 2) % 12, (tonic + 7) % 12, tonic]
          for (let step = 0; step < 3; step++) {
            const notes = targetNotes(f, tonality, tonic, step)
            const where = `${f.id} ${tonality} ${tonic} #${step}`
            const rel = pcs(notes.map((n) => n - roots[step] + 120))
            const allowed = [...QUALITY[tonality][step], ...EXTRA[step]]
            for (const d of rel) expect(allowed, where).toContain(d)
            // third and seventh are always there: they are what names the chord
            expect(rel, where).toContain(QUALITY[tonality][step][1])
            expect(rel, where).toContain(QUALITY[tonality][step][3])
            // lowest note is the root, except on the close position's inverted five
            if (!(f.id === 'close' && step === 1)) expect(notes[0] % 12, where).toBe(roots[step])
            expect(new Set(notes).size, where).toBe(notes.length)
          }
        }
      }
    }
  })

  it('keeps the two chord root inside one octave from the shape\'s lowest root', () => {
    for (const f of FORMS) {
      for (const tonic of KEY_CHAIN) {
        const r = twoRootMidi(f, tonic)
        expect(r).toBeGreaterThanOrEqual(f.lowestRoot)
        expect(r).toBeLessThan(f.lowestRoot + 12)
        expect(r % 12).toBe((tonic + 2) % 12)
      }
    }
  })

  it('offers a minor version only where the lesson gives one', () => {
    expect(FORMS.filter((f) => supports(f, 'minor')).map((f) => f.id)).toEqual(['close', 'shells-37', 'shells-73'])
    expect(supports(FORMS[0], 'minor')).toBe(true) // the fallback shape
  })

  it('names the chords in each key\'s own spelling', () => {
    expect(chordSymbols('major', 0)).toEqual(['Dm7', 'G7', 'Cmaj7'])
    expect(chordSymbols('major', 8)).toEqual(['B♭m7', 'E♭7', 'A♭maj7'])
    expect(chordSymbols('major', 4)).toEqual(['F♯m7', 'B7', 'Emaj7'])
    expect(chordSymbols('major', 6)).toEqual(['A♭m7', 'D♭7', 'G♭maj7'])
    expect(chordSymbols('minor', 0)).toEqual(['Dø', 'G7', 'Cm7'])
    expect(chordSymbols('minor', 6)).toEqual(['G♯ø', 'C♯7', 'F♯m7'])
    expect(keyName('major', 10)).toBe('B♭ major')
    expect(keyName('minor', 1)).toBe('C♯ minor')
  })

  describe('laps', () => {
    const run = (lap: Lap, n: number) => {
      for (let i = 0; i < n; i++) lap = advance(lap)
      return lap
    }

    it('counts a lap of 36 clean chords', () => {
      expect(run(NEW_LAP, 35)).toEqual({ pos: 35, dirty: false, streak: 0 })
      expect(run(NEW_LAP, 36)).toEqual({ pos: 0, dirty: false, streak: 1 })
      expect(run(NEW_LAP, 108).streak).toBe(3)
    })

    it('a spoiled lap resets the streak when it closes, and the next starts clean', () => {
      const twoClean = run(NEW_LAP, 72)
      const spoiled = spoil(run(twoClean, 10))
      expect(spoiled).toEqual({ pos: 10, dirty: true, streak: 2 })
      expect(run(spoiled, 26)).toEqual({ pos: 0, dirty: false, streak: 0 })
    })
  })
})
