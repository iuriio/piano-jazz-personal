import { describe, expect, it } from 'vitest'
import { chartComplexity, planPhrase, renderChart, renderPhrase } from '../accompany/progression'
import {
  CHARTS,
  CHART_BY_ID,
  NEW_FLOW,
  NEW_MOTIF,
  compareMotif,
  flowStep,
  guideLines,
  guideTones,
  judgeLanding,
  motifOf,
  motifStep,
  movedInBar,
  placeAt,
  soloLine,
  splitPhrases,
  stopAfterMs,
  toneOf,
  type MotifNote,
  type Span,
  type Struck,
} from './improv'

const BEAT = 500 // 120 bpm

/** Notes of `len` ms, one every `every` ms from `from`. */
const run = (midis: number[], from = 0, every = 250, len = 200): Struck[] =>
  midis.map((midi, i) => ({ midi, on: from + i * every, off: from + i * every + len }))

/** A phrase as the comparison reads it: pitches, one every `every` beats (or at the given beats). */
const motif = (midis: number[], beats?: number[], every = 0.5): MotifNote[] =>
  midis.map((midi, i) => ({ midi, beat: beats ? beats[i] : i * every }))

const symbols = (bars: { symbol: string }[][]) => bars.map((bar) => bar.map((c) => c.symbol))

describe('the changes', () => {
  it('writes a 2-5-1 in the key it is played in', () => {
    const [line] = renderChart(CHART_BY_ID.get('major')!, 0, 2)
    expect(symbols(line)).toEqual([['Dm7'], ['G7'], ['Cmaj7'], ['Cmaj7']])
    const [flat] = renderChart(CHART_BY_ID.get('major')!, 10, 2)
    expect(symbols(flat)).toEqual([['Cm7'], ['F7'], ['Bbmaj7'], ['Bbmaj7']])
  })

  it('puts the minor 2-5-1 in the minor key of the same name', () => {
    const [line] = renderChart(CHART_BY_ID.get('minor')!, 0, 2)
    expect(symbols(line)).toEqual([['Dm7b5'], ['G7'], ['Cm7'], ['Cm7']])
  })

  it('walks the 2-5-1 through all 12 keys, the one becoming the next two', () => {
    const lines = renderChart(CHART_BY_ID.get('keys')!, 0, 2)
    expect(lines).toHaveLength(12)
    expect(new Set(lines.map((l) => l[2][0].root)).size).toBe(12)
    // C major, then B♭: Cmaj7 turns into Cm7.
    expect(symbols(lines[1])).toEqual([['Cm7'], ['F7'], ['Bbmaj7'], ['Bbmaj7']])
    for (let i = 0; i < 5; i++) expect(lines[i + 1][0][0].root).toBe(lines[i][2][0].root)
  })

  it('plays two chords a bar where the chart writes two', () => {
    const [line] = renderChart(CHART_BY_ID.get('turnaround')!, 0, 2)
    expect(symbols(line)).toEqual([['Cmaj7', 'Am7'], ['Dm7', 'G7'], ['Em7', 'A7'], ['Dm7', 'G7']])
    expect(line.flat().every((c) => c.beats === 2)).toBe(true)
  })

  it('gives a dominant its ♭9 only when the chord right after it is minor', () => {
    const [, , last] = renderChart(CHART_BY_ID.get('blues')!, 0, 3)
    // I7 goes to VI7, which goes to the two: only the second resolves to a minor chord.
    expect(symbols(last)[2]).toEqual(['C9', 'A7b9'])
  })

  it('keeps every chart to sevenths or extensions, never triads or substitutions', () => {
    expect([1, 2, 3, 4].map((c) => chartComplexity(c as 1 | 2 | 3 | 4))).toEqual([2, 2, 3, 3])
    for (const chart of CHARTS) {
      for (const line of renderChart(chart, 5, 1)) {
        for (const chord of line.flat()) expect(guideTones(chord.symbol)?.seventh, chord.symbol).toBeTruthy()
      }
    }
  })

  it('repeats a chart chorus after chorus, whatever the seed', () => {
    const chart = CHART_BY_ID.get('fifths')!
    const key = { center: 0, collectionPc: 0, mode: 'major' as const }
    const at = (index: number, seed: number) =>
      symbols(renderPhrase(planPhrase(key, index, { seed, density: 2, beatsPerBar: 4, chart }), 2, seed))
    expect(at(0, 1)).toEqual([['Dm7'], ['G7'], ['Cmaj7'], ['Fmaj7']])
    expect(at(1, 99)).toEqual([['Bm7b5'], ['E7'], ['Am7'], ['Am7']])
    expect(at(2, 7)).toEqual(at(0, 1))
  })
})

describe('guide tones', () => {
  it('finds the third and the seventh, spelled from the root', () => {
    expect(guideTones('Dm7')).toEqual({ third: 'F', seventh: 'C', ninth: 'E' })
    expect(guideTones('F7')).toEqual({ third: 'A', seventh: 'Eb', ninth: 'G' })
    expect(guideTones('Bbmaj9')).toMatchObject({ third: 'D', seventh: 'A' })
    expect(guideTones('Bm7b5')).toMatchObject({ third: 'D', seventh: 'A' })
    expect(guideTones('G13')).toMatchObject({ third: 'B', seventh: 'F' })
  })

  it('says which one a note is', () => {
    expect(toneOf(9, 'F7', 'guide')).toBe('third')
    expect(toneOf(3, 'F7', 'guide')).toBe('seventh')
    expect(toneOf(0, 'F7', 'guide')).toBeNull()
    expect(toneOf(7, 'F7', 'ninth')).toBe('ninth')
    // The natural ninth, even over a chord whose own ninth is flat.
    expect(toneOf(9, 'G7b9', 'ninth')).toBe('ninth')
    expect(toneOf(9, 'F7', 'ninth')).toBeNull()
  })

  it('lays them out as two lines that stay or step down through fifths', () => {
    const lines = guideLines(['Dm7', 'G7', 'Cmaj7', 'Fmaj7', 'Bm7b5', 'E7', 'Am7'])
    expect(lines.map((l) => l[0])).toEqual(['F', 'F', 'E', 'E', 'D', 'D', 'C'])
    expect(lines.map((l) => l[1])).toEqual(['C', 'B', 'B', 'A', 'A', 'G#', 'G'])
  })
})

describe('where the band is', () => {
  const bars: Span[] = [
    { start: 1000, beatMs: BEAT, chords: [{ symbol: 'Dm7', beats: 4 }], next: { symbol: 'G7' } },
    { start: 3000, beatMs: BEAT, chords: [{ symbol: 'G7', beats: 2 }, { symbol: 'Db7', beats: 2 }], next: { symbol: 'Cmaj7' } },
  ]

  it('names the chord under a moment, and the one after it', () => {
    expect(placeAt(bars, 1000)).toMatchObject({ symbol: 'Dm7', next: 'G7', toChange: 4, beatInBar: 0 })
    expect(placeAt(bars, 2750)).toMatchObject({ symbol: 'Dm7', next: 'G7', toChange: 0.5 })
    expect(placeAt(bars, 3100)).toMatchObject({ symbol: 'G7', next: 'Db7' })
    expect(placeAt(bars, 4500)).toMatchObject({ symbol: 'Db7', next: 'Cmaj7', beatInBar: 3 })
  })

  it('knows nothing before the band came in or after it stopped', () => {
    expect(placeAt(bars, 900)).toBeNull()
    expect(placeAt(bars, 5400)).toBeNull()
    expect(placeAt([], 1000)).toBeNull()
  })
})

describe('the solo line', () => {
  it('leaves out the left hand and what came before the run', () => {
    const notes = [...run([48, 52], 0, 0), ...run([72, 74, 76], 100), { midi: 70, on: -500, off: -300 }]
    expect(soloLine(notes, 60, 0).map((n) => n.midi)).toEqual([72, 74, 76])
  })

  it('hears notes struck together as one attack, the top note', () => {
    const line = soloLine([{ midi: 64, on: 0, off: 300 }, { midi: 72, on: 15, off: 400 }, { midi: 67, on: 30, off: 200 }, { midi: 74, on: 250, off: 450 }], 0, 0)
    expect(line).toEqual([{ midi: 72, on: 0, off: 400 }, { midi: 74, on: 250, off: 450 }])
  })
})

describe('phrases', () => {
  it('ends a phrase at a beat of silence', () => {
    const line = [...run([60, 62, 64]), ...run([65, 67, 69], 1500)]
    const phrases = splitPhrases(line, BEAT, 2200)
    expect(phrases.map((p) => p.notes.map((n) => n.midi))).toEqual([[60, 62, 64], [65, 67, 69]])
    expect(phrases.map((p) => p.closed)).toEqual([true, false])
  })

  it('does not break on a rest shorter than a beat', () => {
    const line = [...run([60, 62]), ...run([64, 65], 800)] // 350 ms of silence
    expect(splitPhrases(line, BEAT, 1200)).toHaveLength(1)
  })

  it('closes the last phrase once the pause has passed', () => {
    const line = run([60, 62, 64])
    expect(splitPhrases(line, BEAT, 1100)[0].closed).toBe(false)
    expect(splitPhrases(line, BEAT, 1250)[0].closed).toBe(true)
  })

  it('takes two beats without a new note as a pause while the last one is held', () => {
    const held: Struck[] = [...run([60, 62]), { midi: 64, on: 500, off: Number.NaN }]
    expect(splitPhrases(held, BEAT, 1400)[0].closed).toBe(false)
    expect(splitPhrases(held, BEAT, 1500)[0].closed).toBe(true)
  })
})

describe('never stop', () => {
  const limit = stopAfterMs('eighths', BEAT) // 625 ms

  it('lets a quarter note pass among eighths, and nothing longer', () => {
    expect(limit).toBe(625)
    expect(stopAfterMs('triplets', BEAT)).toBeLessThan(BEAT)
  })

  it('counts the run while you keep playing', () => {
    const onsets = Array.from({ length: 17 }, (_, i) => i * 250)
    const flow = flowStep(NEW_FLOW, onsets, 4100, limit)
    expect(flow).toMatchObject({ start: 0, last: 4000, notes: 17, stops: 0, longest: 4000 })
  })

  it('counts a stop when you go silent, once', () => {
    let flow = flowStep(NEW_FLOW, [0, 250, 500, 750, 1000], 1100, limit)
    flow = flowStep(flow, [], 1700, limit)
    expect(flow).toMatchObject({ start: null, stops: 1, longest: 1000, ended: 1000 })
    flow = flowStep(flow, [], 3000, limit)
    expect(flow.stops).toBe(1)
    // The next note starts a new run without counting the same stop again.
    flow = flowStep(flow, [3200, 3450], 3500, limit)
    expect(flow).toMatchObject({ start: 3200, notes: 2, stops: 1 })
  })

  it('counts a stop found between two notes of one batch', () => {
    const flow = flowStep(NEW_FLOW, [0, 250, 500, 750, 2000, 2250], 2300, limit)
    expect(flow).toMatchObject({ start: 2000, notes: 2, stops: 1, longest: 750 })
  })

  it('does not call a note or two a run that stopped', () => {
    const flow = flowStep(NEW_FLOW, [0, 250], 2000, limit)
    expect(flow).toMatchObject({ start: null, stops: 0, longest: 0, ended: 0 })
  })
})

describe('landing on a guide tone', () => {
  const bars: Span[] = [
    { start: 0, beatMs: BEAT, chords: [{ symbol: 'Dm7', beats: 4 }], next: { symbol: 'G7' } },
    { start: 2000, beatMs: BEAT, chords: [{ symbol: 'G7', beats: 4 }], next: { symbol: 'Cmaj7' } },
  ]

  it('judges the last note against the chord it lands on', () => {
    expect(judgeLanding(run([62, 64, 65], 500), bars, 'guide')).toEqual({ midi: 65, symbol: 'Dm7', tone: 'third', ahead: false })
    expect(judgeLanding(run([62, 64, 67], 500), bars, 'guide')).toMatchObject({ symbol: 'Dm7', tone: null })
    expect(judgeLanding(run([67, 69, 71], 2000), bars, 'guide')).toMatchObject({ symbol: 'G7', tone: 'third' })
  })

  it('takes a note just ahead of the change as landing on the next chord', () => {
    // B on the "and" of four over Dm7: the third of the G7 it is about to be.
    expect(judgeLanding(run([67, 69, 71], 1250), bars, 'guide')).toEqual({ midi: 71, symbol: 'G7', tone: 'third', ahead: true })
    // The same B a beat and a half early is just a wrong landing.
    expect(judgeLanding(run([67, 69, 71], 750), bars, 'guide')).toMatchObject({ symbol: 'Dm7', tone: null })
  })

  it('aims at the ninth when that is the target', () => {
    expect(judgeLanding(run([62, 65, 64], 500), bars, 'ninth')).toMatchObject({ tone: 'ninth' })
    expect(judgeLanding(run([62, 64, 65], 500), bars, 'ninth')).toMatchObject({ tone: null })
  })

  it('has nothing to say when the band was not playing', () => {
    expect(judgeLanding(run([62, 64, 65], 9000), bars, 'guide')).toBeNull()
  })
})

describe('repeat and change', () => {
  const a = motif([60, 62, 64, 67])

  it('hears the same phrase again as the same', () => {
    expect(compareMotif(a, motif([60, 62, 64, 67]))).toEqual({ kind: 'same', changes: [] })
    // A human repeat: a few hundredths of a beat off is still the same rhythm.
    expect(compareMotif(a, motif([60, 62, 64, 67], [0, 0.55, 0.95, 1.6])).kind).toBe('same')
  })

  it('names one changed note', () => {
    expect(compareMotif(a, motif([60, 62, 65, 67]))).toEqual({ kind: 'varied', changes: ['1 note changed'] })
  })

  it('names a transposition', () => {
    expect(compareMotif(a, motif([65, 67, 69, 72])).changes).toEqual(['moved up a 4th'])
    expect(compareMotif(a, motif([48, 50, 52, 55])).changes).toEqual(['moved down an octave'])
  })

  it('names a change of rhythm, of speed, and of place in the bar', () => {
    expect(compareMotif(a, motif([60, 62, 64, 67], [0, 1, 1.5, 2])).changes).toEqual(['rhythm changed'])
    expect(compareMotif(a, motif([60, 62, 64, 67], undefined, 1)).changes).toEqual(['slowed down'])
    expect(compareMotif(motif([60, 62, 64, 67], undefined, 1), a).changes).toEqual(['sped up'])
    expect(compareMotif(a, motif([60, 62, 64, 67]), true)).toEqual({ kind: 'varied', changes: ['starts on another beat'] })
  })

  it('names the phrase backwards, upside down, and moved through the key', () => {
    expect(compareMotif(a, motif([67, 64, 62, 60])).changes).toEqual(['played backwards'])
    expect(compareMotif(a, motif([60, 58, 56, 53])).changes).toEqual(['turned upside down'])
    // D E F A: the same shape a step up, as the key has it.
    expect(compareMotif(a, motif([62, 64, 65, 69])).changes).toEqual(['same shape, higher'])
  })

  it('names two changes when there are two', () => {
    expect(compareMotif(a, motif([65, 67, 69, 72], [0, 1, 1.5, 2])).changes).toEqual(['moved up a 4th', 'rhythm changed'])
  })

  it('names notes added and left out', () => {
    expect(compareMotif(a, motif([60, 62, 63, 64, 67])).changes).toEqual(['1 note added'])
    expect(compareMotif(a, motif([60, 62, 67])).changes).toEqual(['1 note left out'])
    const long = motif([60, 62, 64, 65, 67, 69, 71, 72])
    expect(compareMotif(long, motif([64, 65, 67])).changes).toEqual(['a piece of it'])
    expect(compareMotif(motif([64, 65, 67]), long).changes).toEqual(['carried on further'])
  })

  it('takes other notes on a rhythm with a shape as the phrase again', () => {
    const shaped = [0, 1.5, 2, 2.5]
    expect(compareMotif(motif([60, 62, 64, 67], shaped), motif([71, 65, 70, 61], shaped)).changes).toEqual(['same rhythm, new notes'])
  })

  it('calls another phrase another phrase', () => {
    // Even eighths are not a rhythm to recognise: other notes make it new.
    expect(compareMotif(a, motif([71, 65, 70, 61])).kind).toBe('new')
    expect(compareMotif(a, motif([72, 71, 65, 70, 61, 63, 58])).kind).toBe('new')
  })

  it('reads a played phrase in beats from its first note', () => {
    expect(motifOf(run([60, 62, 64], 4000), BEAT)).toEqual(motif([60, 62, 64]))
  })

  it('tells one beat of the bar from another, going round the bar line', () => {
    expect(movedInBar(0, 2)).toBe(true)
    expect(movedInBar(0.1, 3.95)).toBe(false)
    expect(movedInBar(1, 1.5)).toBe(true)
    expect(movedInBar(null, 2)).toBe(false)
  })

  it('wants each phrase back, changed, before a new one', () => {
    const p = (midis: number[]) => ({ notes: motif(midis), beatInBar: 0 })
    let s = motifStep(NEW_MOTIF, p([60, 62, 64, 67]), 1)
    expect(s.verdict.kind).toBe('first')
    // The same again is not a development: the phrase is still waiting for one.
    s = motifStep(s.run, p([60, 62, 64, 67]), 1)
    expect(s.verdict.kind).toBe('same')
    expect(s.run.developed).toBe(0)
    s = motifStep(s.run, p([60, 62, 65, 67]), 1)
    expect(s.verdict).toEqual({ kind: 'varied', changes: ['1 note changed'] })
    expect(s.run.developed).toBe(1)
    // Developed once, as asked: a new phrase is welcome now.
    s = motifStep(s.run, p([72, 70, 65, 61]), 1)
    expect(s.verdict.kind).toBe('first')
    // But a new one straight after that is too soon.
    s = motifStep(s.run, p([55, 59, 62, 66, 69]), 1)
    expect(s.verdict.kind).toBe('early')
  })

  it('compares each repeat with the one before it, so a phrase can keep changing', () => {
    const p = (midis: number[]) => ({ notes: motif(midis), beatInBar: 0 })
    let s = motifStep(NEW_MOTIF, p([60, 62, 64, 67]), 3)
    s = motifStep(s.run, p([60, 62, 65, 67]), 3)
    s = motifStep(s.run, p([62, 64, 67, 69]), 3)
    expect(s.verdict.changes).toEqual(['moved up a whole step'])
    expect(s.run.developed).toBe(2)
    // Two of three: a new phrase now leaves this one unfinished.
    expect(motifStep(s.run, p([72, 70, 65, 61]), 3).verdict.kind).toBe('early')
  })
})
