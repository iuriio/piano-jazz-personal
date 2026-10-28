import { afterEach, describe, expect, it } from 'vitest'
import { injectRaw, receiveFromInput, setInputFilter, subscribeRaw, subscribeStatus } from './midi'

// Node has no requestMIDIAccess, so this also proves both paths work without
// Web MIDI — the Safari/Firefox situation.

afterEach(() => setInputFilter(null))

describe('injectRaw', () => {
  it('reaches raw listeners with no Web MIDI', () => {
    const got: number[][] = []
    const times: number[] = []
    const unsub = subscribeRaw((data, time) => {
      got.push(Array.from(data))
      times.push(time)
    })
    const before = performance.now()
    injectRaw([0x90, 60, 80])
    unsub()
    injectRaw([0x80, 60, 0])
    expect(got).toEqual([[0x90, 60, 80]])
    expect(times[0]).toBeGreaterThanOrEqual(before)
  })

  it('is not affected by the input filter', () => {
    const got: number[] = []
    const unsub = subscribeRaw((data) => got.push(data[1]))
    setInputFilter('some-port')
    injectRaw([0x90, 62, 80])
    unsub()
    expect(got).toEqual([62])
  })
})

describe('setInputFilter', () => {
  it('passes every input when null', () => {
    const got: number[] = []
    const unsub = subscribeRaw((data) => got.push(data[1]))
    receiveFromInput('a', [0x90, 60, 80], 1)
    receiveFromInput('b', [0x90, 61, 80], 2)
    unsub()
    expect(got).toEqual([60, 61])
  })

  it('drops messages from other inputs', () => {
    const got: number[] = []
    const unsub = subscribeRaw((data) => got.push(data[1]))
    setInputFilter('a')
    receiveFromInput('a', [0x90, 60, 80], 1)
    receiveFromInput('b', [0x90, 61, 80], 2)
    setInputFilter(null)
    receiveFromInput('b', [0x90, 62, 80], 3)
    unsub()
    expect(got).toEqual([60, 62])
  })

  it('publishes the filter in the status', () => {
    let current: string | null | undefined
    const unsub = subscribeStatus((s) => {
      current = s.inputId
    })
    setInputFilter('a')
    expect(current).toBe('a')
    setInputFilter(null)
    expect(current).toBeNull()
    unsub()
  })
})
