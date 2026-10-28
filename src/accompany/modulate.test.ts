import { describe, expect, it } from 'vitest'
import { modulate } from './modulate'
import { lockThrough, planPhrase, renderPhrase, type PlanKey, type PlanOpts } from './progression'

const C: PlanKey = { collectionPc: 0, center: 0, mode: 'major' }
const G: PlanKey = { collectionPc: 7, center: 7, mode: 'major' }
const Em: PlanKey = { collectionPc: 7, center: 4, mode: 'minor' }
const opts: PlanOpts = { seed: 7, density: 1, beatsPerBar: 4 }
const symbols = (p: ReturnType<typeof planPhrase>) => renderPhrase(p, 2, 7).map((bar) => bar.map((c) => c.symbol))

/** Phrase 0 in C, with bars 0..bar already started (locked). */
function playedThrough(bar: number, o: PlanOpts = opts) {
  const p = planPhrase(C, 0, o)
  return lockThrough(p, bar, renderPhrase(p, 2, 7))
}

describe('a key change in the middle of a phrase', () => {
  it('keeps the bars that started and plans the rest in the new key, with a ii–V into it', () => {
    const before = playedThrough(0)
    const after = modulate(before, 1, G, opts, true)
    expect(after.key).toEqual(G)
    const s = symbols(after)
    expect(s[0]).toEqual(symbols(before)[0])
    expect(s[1]).toEqual(['Am7', 'D7'])
    expect(s[2]).toEqual(['Gmaj7'])
    // The last bar is the new key's own plan for it.
    expect(s[3]).toEqual(symbols(planPhrase(G, 0, opts))[3])
  })

  it('with one bar left, that bar is the ii–V', () => {
    const s = symbols(modulate(playedThrough(2), 3, G, opts, true))
    expect(s[3]).toEqual(['Am7', 'D7'])
  })

  it('into a minor key, iiø–V–i', () => {
    const s = symbols(modulate(playedThrough(0), 1, Em, opts, true))
    expect(s[1]).toEqual(['F♯m7b5'.replace('♯', '#'), 'B7'])
    expect(s[2]).toEqual(['Em7'])
  })

  it('without a lead, just the new key’s plan, and never a “%” of the old key', () => {
    const two: PlanOpts = { ...opts, density: 2 }
    const before = playedThrough(0, two)
    const after = modulate(before, 1, G, two, false)
    expect(after.bars[1].slots[0].hold).toBe(false)
    expect(after.bars[0]).toBe(before.bars[0])
  })

  it('in two-bars-a-chord, the tonic carries on after the landing', () => {
    const two: PlanOpts = { ...opts, density: 2 }
    const after = modulate(playedThrough(0, two), 1, G, two, true)
    expect(after.bars[3].slots[0]).toMatchObject({ token: 'I', hold: true })
  })

  it('nothing left to plan in this phrase: unchanged', () => {
    const p = playedThrough(3)
    expect(modulate(p, 4, G, opts, true)).toBe(p)
  })
})
