import { describe, expect, it } from 'vitest'
import { activityOf } from './listener'
import { scaleRun, shift } from './fixtures'

describe('activityOf', () => {
  it('counts playing time and attacks over the window', () => {
    const notes = scaleRun(58, 'major', { bpm: 120, perBeat: 2 }) // 29 notes, ~7 s
    const end = notes[notes.length - 1].on + 500
    const a = activityOf(notes, end, 15000)
    expect(a.attacks).toBe(notes.length)
    expect(a.activeMs).toBeGreaterThan(7000)
    expect(a.lastAttack).toBe(notes[notes.length - 1].on)
  })

  it('a pause over 2 s does not count as playing', () => {
    const a = scaleRun(58, 'major', { bpm: 120, perBeat: 2 })
    const b = shift(a, 12000)
    const end = b[b.length - 1].on + 100
    const act = activityOf([...a, ...b], end, 30000)
    expect(act.activeMs).toBeLessThan(2 * 8000)
  })

  it('a chord is one attack', () => {
    const chord = [60, 64, 67].map((midi, i) => ({ midi, velocity: 70, on: 1000 + i * 8, off: 2000, lowest: i === 0 }))
    expect(activityOf(chord, 2500, 15000).attacks).toBe(1)
  })
})
