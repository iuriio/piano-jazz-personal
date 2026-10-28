import { describe, expect, it } from 'vitest'
import {
  fitScore,
  functionOf,
  lockThrough,
  planPhrase,
  refineBar,
  renderPhrase,
  scalePcs,
  sectionOf,
  symbolFor,
  type Complexity,
  type PlanKey,
} from './progression'

const BB: PlanKey = { collectionPc: 10, center: 10, mode: 'major' }
const GM: PlanKey = { collectionPc: 10, center: 7, mode: 'minor' }
const D_DORIAN: PlanKey = { collectionPc: 0, center: 2, mode: 'dorian' }
const G_MIXO: PlanKey = { collectionPc: 0, center: 7, mode: 'mixolydian' }
const OPTS = { seed: 42, density: 1 as const, beatsPerBar: 4 }

const symbols = (key: PlanKey, index: number, c: Complexity, seed = 42) =>
  renderPhrase(planPhrase(key, index, { ...OPTS, seed }), c, seed).map((bar) => bar.map((ch) => ch.symbol))

describe('planPhrase', () => {
  it('the same seed gives the same phrase', () => {
    for (let i = 0; i < 8; i++) expect(symbols(BB, i, 3)).toEqual(symbols(BB, i, 3))
  })

  it('different seeds can give different tunes', () => {
    const tunes = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => JSON.stringify([0, 1, 2, 3].map((i) => symbols(BB, i, 2, seed)))))
    expect(tunes.size).toBeGreaterThan(1)
  })

  it('walks the form A A′ B A″, four bars a phrase', () => {
    expect([0, 1, 2, 3, 4].map(sectionOf)).toEqual(['A', 'A′', 'B', 'A″', 'A'])
    expect(planPhrase(BB, 0, OPTS).bars).toHaveLength(4)
  })

  it('starts the tune on the tonic', () => {
    for (const key of [BB, GM, D_DORIAN, G_MIXO]) {
      for (const seed of [1, 2, 3]) {
        const first = renderPhrase(planPhrase(key, 0, { ...OPTS, seed }), 2, seed)[0][0]
        expect(first.root).toBe(key.center)
      }
    }
  })

  it('at complexity 1–2 every chord is diatonic (the leading tone allowed in minor)', () => {
    for (const key of [BB, GM, D_DORIAN, G_MIXO]) {
      const allowed = new Set(scalePcs(key))
      if (key.mode === 'minor') allowed.add((key.center + 11) % 12)
      for (const c of [1, 2] as Complexity[]) {
        for (let seed = 1; seed <= 6; seed++) {
          for (let i = 0; i < 8; i++) {
            for (const bar of renderPhrase(planPhrase(key, i, { ...OPTS, seed }), c, seed)) {
              for (const ch of bar) for (const pc of ch.tones) expect(allowed.has(pc), `${ch.symbol} in ${JSON.stringify(key)}`).toBe(true)
            }
          }
        }
      }
    }
  })

  it('complexity 1 is triads, 2 is sevenths', () => {
    const one = renderPhrase(planPhrase(BB, 0, OPTS), 1, 42).flat()
    const two = renderPhrase(planPhrase(BB, 0, OPTS), 2, 42).flat()
    for (const ch of one) expect(ch.tones).toHaveLength(3)
    for (const ch of two) expect(ch.tones).toHaveLength(4)
  })

  it('spells chords in the key: B♭ major says B♭maj7, E♭, Cm7 — never A♯', () => {
    expect(symbolFor('I', BB, 2)).toBe('Bbmaj7')
    expect(symbolFor('IV', BB, 1)).toBe('Eb')
    expect(symbolFor('ii', BB, 2)).toBe('Cm7')
    expect(symbolFor('V', BB, 3)).toBe('F13')
    expect(symbolFor('V', GM, 3)).toBe('D7b9')
    expect(symbolFor('iiø', GM, 2)).toBe('Am7b5')
  })

  it('half density: one chord every two bars, held with a repeat', () => {
    const p = planPhrase(BB, 0, { ...OPTS, density: 2 })
    expect(p.bars.map((b) => !!b.slots[0].hold)).toEqual([false, true, false, true])
    expect(p.bars[0].slots[0].token).toBe(p.bars[1].slots[0].token)
  })

  it('complexity 4 brings substitutions somewhere in a tune', () => {
    let subs = 0
    for (let seed = 1; seed <= 10; seed++) {
      for (let i = 0; i < 4; i++) {
        const plain = renderPhrase(planPhrase(BB, i, { ...OPTS, seed }), 3, seed).flat()
        const rich = renderPhrase(planPhrase(BB, i, { ...OPTS, seed }), 4, seed).flat()
        if (rich.length !== plain.length || rich.some((c, j) => c.root !== plain[j].root)) subs++
      }
    }
    expect(subs).toBeGreaterThan(0)
  })
})

describe('locking', () => {
  it('complexity only changes the bars not yet locked', () => {
    let p = planPhrase(BB, 0, OPTS)
    p = lockThrough(p, 1, renderPhrase(p, 1, 42))
    const rich = renderPhrase(p, 3, 42)
    const simple = renderPhrase(p, 1, 42)
    expect(rich[0]).toEqual(simple[0])
    expect(rich[1]).toEqual(simple[1])
    expect(rich[2][0].symbol).not.toBe(simple[2][0].symbol)
    expect(rich[3][0].symbol).not.toBe(simple[3][0].symbol)
  })
})

describe('refineBar (the live swap)', () => {
  // You have been leaning on D, F and A: a Dm triad.
  const dMinorish = Array.from({ length: 12 }, (_, pc) => ([2, 5, 9].includes(pc) ? 1 : 0))

  it('keeps the function when it swaps', () => {
    for (let seed = 1; seed <= 6; seed++) {
      for (let i = 0; i < 4; i++) {
        const p = planPhrase(BB, i, { ...OPTS, seed })
        for (let bar = 0; bar < 4; bar++) {
          const q = refineBar(p, bar, dMinorish)
          expect(functionOf(q.bars[bar].slots[0].token)).toBe(functionOf(p.bars[bar].slots[0].token))
        }
      }
    }
  })

  it('swaps I for vi when you keep leaning on G minor', () => {
    const gMinor = Array.from({ length: 12 }, (_, pc) => (pc === 7 ? 2 : [10, 2].includes(pc) ? 1 : 0))
    const p = planPhrase(BB, 0, OPTS)
    const bar = p.bars.findIndex((b) => b.slots[0].token === 'I')
    expect(bar).toBeGreaterThanOrEqual(0)
    const q = refineBar(p, bar, gMinor)
    expect(q.bars[bar].slots[0].token).toBe('vi')
  })

  it('leaves the chord alone when what you play fits it', () => {
    const bbTriad = Array.from({ length: 12 }, (_, pc) => ([10, 2, 5].includes(pc) ? 1 : 0))
    const p = planPhrase(BB, 0, OPTS)
    const bar = p.bars.findIndex((b) => b.slots[0].token === 'I')
    expect(refineBar(p, bar, bbTriad)).toBe(p)
  })

  it('never touches a locked bar', () => {
    let p = planPhrase(BB, 0, OPTS)
    p = lockThrough(p, 3, renderPhrase(p, 2, 42))
    for (let bar = 0; bar < 4; bar++) expect(refineBar(p, bar, dMinorish)).toBe(p)
  })

  it('scores avoid notes down: the 4th over IΔ', () => {
    const bbMaj7 = [10, 2, 5, 9]
    const withFourth = Array.from({ length: 12 }, (_, pc) => (pc === 3 ? 1 : 0))
    const withNinth = Array.from({ length: 12 }, (_, pc) => (pc === 0 ? 1 : 0))
    expect(fitScore(bbMaj7, BB, withFourth)).toBeLessThan(0)
    expect(fitScore(bbMaj7, BB, withNinth)).toBeGreaterThan(0)
  })
})
