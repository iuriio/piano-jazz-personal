import { describe, expect, it } from 'vitest'
import { INITIAL, reduce, type Choice, type MachineState } from './machine'

const C: Choice = { key: { collectionPc: 0, center: 0, mode: 'major' }, pulse: null }

const playing = (): MachineState => reduce(reduce(INITIAL, { type: 'start', choice: C }), { type: 'started' })

describe('the band', () => {
  it('starts only when you press start, and plays from its first beat', () => {
    expect(reduce(INITIAL, { type: 'tick', context: 'free' })).toBe(INITIAL)
    const s = reduce(INITIAL, { type: 'start', choice: C })
    expect(s.phase).toBe('starting')
    expect(s.choice).toBe(C)
    expect(reduce(s, { type: 'started' }).phase).toBe('playing')
  })

  it('keeps playing through any number of ticks, until you stop it', () => {
    let s = playing()
    for (let i = 0; i < 1000; i++) s = reduce(s, { type: 'tick', context: 'free' })
    expect(s.phase).toBe('playing')
    expect(reduce(s, { type: 'stop' })).toEqual(INITIAL)
  })

  it('stops when you leave free play', () => {
    expect(reduce(playing(), { type: 'tick', context: 'shred' })).toEqual(INITIAL)
    expect(reduce(reduce(INITIAL, { type: 'start', choice: C }), { type: 'tick', context: 'voicings' })).toEqual(INITIAL)
  })

  it('ignores a second start while it plays', () => {
    const s = playing()
    expect(reduce(s, { type: 'start', choice: { ...C, key: { collectionPc: 7, center: 7, mode: 'major' } } })).toBe(s)
  })
})
