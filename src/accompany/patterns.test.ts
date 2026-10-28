import { describe, expect, it } from 'vitest'
import {
  STYLES,
  accentFor,
  autoStyle,
  barEnding,
  basePatternFor,
  feel,
  patternFor,
  swingFor,
  swungAt,
  walkingLine,
  type BarPattern,
  type Hit,
  type Style,
} from './patterns'
import { pcOf, rng } from './played'

describe('patternFor', () => {
  it('never plays the same rhythm two bars running', () => {
    for (const style of STYLES) {
      for (const bpm of [80, 120, 170]) {
        for (let seed = 1; seed <= 5; seed++) {
          let prev: string | null = null
          let prevPhrase = -1
          for (let phrase = 0; phrase < 8; phrase++) {
            for (let bar = 0; bar < 4; bar++) {
              const p = patternFor(style, bpm, phrase, bar, prev, seed)
              if (prevPhrase === phrase || bar === 0) expect(p.id).not.toBe(prev)
              prev = p.id
              prevPhrase = phrase
            }
          }
        }
      }
    }
  })

  it('is deterministic for a seed', () => {
    const run = () => [0, 1, 2, 3].map((bar) => patternFor('comp', 120, 2, bar, null, 9).id)
    expect(run()).toEqual(run())
  })

  it('leaves space behind a soloist: two piano attacks a bar or fewer in comp (ghosts aside)', () => {
    for (const energy of [0, 0.5, 1]) {
      for (let seed = 1; seed <= 6; seed++) {
        for (const { bar } of run('comp', 120, seed, 10, energy)) {
          expect(bar.hits.filter((h) => h.part === 'piano' && !h.ghost).length).toBeLessThanOrEqual(2)
          expect(bar.hits.filter((h) => h.part === 'piano').length).toBeLessThanOrEqual(3)
        }
      }
    }
  })
})

/** A chain of bars as the accompanist asks for them: prevId threaded through. */
function run(style: Style, bpm: number, seed: number, phrases: number, energy = 0.5) {
  const out: { phrase: number; index: number; bar: BarPattern }[] = []
  let prev: string | null = null
  for (let phrase = 0; phrase < phrases; phrase++) {
    for (let index = 0; index < 4; index++) {
      const bar = patternFor(style, bpm, phrase, index, prev, seed, { energy })
      out.push({ phrase, index, bar })
      prev = bar.id
    }
  }
  return out
}

/** Rhythm + touch of a bar, as you would hear it. */
const signature = (hits: Hit[]) => hits.map((h) => `${h.part}${h.what}@${h.at}:${h.dur.toFixed(2)}/${h.vel.toFixed(2)}`).join(' ')

describe('performed bars', () => {
  it('stay inside the bar, with real lengths and weights', () => {
    for (const style of STYLES) {
      for (const { bar } of run(style, 110, 3, 8)) {
        for (const h of bar.hits) {
          expect(h.at).toBeGreaterThanOrEqual(0)
          expect(h.at).toBeLessThan(4)
          expect(h.dur).toBeGreaterThan(0)
          expect(h.vel).toBeGreaterThan(0)
        }
      }
    }
  })

  it('no two bars running sound the same (rhythm and touch)', () => {
    for (const style of STYLES) {
      for (const bpm of [80, 120, 170]) {
        for (let seed = 1; seed <= 10; seed++) {
          const bars = run(style, bpm, seed, 8)
          for (let i = 1; i < bars.length; i++) {
            expect(signature(bars[i].bar.hits)).not.toBe(signature(bars[i - 1].bar.hits))
          }
        }
      }
    }
  })

  it('no two phrases running sound the same', () => {
    for (const style of STYLES) {
      for (let seed = 1; seed <= 10; seed++) {
        const bars = run(style, 120, seed, 8)
        for (let ph = 1; ph < 8; ph++) {
          const a = bars.slice((ph - 1) * 4, ph * 4).map((x) => signature(x.bar.hits)).join(' | ')
          const b = bars.slice(ph * 4, ph * 4 + 4).map((x) => signature(x.bar.hits)).join(' | ')
          expect(b).not.toBe(a)
        }
      }
    }
  })

  it('a chord pushed over the bar line is not struck again on 1', () => {
    let ties = 0
    for (const style of STYLES) {
      for (let seed = 1; seed <= 10; seed++) {
        const bars = run(style, 120, seed, 8)
        for (let i = 1; i < bars.length; i++) {
          if (!bars[i - 1].bar.hits.some((h) => h.ahead)) continue
          ties++
          expect(bars[i].bar.hits.some((h) => h.part === 'piano' && h.at < 0.25)).toBe(false)
        }
      }
    }
    expect(ties).toBeGreaterThan(20)
  })

  it('pushes are held over the bar line, not clipped at it', () => {
    for (const { bar } of run('comp', 120, 4, 8)) {
      for (const h of bar.hits.filter((x) => x.ahead)) expect(h.at + h.dur).toBeGreaterThan(4.5)
    }
  })

  it('a phrase builds into its third bar and relaxes at the cadence', () => {
    // Same written pattern in every bar, so only the touch differs: compare the mean weight.
    const mean = (bar: number) => {
      let sum = 0
      let n = 0
      for (let seed = 1; seed <= 200; seed++) {
        const p = patternFor('pad', 60, 1, bar, null, seed, { energy: 0.5 })
        const padHit = p.hits.find((h) => h.part === 'bass' && h.at === 0)
        if (padHit) {
          sum += padHit.vel / (basePatternFor('pad', 60, 1, bar, null, seed).hits.find((h) => h.part === 'bass' && h.at === 0)!.vel)
          n++
        }
      }
      return sum / n
    }
    const [one, two, three, four] = [0, 1, 2, 3].map(mean)
    expect(three).toBeGreaterThan(two)
    expect(two).toBeGreaterThan(one)
    expect(four).toBeLessThan(three)
    expect(four).toBeLessThan(one)
  })

  it('follows your energy: softer and sparser when you are, busier and louder when you dig in', () => {
    const stats = (energy: number) => {
      let attacks = 0
      let ghosts = 0
      let vel = 0
      let n = 0
      for (let seed = 1; seed <= 30; seed++) {
        for (const { bar } of run('comp', 120, seed, 4, energy)) {
          const piano = bar.hits.filter((h) => h.part === 'piano')
          attacks += piano.length
          ghosts += piano.filter((h) => h.ghost).length
          for (const h of bar.hits.filter((x) => x.part === 'bass')) {
            vel += h.vel
            n++
          }
        }
      }
      return { attacks, ghosts, vel: vel / n }
    }
    const soft = stats(0.05)
    const mid = stats(0.5)
    const hot = stats(0.95)
    expect(soft.attacks).toBeLessThan(mid.attacks)
    expect(mid.attacks).toBeLessThan(hot.attacks)
    expect(soft.ghosts).toBe(0)
    expect(hot.ghosts).toBeGreaterThan(mid.ghosts)
    expect(hot.vel / soft.vel).toBeGreaterThan(1.3)
  })

  it('varies articulation: the same written comp comes back as stabs and as holds', () => {
    const lengths = new Set<string>()
    for (let seed = 1; seed <= 40; seed++) {
      for (const { bar } of run('comp', 120, seed, 2)) {
        if (bar.id !== 'charleston') continue
        const first = bar.hits.find((h) => h.part === 'piano' && h.at === 0)
        if (first) lengths.add(first.dur < 0.55 ? 'stab' : first.dur > 1.2 ? 'hold' : 'written')
      }
    }
    expect([...lengths].sort()).toEqual(['hold', 'stab', 'written'])
  })

  it('ends some phrases with a fill, more often at the end of the form', () => {
    const fills = [0, 0, 0, 0]
    for (let seed = 1; seed <= 200; seed++) {
      for (let phrase = 0; phrase < 4; phrase++) {
        const base = basePatternFor('comp', 120, phrase, 3, null, seed)
        if (barEnding('comp', phrase, 3, base, seed) === 'fill') fills[phrase]++
      }
    }
    expect(fills[3]).toBeGreaterThan(fills[0])
    expect(Math.min(...fills)).toBeGreaterThan(20)
  })

  it('is the same bar for the same seed, phrase, bar and energy', () => {
    const a = run('walk', 130, 7, 4, 0.7).map((x) => signature(x.bar.hits))
    const b = run('walk', 130, 7, 4, 0.7).map((x) => signature(x.bar.hits))
    expect(a).toEqual(b)
  })
})

describe('walkingLine', () => {
  const win = { low: 28, high: 48 }
  const changes: [number, number[], number][] = [
    [0, [0, 3, 7, 10], 5], // Cm7 -> F
    [5, [5, 9, 0, 3], 10], // F7 -> B♭
    [10, [10, 2, 5, 9], 10], // B♭ -> B♭
    [7, [7, 11, 2, 5], 0], // G7 -> C
  ]

  it('starts on the root and approaches the next root by a half or whole step', () => {
    let prev: number | null = null
    for (let seed = 1; seed <= 20; seed++) {
      for (const [root, tones, next] of changes) {
        const line = walkingLine(root, tones, next, prev, win, seed)
        expect(pcOf(line[0])).toBe(root)
        const nearestNext = [line[3] - 2, line[3] - 1, line[3] + 1, line[3] + 2].some((m) => pcOf(m) === next)
        expect(nearestNext, `${line} -> ${next}`).toBe(true)
        for (const m of line) {
          expect(m).toBeGreaterThanOrEqual(win.low)
          expect(m).toBeLessThanOrEqual(win.high)
        }
        prev = line[3]
      }
    }
  })

  it('beat 2 is a chord tone', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const line = walkingLine(0, [0, 3, 7, 10], 5, null, win, seed)
      expect([0, 3, 7, 10]).toContain(pcOf(line[1]))
    }
  })
})

describe('feel', () => {
  it('puts the piano behind the beat and the bass on it', () => {
    const r = rng(1)
    for (let i = 0; i < 50; i++) {
      const piano = feel({ at: 0, dur: 1, part: 'piano', vel: 1, what: 'chord' }, 50, 0, false, r)
      const bass = feel({ at: 0, dur: 1, part: 'bass', vel: 1, what: 'root' }, 50, 0, false, r)
      expect(piano.lateMs).toBeLessThanOrEqual(18)
      expect(bass.lateMs).toBeLessThanOrEqual(9)
      expect(Math.abs(piano.velocity - 50)).toBeLessThanOrEqual(11)
    }
  })

  it('leans on 2 and 4 when swung', () => {
    const r = () => 0.5
    const at = (x: number) => feel({ at: x, dur: 1, part: 'piano', vel: 1, what: 'chord' }, 50, 2, true, r).velocity
    expect(at(1)).toBeGreaterThanOrEqual(at(0) + 10)
    expect(at(3)).toBeGreaterThanOrEqual(at(2) + 10)
    expect(at(1.5)).toBeGreaterThan(at(2))
  })

  it('leads with the downbeat when straight, off-beats lighter', () => {
    const piano = (at: number): Hit => ({ at, dur: 1, part: 'piano', vel: 1, what: 'chord' })
    expect(accentFor(piano(0), false)).toBeGreaterThan(accentFor(piano(2), false))
    expect(accentFor(piano(2), false)).toBeGreaterThan(accentFor(piano(1.5), false))
    expect(accentFor(piano(1), false)).toBeLessThan(accentFor(piano(0), false))
  })

  it('the bass leans on 1: a little louder, a hair ahead', () => {
    const r = rng(3)
    for (let i = 0; i < 50; i++) {
      const one = feel({ at: 0, dur: 1, part: 'bass', vel: 1, what: 'root' }, 50, 0, false, r)
      const three = feel({ at: 2, dur: 1, part: 'bass', vel: 1, what: 'fifth' }, 50, 0, false, r)
      expect(one.lateMs).toBeLessThan(three.lateMs + 8)
      expect(one.lateMs).toBeGreaterThanOrEqual(-10)
    }
    expect(accentFor({ at: 0, dur: 1, part: 'bass', vel: 1, what: 'root' }, false)).toBeGreaterThan(1)
  })

  it('a ghost can sit under the floor of a normal note', () => {
    const ghost = feel({ at: 2.5, dur: 0.25, part: 'piano', vel: 0.3, what: 'chord', ghost: true }, 40, 0, false, () => 0.5)
    expect(ghost.velocity).toBeLessThan(20)
  })

  it('honours a hit lean: an even push sits earlier than a laid-back ballad chord', () => {
    const r = () => 0.5
    const early = feel({ at: 0, dur: 1, part: 'piano', vel: 1, what: 'chord', shiftMs: -5 }, 50, 0, false, r)
    const late = feel({ at: 0, dur: 1, part: 'piano', vel: 1, what: 'chord', shiftMs: 6 }, 50, 0, false, r)
    expect(late.lateMs - early.lateMs).toBeCloseTo(11)
  })
})

describe('swing', () => {
  it('flattens with tempo', () => {
    expect(swingFor(100)).toBeCloseTo(0.66)
    expect(swingFor(160)).toBeCloseTo(0.62)
    expect(swingFor(240)).toBeCloseTo(0.58)
  })

  it('meets your own swing halfway', () => {
    expect(swingFor(100, 0.6)).toBeCloseTo(0.63)
    expect(swingFor(200, 0.7)).toBeCloseTo(0.64)
    // Straight eighths heard: the tempo rule stands.
    expect(swingFor(100, 0.5)).toBeCloseTo(0.66)
    expect(swingFor(100, null)).toBeCloseTo(0.66)
    // Never past a hard triplet-plus.
    expect(swingFor(100, 0.9)).toBeLessThanOrEqual(0.72)
  })

  it('moves only the off-beat eighths', () => {
    expect(swungAt(1.5, 0.66)).toBeCloseTo(1.66)
    expect(swungAt(2, 0.66)).toBe(2)
    expect(swungAt(1.5, null)).toBe(1.5)
  })

  it('picks a style from what it heard', () => {
    const cases: [number | null, boolean, Style][] = [
      [null, false, 'pad'],
      [60, false, 'pad'],
      [92, false, 'even'],
      [140, true, 'comp'],
    ]
    for (const [bpm, swung, style] of cases) expect(autoStyle(bpm, swung)).toBe(style)
  })
})
