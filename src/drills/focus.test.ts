import { describe, expect, it } from 'vitest'
import { FOCUS_SIZE, KNOWN_LEVEL, STEPS_MS, focusState, isKnown, pickNext, reschedule, type Outcome } from './focus'
import { intervalItems, INTERVALS } from './intervals'
import { chordItems } from './sevenths'
import { recordAnswer, type SpeedEntry, type SpeedStats } from './speed'

const blank: SpeedEntry = { attempts: 1, correct: 1, lastOk: true, lastMs: 1000, bestMs: 1000 }
const at = (level: number, dueAt: number): SpeedEntry => ({ ...blank, level, dueAt })

describe('curriculum', () => {
  it('opens with five different intervals over one root: the chord tones of C', () => {
    const order = intervalItems(INTERVALS.map((i) => i.id))
    expect(order).toHaveLength(132)
    expect(new Set(order).size).toBe(132)
    expect(order.slice(0, 5)).toEqual(['M3:0', 'm3:0', 'P5:0', 'm7:0', 'M7:0'])
    // then the same five from F, and so on round the roots
    expect(order.slice(5, 10)).toEqual(['M3:5', 'm3:5', 'P5:5', 'm7:5', 'M7:5'])
    // every chord tone from every root before the first extension
    expect(order[60]).toBe('M2:0')
  })

  it('skips what is switched off without changing the order of the rest', () => {
    expect(intervalItems(['P5', 'M3']).slice(0, 4)).toEqual(['M3:0', 'P5:0', 'M3:5', 'P5:5'])
  })

  it('opens the chords with the three core types on C', () => {
    expect(chordItems(['maj7', 'm7', '7', 'dim7']).slice(0, 4)).toEqual(['maj7:0', 'm7:0', '7:0', 'maj7:5'])
    expect(chordItems(['maj7', 'm7', '7', 'dim7'])[36]).toBe('dim7:0')
  })
})

describe('reschedule', () => {
  const now = 1_000_000

  it('walks a new question up the learning steps on fast answers', () => {
    const l1 = reschedule(blank, 'fast', now)
    expect(l1).toMatchObject({ level: 1, dueAt: now + STEPS_MS[1] })
    // asked again before it was due, because the focus had nothing else: still counts
    const l2 = reschedule(l1, 'fast', now + 5000)
    expect(l2).toMatchObject({ level: 2, dueAt: now + 5000 + STEPS_MS[2] })
  })

  it('does not take the last step to known ahead of time', () => {
    const waiting = at(KNOWN_LEVEL - 1, now + 30_000)
    expect(reschedule(waiting, 'fast', now)).toMatchObject({ level: KNOWN_LEVEL - 1, dueAt: now + 30_000 })
    expect(reschedule(waiting, 'fast', now + 30_000)).toMatchObject({ level: KNOWN_LEVEL, dueAt: now + 30_000 + STEPS_MS[KNOWN_LEVEL] })
  })

  it('does not stretch a review answered ahead of time', () => {
    const known = at(5, now + 1000)
    expect(reschedule(known, 'fast', now)).toMatchObject({ level: 5, dueAt: now + 1000 })
  })

  it('stretches a due review, up to the last step', () => {
    expect(reschedule(at(5, now), 'fast', now)).toMatchObject({ level: 6, dueAt: now + STEPS_MS[6] })
    const top = STEPS_MS.length - 1
    expect(reschedule(at(top, now), 'fast', now)).toMatchObject({ level: top, dueAt: now + STEPS_MS[top] })
  })

  it('a miss starts over and comes back within seconds', () => {
    expect(reschedule(at(6, now + 99_999), 'miss', now)).toMatchObject({ level: 0, dueAt: now + STEPS_MS[0] })
    expect(STEPS_MS[0]).toBeLessThan(15_000)
  })

  it('a slow answer sends a known question back into learning, a learning one a step back', () => {
    expect(reschedule(at(6, now), 'slow', now).level).toBe(KNOWN_LEVEL - 1)
    expect(reschedule(at(2, now), 'slow', now).level).toBe(1)
    expect(reschedule(blank, 'slow', now).level).toBe(0)
  })

  it('keeps the score it was given', () => {
    expect(reschedule({ ...blank, attempts: 7 }, 'fast', now)).toMatchObject({ attempts: 7, bestMs: 1000 })
  })
})

describe('pickNext', () => {
  const order = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
  const now = 1_000_000

  it('starts with the first question of the curriculum', () => {
    expect(pickNext({}, order, now, null)).toBe('a')
  })

  it('brings in new questions until the focus is full, then turns the focus', () => {
    const stats: SpeedStats = { a: at(1, now + 20_000), b: at(1, now + 21_000) }
    expect(pickNext(stats, order, now, 'b')).toBe('c')
    const full: SpeedStats = { ...stats, c: at(1, now + 22_000), d: at(1, now + 23_000), e: at(1, now + 24_000) }
    expect(Object.keys(full)).toHaveLength(FOCUS_SIZE)
    // nothing due, no room for 'f': one of the two closest to due
    expect(pickNext(full, order, now, 'e', () => 0)).toBe('a')
    expect(pickNext(full, order, now, 'e', () => 0.99)).toBe('b')
    expect(pickNext(full, order, now, 'a', () => 0)).toBe('b')
  })

  it('puts a due learning question ahead of a due review, and a review ahead of anything new', () => {
    const stats: SpeedStats = { a: at(5, now - 1000), b: at(0, now - 10) }
    expect(pickNext(stats, order, now, null)).toBe('b')
    expect(pickNext({ a: at(5, now - 1000) }, order, now, null)).toBe('a')
  })

  it('opens a place when a question becomes known', () => {
    const stats: SpeedStats = {
      a: at(KNOWN_LEVEL, now + 300_000),
      b: at(2, now + 50_000),
      c: at(2, now + 51_000),
      d: at(2, now + 52_000),
      e: at(2, now + 53_000),
    }
    expect(pickNext(stats, order, now, 'b')).toBe('f')
  })

  it('never repeats the question just asked while there is another', () => {
    expect(pickNext({ a: at(0, now - 1) }, order, now, 'a')).toBe('b')
    expect(pickNext({ a: at(0, now - 1) }, ['a'], now, 'a')).toBe('a')
  })

  it('with everything known and nothing due, reviews what is closest to due', () => {
    const stats: SpeedStats = { a: at(4, now + 5000), b: at(4, now + 1000) }
    expect(pickNext(stats, ['a', 'b'], now, null)).toBe('b')
  })

  it('ignores questions that were switched off', () => {
    const stats: SpeedStats = { z: at(0, now - 1) }
    expect(pickNext(stats, order, now, null)).toBe('a')
  })
})

describe('a session', () => {
  // A player answering every 3 seconds; `how` decides each answer.
  function play(order: string[], questions: number, how: (id: string, n: number) => Outcome) {
    let stats: SpeedStats = {}
    let now = 1_700_000_000_000
    let last: string | null = null
    const asked: string[] = []
    let widest = 0
    for (let n = 0; n < questions; n++) {
      const id = pickNext(stats, order, now, last)
      const outcome = how(id, n)
      stats = recordAnswer(stats, id, outcome !== 'miss', outcome === 'slow' ? 3000 : 1000)
      stats = { ...stats, [id]: reschedule(stats[id], outcome, now) }
      asked.push(id)
      last = id
      now += 3000
      widest = Math.max(widest, focusState(stats, order).learning.length)
    }
    return { stats, asked, widest }
  }

  const order = intervalItems(INTERVALS.map((i) => i.id))

  it('a player who knows everything works on five at a time and keeps moving forward', () => {
    const { stats, asked, widest } = play(order, 400, () => 'fast')
    expect(asked.slice(0, 5)).toEqual(order.slice(0, 5))
    expect(widest).toBe(FOCUS_SIZE)
    for (let i = 1; i < asked.length; i++) expect(asked[i], `question ${i}`).not.toBe(asked[i - 1])
    const f = focusState(stats, order)
    // 20 minutes of perfect answers: well past the first handful, nowhere near skipping ahead
    expect(f.known).toBeGreaterThan(20)
    expect(f.known + f.learning.length).toBeLessThanOrEqual(order.length)
    // nothing was introduced out of order
    const seen = [...new Set(asked)]
    expect(seen).toEqual(order.slice(0, seen.length))
  })

  it('a question takes at least three fast answers, over a minute, to become known', () => {
    const { stats, asked } = play(order, 60, () => 'fast')
    for (const id of new Set(asked)) {
      if (!isKnown(stats[id])) continue
      const times = asked.map((x, i) => (x === id ? i : -1)).filter((i) => i >= 0)
      expect(times.length, id).toBeGreaterThanOrEqual(KNOWN_LEVEL)
      expect((times[times.length - 1] - times[0]) * 3000, id).toBeGreaterThanOrEqual(STEPS_MS[KNOWN_LEVEL - 1])
    }
    expect([...new Set(asked)].some((id) => isKnown(stats[id]))).toBe(true)
  })

  it('a question that keeps being missed comes back within a few questions and holds its place', () => {
    const hard = order[2]
    const { stats, asked, widest } = play(order, 120, (id) => (id === hard ? 'miss' : 'fast'))
    const times = asked.map((x, i) => (x === hard ? i : -1)).filter((i) => i >= 0)
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeLessThanOrEqual(6)
    expect(stats[hard].level).toBe(0)
    expect(widest).toBe(FOCUS_SIZE)
    expect(focusState(stats, order).learning).toContain(hard)
  })

  it('reviews come due on the next day, before anything new', () => {
    const { stats } = play(order, 400, () => 'fast')
    const tomorrow = 1_700_000_000_000 + 400 * 3000 + 24 * 3600 * 1000
    const known = order.filter((id) => isKnown(stats[id]))
    const first = pickNext(stats, order, tomorrow, null)
    expect(stats[first]?.level).toBeDefined()
    expect(known.filter((id) => (stats[id].dueAt ?? 0) <= tomorrow).length).toBeGreaterThan(10)
  })
})
